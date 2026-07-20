'use strict';

/**
 * Query battery collector: generates the {service}x{city}x{intent} query
 * matrix and runs it through Gemini 2.5 Flash with Google Search grounding
 * (same single-API pattern as the Real Estate Research Agent n8n workflow).
 *
 * `generateQueries`, `normalize`, and `detectMention` are pure and safe to
 * unit test without network. `runBattery` is the only network entry point.
 */

const INTENTS = ['best_near_me', 'who_to_call', 'cost', 'emergency'];
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const DEFAULT_CAP = 20;
const QUERY_DELAY_MS = 350;
const FETCH_TIMEOUT_MS = 20000;

function buildQueryText(service, city, intent) {
  switch (intent) {
    case 'best_near_me':
      return `best ${service} near ${city} MN`;
    case 'who_to_call':
      return `who should I call for ${service} in ${city} MN`;
    case 'cost':
      return `how much does ${service} cost in ${city} MN`;
    case 'emergency':
      return `emergency ${service} ${city} MN`;
    default:
      return `${service} ${city} MN`;
  }
}

/**
 * Generates the query battery from the PRD matrix: {service} x {city} x
 * {intent}, capped at ~20 with even coverage across the four intents. Pure
 * and deterministic (no randomness) so it's testable and reproducible.
 */
function generateQueries(clientConfig, cap = DEFAULT_CAP) {
  const services = Array.isArray(clientConfig.services) ? clientConfig.services.filter(Boolean) : [];
  const cities = Array.isArray(clientConfig.cities) ? clientConfig.cities.filter(Boolean) : [];
  if (!services.length || !cities.length) return [];

  const totalPairs = services.length * cities.length;
  const perIntent = Math.max(1, Math.floor(cap / INTENTS.length));
  const queries = [];

  INTENTS.forEach((intent, intentIdx) => {
    const offset = intentIdx * perIntent; // rotate the starting pair per intent for even coverage
    for (let k = 0; k < perIntent && queries.length < cap; k++) {
      const pairIdx = (offset + k) % totalPairs;
      const service = services[pairIdx % services.length];
      const city = cities[Math.floor(pairIdx / services.length) % cities.length];
      queries.push({ query: buildQueryText(service, city, intent), service, city, intent });
    }
  });

  return queries.slice(0, cap);
}

/** Lowercase, strip punctuation to spaces, collapse whitespace. */
function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Normalized word-boundary matching of businessName + nameVariants against
 * answer text. We do NOT trust the model to self-report — this is the sole
 * source of truth for `client_mentioned`.
 */
function detectMention(text, businessName, nameVariants) {
  const normText = normalize(text);
  if (!normText) return false;
  const candidates = [businessName, ...(Array.isArray(nameVariants) ? nameVariants : [])].filter(Boolean);
  return candidates.some((name) => {
    const normName = normalize(name);
    if (!normName) return false;
    const escaped = normName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|\\s)${escaped}(\\s|$)`);
    return pattern.test(normText);
  });
}

const NAME_STOPWORDS = new Set([
  'the', 'this', 'that', 'these', 'those', 'here', 'there', 'when', 'where',
  'what', 'which', 'who', 'how', 'why', 'if', 'and', 'or', 'but', 'for',
  'from', 'with', 'about', 'near', 'you', 'your', 'their', 'they', 'it',
  'its', 'we', 'our', 'i', 'in', 'on', 'at', 'a', 'an', 'is', 'are', 'was',
  'were', 'be', 'been', 'to', 'of', 'as', 'by', 'mn', 'minnesota',
]);

/**
 * Structured follow-up parse: a second, cheap regex pass over the answer
 * text (not a second API call) that pulls out capitalized multi-word
 * sequences likely to be business names — a supplement to whatever
 * groundingChunks the grounding metadata already gave us, since not every
 * name the model surfaces is backed by a citation.
 */
function extractNamesFromText(text) {
  if (!text) return [];
  const matches = String(text).match(/\b([A-Z][a-zA-Z''&-]*(?:\s+[A-Z][a-zA-Z''&-]*){1,4})\b/g) || [];
  const seen = new Set();
  const names = [];
  for (const m of matches) {
    const trimmed = m.trim();
    const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
    if (NAME_STOPWORDS.has(firstWord)) continue;
    if (trimmed.length < 4) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(trimmed);
    if (names.length >= 8) break;
  }
  return names;
}

function extractFromGrounding(candidate) {
  const chunks = (candidate && candidate.groundingMetadata && candidate.groundingMetadata.groundingChunks) || [];
  const urls = [];
  const names = [];
  for (const chunk of chunks) {
    if (chunk && chunk.web) {
      if (chunk.web.uri) urls.push(chunk.web.uri);
      if (chunk.web.title) names.push(chunk.web.title);
    }
  }
  return { urls, names };
}

function dedupe(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSingleQuery(q, clientConfig, apiKey) {
  const prompt = `Answer this exactly like a helpful local search assistant would, based on real, current web results: "${q.query}". Name specific local businesses if you can find them, and be concrete (no filler). Keep it to a short paragraph.`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
  };

  const res = await fetchWithTimeout(
    `${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    FETCH_TIMEOUT_MS,
  );

  if (!res.ok) {
    throw new Error(`Gemini API HTTP ${res.status}`);
  }

  const data = await res.json();
  const candidate = data && data.candidates && data.candidates[0];
  const text = candidate && candidate.content && candidate.content.parts
    ? candidate.content.parts.map((p) => p.text || '').join(' ')
    : '';

  const grounded = extractFromGrounding(candidate);
  const textNames = extractNamesFromText(text);
  const mentioned_names = dedupe([...grounded.names, ...textNames]);
  const cited_urls = dedupe(grounded.urls);
  const client_mentioned = detectMention(text, clientConfig.business_name, clientConfig.name_variants);
  const answer_summary = text.length > 240 ? `${text.slice(0, 237).trim()}…` : text.trim();

  return {
    query: q.query,
    service: q.service,
    city: q.city,
    intent: q.intent,
    client_mentioned,
    mentioned_names,
    cited_urls,
    answer_summary,
  };
}

/**
 * Runs the full query battery sequentially (small delay between calls) with
 * a per-query try/catch — one failed query is recorded with an error note,
 * never fatal to the run. Missing GEMINI_API_KEY skips the whole collector.
 */
async function runBattery(clientConfig, { cap = DEFAULT_CAP } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  const queries = generateQueries(clientConfig, cap);
  const run_at = new Date().toISOString();

  if (!apiKey) {
    return { run_at, engine: 'gemini_grounded', skipped: true, reason: 'missing_api_key', mention_rate: 0, queries: [] };
  }
  if (!queries.length) {
    return { run_at, engine: 'gemini_grounded', skipped: true, reason: 'no_services_or_cities', mention_rate: 0, queries: [] };
  }

  const results = [];
  for (const q of queries) {
    try {
      results.push(await runSingleQuery(q, clientConfig, apiKey));
    } catch (err) {
      results.push({
        query: q.query,
        service: q.service,
        city: q.city,
        intent: q.intent,
        client_mentioned: false,
        mentioned_names: [],
        cited_urls: [],
        answer_summary: '',
        error: (err && err.message) || String(err),
      });
    }
    await sleep(QUERY_DELAY_MS);
  }

  const mentioned = results.filter((r) => r.client_mentioned).length;
  return {
    run_at,
    engine: 'gemini_grounded',
    skipped: false,
    mention_rate: results.length ? Number((mentioned / results.length).toFixed(4)) : 0,
    queries: results,
  };
}

module.exports = {
  runBattery,
  generateQueries,
  normalize,
  detectMention,
  extractNamesFromText,
  buildQueryText,
  INTENTS,
};
