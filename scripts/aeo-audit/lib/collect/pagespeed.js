'use strict';

/**
 * PageSpeed Insights (mobile) collector. PAGESPEED_API_KEY is optional —
 * the PSI v5 API works unauthenticated at a lower quota, so we still try
 * without a key. Any failure (network, quota, malformed response) degrades
 * to a skipped collector; never throws.
 */

const PSI_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const FETCH_TIMEOUT_MS = 25000;

async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** @returns {Promise<object>} raw.pagespeed shape */
async function collectPagespeed(website) {
  if (!website) {
    return { skipped: true, reason: 'no_website', mobile: null };
  }

  const params = new URLSearchParams({ url: website, strategy: 'mobile', category: 'performance' });
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (apiKey) params.set('key', apiKey);

  try {
    const res = await fetchWithTimeout(`${PSI_URL}?${params.toString()}`, { method: 'GET' });
    if (!res.ok) throw new Error(`PageSpeed HTTP ${res.status}`);
    const data = await res.json();
    const audits = data && data.lighthouseResult && data.lighthouseResult.audits;
    const perf = data && data.lighthouseResult && data.lighthouseResult.categories && data.lighthouseResult.categories.performance;
    if (!audits) throw new Error('PageSpeed response missing lighthouseResult.audits');

    return {
      skipped: false,
      mobile: {
        lcp_ms: audits['largest-contentful-paint'] ? Math.round(audits['largest-contentful-paint'].numericValue) : null,
        cls: audits['cumulative-layout-shift'] ? audits['cumulative-layout-shift'].numericValue : null,
        performance_score: perf && typeof perf.score === 'number' ? perf.score : null,
      },
    };
  } catch (err) {
    return { skipped: true, reason: 'fetch_failed', error: (err && err.message) || String(err), mobile: null };
  }
}

module.exports = { collectPagespeed };
