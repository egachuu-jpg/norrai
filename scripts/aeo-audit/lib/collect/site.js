'use strict';

/**
 * Website collector: fetch homepage + up to ~5 same-origin pages discovered
 * from nav links, parse with regex/string ops (no DOM libs).
 *
 * The network part (`collectSite`) and the pure parsing part (`analyzeSite`
 * + the individual extract* helpers) are split so tests can exercise the
 * parser against fixtures/sample-site.html without hitting the network.
 */

const FETCH_TIMEOUT_MS = 10000;
const MAX_EXTRA_PAGES = 5;

const LOCALBUSINESS_LIKE_HINT = /(local\s*business|hvac|plumb|electric|contractor|service)/i;

const BRAND_KEYWORDS = [
  'trane', 'carrier', 'lennox', 'goodman', 'rheem', 'bryant',
  'american standard', 'york', 'mitsubishi', 'daikin', 'rudd',
];

// ---- pure parsing helpers -----------------------------------------------

/** Finds all <script type="application/ld+json"> blocks and JSON.parses each, flattening arrays and @graph. */
function extractJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      continue; // malformed JSON-LD — skip, don't crash
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (item && Array.isArray(item['@graph'])) {
        blocks.push(...item['@graph']);
      } else if (item) {
        blocks.push(item);
      }
    }
  }
  return blocks;
}

/** Unique @type strings across a list of parsed JSON-LD objects. */
function extractTypes(jsonldObjects) {
  const types = new Set();
  for (const obj of jsonldObjects) {
    if (!obj || !obj['@type']) continue;
    const t = obj['@type'];
    if (Array.isArray(t)) t.forEach((x) => types.add(x));
    else types.add(t);
  }
  return Array.from(types);
}

const PHONE_RE = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;

function extractPhone(html) {
  const m = html.match(PHONE_RE);
  return m ? m[0].trim() : null;
}

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

function extractMetaDescription(html) {
  let m = html.match(/<meta[^>]+name\s*=\s*["']description["'][^>]+content\s*=\s*["']([^"']*)["']/i);
  if (!m) m = html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+name\s*=\s*["']description["']/i);
  return m ? m[1].trim() : null;
}

function findEntitySignals(combinedText) {
  const signals = [];
  if (/license\s*#?\s*[:#]?\s*[a-z0-9-]{3,}/i.test(combinedText)) signals.push('license');
  if (/\b(since|established)\s+(19|20)\d{2}\b/i.test(combinedText) || /\b\d{1,3}\+?\s+years\b/i.test(combinedText)) {
    signals.push('years_in_business');
  }
  if (/\blicensed\s*(and|&)?\s*insured\b|\binsured\b/i.test(combinedText)) signals.push('insured');
  if (BRAND_KEYWORDS.some((b) => combinedText.toLowerCase().includes(b))) signals.push('brands');
  return signals;
}

/** Same-origin links discovered from href="" attributes, resolved against baseUrl, deduped. */
function discoverLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let m;
  const base = new URL(baseUrl);
  while ((m = re.exec(html)) !== null) {
    let resolved;
    try {
      resolved = new URL(m[1], baseUrl);
    } catch (e) {
      continue;
    }
    if (resolved.origin !== base.origin) continue;
    if (/\.(png|jpe?g|gif|svg|webp|css|js|pdf|ico)$/i.test(resolved.pathname)) continue;
    const key = resolved.pathname.replace(/\/+$/, '') || '/';
    if (key === base.pathname.replace(/\/+$/, '') || (key === '' && base.pathname === '/')) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(resolved.href);
  }
  return links;
}

function pathOf(url) {
  try {
    const u = new URL(url);
    return u.pathname === '' ? '/' : u.pathname;
  } catch (e) {
    return url;
  }
}

function containsWord(haystack, needle) {
  if (!needle) return false;
  const escaped = String(needle).toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return false;
  return new RegExp(escaped.replace(/\s+/g, '\\s+')).test(haystack.toLowerCase());
}

/**
 * Pure analysis over already-fetched pages.
 * @param {{pages: Array<{url:string, html:string}>, config: object, gbpPhone: ?string}} args
 */
function analyzeSite({ pages, config, gbpPhone }) {
  const combinedText = pages.map((p) => p.html).join('\n');
  const jsonldBlocks = pages.flatMap((p) => extractJsonLd(p.html));
  const jsonldTypes = extractTypes(jsonldBlocks);

  const homepage = pages[0] || { html: '' };
  const title = extractTitle(homepage.html);
  const metaDescription = extractMetaDescription(homepage.html);

  const phone = extractPhone(combinedText);
  let matchesGbp = null;
  if (phone && gbpPhone) matchesGbp = digitsOnly(phone) === digitsOnly(gbpPhone);

  const entitySignals = findEntitySignals(combinedText);

  const cities = (config && config.cities) || [];
  const services = (config && config.services) || [];
  const cityPages = [];
  for (const page of pages) {
    const hay = `${page.url} ${extractTitle(page.html) || ''} ${page.html}`;
    for (const city of cities) {
      if (cityPages.some((cp) => cp.city === city)) continue;
      if (!containsWord(hay, city)) continue;
      const serviceHit = services.some((svc) => {
        const term = String(svc).split(/\s+/)[0]; // e.g. "furnace" from "furnace repair"
        return containsWord(hay, term);
      });
      if (serviceHit) cityPages.push({ city, url: pathOf(page.url) });
    }
  }

  const faqPages = pages.filter((p) => {
    const hasFaqSchema = extractTypes(extractJsonLd(p.html)).includes('FAQPage');
    return hasFaqSchema || /faq/i.test(p.url) || /frequently\s+asked\s+questions/i.test(p.html);
  });
  const hasFaqPage = faqPages.length > 0;
  const faqText = faqPages.map((p) => p.html).join('\n');
  const servicesMatched = services.filter((svc) => containsWord(faqText, svc) || containsWord(faqText, String(svc).split(/\s+/)[0]));

  return {
    fetched_pages: pages.map((p) => pathOf(p.url)),
    jsonld_blocks: jsonldBlocks.length,
    jsonld_types: jsonldTypes,
    title,
    meta_description: metaDescription,
    nap: { phone, matches_gbp: matchesGbp },
    city_pages: cityPages,
    entity_signals: entitySignals,
    faq: { has_faq_page: hasFaqPage, services_matched: servicesMatched },
  };
}

// ---- network -----------------------------------------------------------

async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOk(url, timeoutMs = FETCH_TIMEOUT_MS) {
  try {
    const res = await fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function fetchPage(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const res = await fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** @returns {Promise<object>} raw.site shape */
async function collectSite(clientConfig, { gbpPhone } = {}) {
  const website = clientConfig.website;
  if (!website) {
    return { skipped: true, reason: 'no_website' };
  }

  let homepageHtml;
  try {
    homepageHtml = await fetchPage(website);
  } catch (err) {
    return { skipped: true, reason: 'fetch_failed', error: (err && err.message) || String(err) };
  }

  const pages = [{ url: website, html: homepageHtml }];

  const discovered = discoverLinks(homepageHtml, website).slice(0, MAX_EXTRA_PAGES);
  for (const link of discovered) {
    try {
      const html = await fetchPage(link);
      pages.push({ url: link, html });
    } catch (err) {
      // one bad page doesn't fail the collector
      continue;
    }
  }

  const base = new URL(website);
  const [sitemap, robots] = await Promise.all([
    fetchOk(new URL('/sitemap.xml', base).href),
    fetchOk(new URL('/robots.txt', base).href),
  ]);

  const analyzed = analyzeSite({ pages, config: clientConfig, gbpPhone });
  return { skipped: false, ...analyzed, sitemap, robots };
}

module.exports = {
  collectSite,
  analyzeSite,
  extractJsonLd,
  extractTypes,
  extractPhone,
  extractTitle,
  extractMetaDescription,
  findEntitySignals,
  discoverLinks,
};
