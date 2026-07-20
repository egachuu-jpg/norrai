'use strict';

/**
 * Pure scoring: (clientConfig, raw) -> audit-result JSON (see CONTRACT.md).
 *
 * No I/O, no network, no Date-dependent branching other than stamping
 * `generated_at` on the output (tests should assert shape, not the value).
 */

const ENGINE_VERSION = '1.0.0';

const PILLAR_MAX = {
  gbp: 25,
  reputation: 25,
  website: 25,
  citations: 15,
  ai_presence: 10,
};

// GBP category we expect Places API's primaryTypeDisplayName to roughly
// match, per vertical. Extend as new verticals are onboarded.
const EXPECTED_CATEGORY = {
  hvac: 'HVAC contractor',
  plumbing: 'Plumber',
  electrical: 'Electrician',
  construction: 'General contractor',
  remodeling: 'General contractor',
};

const LOCALBUSINESS_JSONLD_TYPES = [
  'LocalBusiness',
  'HVACBusiness',
  'Plumber',
  'Electrician',
  'GeneralContractor',
  'HomeAndConstructionBusiness',
  'Contractor',
  'ProfessionalService',
];

// The seven directories the PRD's citations pillar checks. Point split is
// the engine's choice (not pinned by the canonical fixture, which shows an
// unassessed/empty citations pillar) but must sum to the pillar max (15).
const CITATION_DIRECTORIES = [
  { id: 'cit_bing', label: 'Bing Places listing, NAP match', directory: 'Bing Places', max_points: 2 },
  { id: 'cit_apple_maps', label: 'Apple Maps listing, NAP match', directory: 'Apple Maps', max_points: 2 },
  { id: 'cit_yelp', label: 'Yelp listing, NAP match', directory: 'Yelp', max_points: 2 },
  { id: 'cit_facebook', label: 'Facebook listing, NAP match', directory: 'Facebook', max_points: 2 },
  { id: 'cit_bbb', label: 'BBB listing, NAP match', directory: 'BBB', max_points: 2 },
  { id: 'cit_angi', label: 'Angi listing, NAP match', directory: 'Angi', max_points: 2 },
  { id: 'cit_nextdoor', label: 'Nextdoor listing, NAP match', directory: 'Nextdoor', max_points: 3 },
];

function mkCheck(id, label, maxPoints, { assessed, points, value, note } = {}) {
  const check = {
    id,
    label,
    points: assessed ? clamp(points || 0, 0, maxPoints) : 0,
    max_points: maxPoints,
    assessed: !!assessed,
    value: value === undefined ? null : value,
  };
  if (note) check.note = note;
  return check;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function median(nums) {
  const arr = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n)).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function normalizeDirName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function pillarFromChecks(checks, max) {
  const anyAssessed = checks.some((c) => c.assessed);
  const score = checks.reduce((sum, c) => sum + (c.points || 0), 0);
  return { score, max, assessed: anyAssessed, checks };
}

// ---- GBP -------------------------------------------------------------

function scoreGbp(clientConfig, raw) {
  const client = raw && raw.places && raw.places.client ? raw.places.client : null;

  if (!client) {
    const note = 'no GBP place data (place_id null, lookup failed, or collector skipped)';
    const checks = [
      mkCheck('gbp_verified', 'Profile verified', 3, { assessed: false, note }),
      mkCheck('gbp_primary_category', 'Correct primary category', 4, { assessed: false, note }),
      mkCheck('gbp_services_listed', '≥ 8 services listed', 3, { assessed: false, note }),
      mkCheck('gbp_hours', 'Hours set', 2, { assessed: false, note }),
      mkCheck('gbp_attributes', 'Attributes set (emergency, language, estimates)', 2, { assessed: false, note }),
      mkCheck('gbp_photos', '≥10 photos, one in last 60 days', 3, { assessed: false, note }),
      mkCheck('gbp_recent_post', 'Post in last 30 days', 4, { assessed: false, note }),
      mkCheck('gbp_qna_seeded', 'Q&A section seeded', 4, { assessed: false, note }),
    ];
    return pillarFromChecks(checks, PILLAR_MAX.gbp);
  }

  const expectedCategory = EXPECTED_CATEGORY[clientConfig.vertical] || null;
  const category = client.primary_category || null;
  const categoryMatch = expectedCategory && category
    ? category.toLowerCase().includes(expectedCategory.toLowerCase())
    : false;

  const checks = [
    mkCheck('gbp_verified', 'Profile verified', 3, {
      assessed: true,
      points: client.business_status === 'OPERATIONAL' ? 3 : 0,
      value: client.business_status || 'unknown',
      note: 'proxy: Places API businessStatus (true verification state requires the GBP dashboard)',
    }),
    mkCheck('gbp_primary_category', 'Correct primary category', 4, {
      assessed: true,
      points: categoryMatch ? 4 : 0,
      value: category || 'not returned by Places API',
      note: expectedCategory
        ? (categoryMatch ? undefined : `expected category containing "${expectedCategory}"`)
        : `no expected-category mapping for vertical "${clientConfig.vertical}"`,
    }),
    mkCheck('gbp_services_listed', '≥ 8 services listed', 3, {
      assessed: false,
      note: 'GBP services list requires the Business Profile API or a manual check (not exposed by Places API)',
    }),
    mkCheck('gbp_hours', 'Hours set', 2, {
      assessed: true,
      points: client.opening_hours_set ? 2 : 0,
      value: client.opening_hours_set ? 'hours set' : 'not set',
    }),
    mkCheck('gbp_attributes', 'Attributes set (emergency, language, estimates)', 2, {
      assessed: false,
      note: 'GBP attributes require the Business Profile API or a manual check (not exposed by Places API)',
    }),
    mkCheck('gbp_photos', '≥10 photos, one in last 60 days', 3, {
      assessed: true,
      points: (client.photos_count || 0) >= 10 ? 3 : 0,
      value: `${client.photos_count || 0} photos`,
      note: 'photo recency (last 60d) is not exposed by Places API; count only',
    }),
    mkCheck('gbp_recent_post', 'Post in last 30 days', 4, {
      assessed: false,
      note: 'GBP posts require the Business Profile API or a manual check (not exposed by Places API)',
    }),
    mkCheck('gbp_qna_seeded', 'Q&A section seeded', 4, {
      assessed: false,
      note: 'GBP Q&A requires the Business Profile API or a manual check (not exposed by Places API)',
    }),
  ];
  return pillarFromChecks(checks, PILLAR_MAX.gbp);
}

// ---- Reputation --------------------------------------------------------

function scoreReputation(clientConfig, raw) {
  const client = raw && raw.places && raw.places.client ? raw.places.client : null;
  const competitors = (raw && raw.places && raw.places.competitors) || [];

  const reviewCountAssessed = !!client && competitors.length > 0;
  let reviewCountPoints = 0;
  let reviewCountValue = 'insufficient data (need client review count + competitors)';
  if (reviewCountAssessed) {
    const competitorMedian = median(competitors.map((c) => c.review_count || 0));
    const ratio = competitorMedian > 0 ? (client.user_ratings_total || 0) / competitorMedian : 1;
    reviewCountPoints = Math.round(clamp(ratio, 0, 1) * 8);
    reviewCountValue = `${client.user_ratings_total || 0} vs competitor median ${competitorMedian}`;
  }

  const ratingAssessed = !!client && typeof client.rating === 'number';
  let ratingPoints = 0;
  if (ratingAssessed) {
    if (client.rating >= 4.6) ratingPoints = 5;
    else if (client.rating >= 4.0) ratingPoints = 3;
    else if (client.rating > 0) ratingPoints = 1;
  }

  const checks = [
    mkCheck('rep_review_count', 'Review count vs top-3 competitors', 8, {
      assessed: reviewCountAssessed,
      points: reviewCountPoints,
      value: reviewCountValue,
    }),
    mkCheck('rep_rating', 'Average rating ≥4.6', 5, {
      assessed: ratingAssessed,
      points: ratingPoints,
      value: ratingAssessed ? client.rating : 'unknown',
    }),
    mkCheck('rep_velocity', 'Review velocity ≥4/mo', 6, {
      assessed: false,
      note: 'requires review-date history; not available from a single Places API snapshot (needs month-over-month tracking or GBP API)',
    }),
    mkCheck('rep_response_rate', 'Owner responds to reviews within 48h', 6, {
      assessed: false,
      note: 'owner reply data is not exposed by Places API; requires GBP API or a manual check',
    }),
  ];
  return pillarFromChecks(checks, PILLAR_MAX.reputation);
}

// ---- Website -----------------------------------------------------------

function scoreWebsite(clientConfig, raw) {
  const site = (raw && raw.site) || null;
  const pagespeed = (raw && raw.pagespeed) || null;

  if (!site || site.skipped) {
    const note = site && site.reason ? `site collector skipped: ${site.reason}` : 'website not collected';
    const checks = [
      mkCheck('web_schema_localbusiness', 'Valid LocalBusiness/HVACBusiness JSON-LD', 5, { assessed: false, note }),
      mkCheck('web_schema_faq', 'FAQPage JSON-LD present', 3, { assessed: false, note }),
      mkCheck('web_faq_content', 'FAQ content per core service', 4, { assessed: false, note }),
      mkCheck('web_city_pages', 'Service+city pages for top towns', 4, { assessed: false, note }),
      mkCheck('web_nap_match', 'NAP exact-match with GBP', 3, { assessed: false, note }),
      mkCheck('web_entity_signals', 'Entity signals (license, years, brands)', 3, { assessed: false, note }),
      mkCheck('web_mobile_cwv', 'Mobile-friendly + Core Web Vitals', 3, { assessed: false, note }),
    ];
    return pillarFromChecks(checks, PILLAR_MAX.website);
  }

  const jsonldTypes = site.jsonld_types || [];
  const hasLocalBusiness = LOCALBUSINESS_JSONLD_TYPES.some((t) => jsonldTypes.includes(t));
  const hasFaqSchema = jsonldTypes.includes('FAQPage');

  const totalServices = (clientConfig.services || []).length;
  const matchedServices = (site.faq && site.faq.services_matched) || [];
  let faqPoints = 0;
  let faqValue = 'no FAQ content found';
  if (totalServices > 0 && matchedServices.length > 0) {
    faqPoints = Math.round(4 * clamp(matchedServices.length / totalServices, 0, 1));
    faqValue = `${matchedServices.length} of ${totalServices} services have FAQ content`;
  } else if (site.faq && site.faq.has_faq_page) {
    faqPoints = 1;
    faqValue = 'general FAQ exists, not per-service';
  }

  const totalCities = (clientConfig.cities || []).length;
  const matchedCities = site.city_pages || [];
  const cityPoints = totalCities > 0 ? Math.round(4 * clamp(matchedCities.length / totalCities, 0, 1)) : 0;

  const napAssessed = !!(site.nap && site.nap.matches_gbp !== null && site.nap.matches_gbp !== undefined);
  const napPoints = napAssessed && site.nap.matches_gbp ? 3 : 0;
  const napValue = site.nap && site.nap.phone
    ? (napAssessed ? (site.nap.matches_gbp ? 'match' : 'mismatch') : 'GBP phone unavailable for comparison')
    : 'no phone found on site';

  const entitySignals = site.entity_signals || [];
  const entityPoints = clamp(entitySignals.length, 0, 3);

  const pagespeedAssessed = !!(pagespeed && pagespeed.mobile && !pagespeed.skipped);
  let cwvPoints = 0;
  let cwvValue = 'not collected';
  if (pagespeedAssessed) {
    const { lcp_ms, cls, performance_score } = pagespeed.mobile;
    if (lcp_ms <= 2500 && cls <= 0.1 && performance_score >= 0.5) cwvPoints = 3;
    else if (lcp_ms <= 4000 && cls <= 0.25) cwvPoints = 1;
    cwvValue = `LCP ${lcp_ms}ms, CLS ${cls}, perf ${performance_score}`;
  }

  const checks = [
    mkCheck('web_schema_localbusiness', 'Valid LocalBusiness/HVACBusiness JSON-LD', 5, {
      assessed: true,
      points: hasLocalBusiness ? 5 : 0,
      value: hasLocalBusiness ? jsonldTypes.join(', ') : 'no LocalBusiness-family JSON-LD found',
    }),
    mkCheck('web_schema_faq', 'FAQPage JSON-LD present', 3, {
      assessed: true,
      points: hasFaqSchema ? 3 : 0,
      value: hasFaqSchema ? 'FAQPage present' : 'none',
    }),
    mkCheck('web_faq_content', 'FAQ content per core service', 4, {
      assessed: true,
      points: faqPoints,
      value: faqValue,
    }),
    mkCheck('web_city_pages', 'Service+city pages for top towns', 4, {
      assessed: true,
      points: cityPoints,
      value: `${matchedCities.length} of ${totalCities} target towns`,
    }),
    mkCheck('web_nap_match', 'NAP exact-match with GBP', 3, {
      assessed: napAssessed,
      points: napPoints,
      value: napValue,
    }),
    mkCheck('web_entity_signals', 'Entity signals (license, years, brands)', 3, {
      assessed: true,
      points: entityPoints,
      value: entitySignals.length ? entitySignals.join(', ') : 'none found',
    }),
    mkCheck('web_mobile_cwv', 'Mobile-friendly + Core Web Vitals', 3, {
      assessed: pagespeedAssessed,
      points: cwvPoints,
      value: cwvValue,
    }),
  ];
  return pillarFromChecks(checks, PILLAR_MAX.website);
}

// ---- Citations -----------------------------------------------------------

function scoreCitations(clientConfig) {
  const citations = clientConfig.citations || [];
  if (!citations.length) {
    return { score: 0, max: PILLAR_MAX.citations, assessed: false, checks: [] };
  }

  const checks = CITATION_DIRECTORIES.map((dir) => {
    const match = citations.find((c) => normalizeDirName(c.directory) === normalizeDirName(dir.directory));
    if (!match) {
      return mkCheck(dir.id, dir.label, dir.max_points, { assessed: false, note: 'not checked' });
    }
    const full = !!match.listed && !!match.nap_match;
    return mkCheck(dir.id, dir.label, dir.max_points, {
      assessed: true,
      points: full ? dir.max_points : 0,
      value: `listed: ${!!match.listed}, nap_match: ${!!match.nap_match}`,
    });
  });
  return pillarFromChecks(checks, PILLAR_MAX.citations);
}

// ---- AI presence -----------------------------------------------------------

function scoreAiPresence(raw) {
  const battery = (raw && raw.battery) || {};
  const queries = Array.isArray(battery.queries) ? battery.queries : [];
  if (battery.skipped || queries.length === 0) {
    return { score: 0, max: PILLAR_MAX.ai_presence, assessed: false, checks: [] };
  }
  const mentioned = queries.filter((q) => q.client_mentioned).length;
  const rate = queries.length ? mentioned / queries.length : 0;
  const points = Math.round(rate * 10);
  const check = mkCheck('ai_mention_rate', 'Mentioned in AI answers (query battery)', 10, {
    assessed: true,
    points,
    value: `${mentioned} of ${queries.length} queries (${Math.round(rate * 100)}%)`,
  });
  return { score: points, max: PILLAR_MAX.ai_presence, assessed: true, checks: [check] };
}

// ---- Top-level assembly -----------------------------------------------------------

function scoreAudit(clientConfig, raw) {
  clientConfig = clientConfig || {};
  raw = raw || {};

  const pillars = {
    gbp: scoreGbp(clientConfig, raw),
    reputation: scoreReputation(clientConfig, raw),
    website: scoreWebsite(clientConfig, raw),
    citations: scoreCitations(clientConfig),
    ai_presence: scoreAiPresence(raw),
  };

  const total = Object.values(pillars).reduce((sum, p) => sum + p.score, 0);

  const skipped_collectors = [];
  if (raw.places && raw.places.skipped) skipped_collectors.push('places');
  if (raw.site && raw.site.skipped) skipped_collectors.push('site');
  if (raw.pagespeed && raw.pagespeed.skipped) skipped_collectors.push('pagespeed');
  if (raw.battery && raw.battery.skipped) skipped_collectors.push('battery');

  const competitors = ((raw.places && raw.places.competitors) || []).slice(0, 3).map((c) => ({
    name: c.name || null,
    place_id: c.place_id || null,
    rating: c.rating === undefined ? null : c.rating,
    review_count: c.review_count === undefined ? null : c.review_count,
  }));

  const batteryQueries = (raw.battery && raw.battery.queries) || [];
  const mentionedCount = batteryQueries.filter((q) => q.client_mentioned).length;
  const battery = {
    run_at: (raw.battery && raw.battery.run_at) || null,
    engine: (raw.battery && raw.battery.engine) || 'gemini_grounded',
    mention_rate: batteryQueries.length ? Number((mentionedCount / batteryQueries.length).toFixed(4)) : 0,
    queries: batteryQueries,
  };

  return {
    meta: {
      business_name: clientConfig.business_name || null,
      client_id: null,
      website: clientConfig.website || null,
      place_id: clientConfig.place_id || null,
      vertical: clientConfig.vertical || null,
      generated_at: new Date().toISOString(),
      engine_version: ENGINE_VERSION,
      partial: skipped_collectors.length > 0,
      skipped_collectors,
    },
    scores: { total, pillars },
    competitors,
    battery,
    raw,
  };
}

module.exports = {
  scoreAudit,
  scoreGbp,
  scoreReputation,
  scoreWebsite,
  scoreCitations,
  scoreAiPresence,
  PILLAR_MAX,
  CITATION_DIRECTORIES,
  EXPECTED_CATEGORY,
  LOCALBUSINESS_JSONLD_TYPES,
};
