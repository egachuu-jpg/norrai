'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { scoreAudit } = require('../lib/scoring');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const clientConfig = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'sample-client.json'), 'utf8'));
const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'sample-raw.json'), 'utf8'));

test('scoreAudit produces the contract-shaped audit-result', () => {
  const result = scoreAudit(clientConfig, raw);

  assert.equal(typeof result.meta.generated_at, 'string');
  assert.equal(result.meta.engine_version, '1.0.0');
  assert.equal(result.meta.business_name, '507 Air Heating & Cooling');
  assert.equal(result.meta.place_id, null);
  assert.deepEqual(result.meta.skipped_collectors, []);
  assert.equal(result.meta.partial, false);

  const pillarNames = ['gbp', 'reputation', 'website', 'citations', 'ai_presence'];
  for (const name of pillarNames) {
    const pillar = result.scores.pillars[name];
    assert.ok(pillar, `pillar ${name} exists`);
    const summedFromChecks = pillar.checks.reduce((sum, c) => sum + c.points, 0);
    assert.equal(pillar.score, summedFromChecks, `${name} pillar score sums from its checks`);
    for (const check of pillar.checks) {
      assert.ok(check.points <= check.max_points, `${name}.${check.id} points never exceed max_points`);
      assert.ok(check.points >= 0, `${name}.${check.id} points are never negative`);
    }
  }

  const summedPillarMax = Object.values(result.scores.pillars).reduce((s, p) => s + p.max, 0);
  assert.equal(summedPillarMax, 100, 'pillar maxes sum to 100');

  const summedTotal = Object.values(result.scores.pillars).reduce((s, p) => s + p.score, 0);
  assert.equal(result.scores.total, summedTotal, 'total sums from pillar scores');
});

test('gbp pillar is unassessed (place_id null, no client place data) and contributes 0', () => {
  const result = scoreAudit(clientConfig, raw);
  assert.equal(result.scores.pillars.gbp.assessed, false);
  assert.equal(result.scores.pillars.gbp.score, 0);
  assert.ok(result.scores.pillars.gbp.checks.every((c) => c.assessed === false));
});

test('citations pillar is unassessed and contributes 0 when clientConfig.citations is empty', () => {
  const noCitationsConfig = { ...clientConfig, citations: [] };
  const result = scoreAudit(noCitationsConfig, raw);
  assert.equal(result.scores.pillars.citations.assessed, false);
  assert.equal(result.scores.pillars.citations.score, 0);
  assert.deepEqual(result.scores.pillars.citations.checks, []);
  // unassessed pillar contributes 0 to total, not a share of its max
  const otherPillarsTotal = Object.entries(result.scores.pillars)
    .filter(([name]) => name !== 'citations')
    .reduce((s, [, p]) => s + p.score, 0);
  assert.equal(result.scores.total, otherPillarsTotal);
});

test('citations pillar is assessed when clientConfig.citations is populated, full points require listed && nap_match', () => {
  const result = scoreAudit(clientConfig, raw);
  const citations = result.scores.pillars.citations;
  assert.equal(citations.assessed, true);
  const yelp = citations.checks.find((c) => c.id === 'cit_yelp');
  const facebook = citations.checks.find((c) => c.id === 'cit_facebook');
  // sample-client.json: Yelp listed:true, nap_match:false -> 0 points
  assert.equal(yelp.assessed, true);
  assert.equal(yelp.points, 0);
  // sample-client.json: Facebook listed:true, nap_match:true -> full points
  assert.equal(facebook.assessed, true);
  assert.equal(facebook.points, facebook.max_points);
  // directories the operator never filled in are assessed:false
  const bbb = citations.checks.find((c) => c.id === 'cit_bbb');
  assert.equal(bbb.assessed, false);
  assert.equal(bbb.points, 0);
  // check ids/labels/max_points sum to the pillar max (15)
  const maxSum = citations.checks.reduce((s, c) => s + c.max_points, 0);
  assert.equal(maxSum, 15);
});

test('ai_presence score = round(mention_rate * 10) from battery results in raw', () => {
  const result = scoreAudit(clientConfig, raw);
  const mentioned = raw.battery.queries.filter((q) => q.client_mentioned).length;
  const rate = mentioned / raw.battery.queries.length;
  const expectedPoints = Math.round(rate * 10);
  assert.equal(result.scores.pillars.ai_presence.score, expectedPoints);
  assert.equal(result.scores.pillars.ai_presence.assessed, true);
});

test('ai_presence pillar is unassessed and contributes 0 when battery has no queries', () => {
  const noBatteryRaw = { ...raw, battery: { skipped: true, queries: [] } };
  const result = scoreAudit(clientConfig, noBatteryRaw);
  assert.equal(result.scores.pillars.ai_presence.assessed, false);
  assert.equal(result.scores.pillars.ai_presence.score, 0);
});

test('gbp pillar is assessed and scored when place data is present', () => {
  const rawWithPlace = {
    ...raw,
    places: {
      skipped: false,
      competitor_search: raw.places.competitor_search,
      competitors: raw.places.competitors,
      client: {
        place_id: 'ChIJFIXTURE_PLACEID_000',
        name: '507 Air Heating & Cooling',
        primary_category: 'HVAC contractor',
        phone: '(507) 491-3063',
        rating: 4.9,
        user_ratings_total: 12,
        business_status: 'OPERATIONAL',
        opening_hours_set: true,
        photos_count: 4,
      },
    },
  };
  const result = scoreAudit(clientConfig, rawWithPlace);
  const gbp = result.scores.pillars.gbp;
  assert.equal(gbp.assessed, true);
  const verified = gbp.checks.find((c) => c.id === 'gbp_verified');
  assert.equal(verified.points, 3); // OPERATIONAL -> full points
  const category = gbp.checks.find((c) => c.id === 'gbp_primary_category');
  assert.equal(category.points, 4); // "HVAC contractor" matches hvac vertical mapping
  const photos = gbp.checks.find((c) => c.id === 'gbp_photos');
  assert.equal(photos.points, 0); // 4 photos < 10 threshold
  const services = gbp.checks.find((c) => c.id === 'gbp_services_listed');
  assert.equal(services.assessed, false); // never available via Places API
});

test('meta.partial and meta.skipped_collectors reflect collector skip flags', () => {
  const partialRaw = {
    ...raw,
    pagespeed: { skipped: true, reason: 'fetch_failed', mobile: null },
    battery: { skipped: true, reason: 'missing_api_key', queries: [] },
  };
  const result = scoreAudit(clientConfig, partialRaw);
  assert.equal(result.meta.partial, true);
  assert.deepEqual(result.meta.skipped_collectors.sort(), ['battery', 'pagespeed']);
});

test('check ids are stable snake_case strings prefixed by pillar', () => {
  const result = scoreAudit(clientConfig, raw);
  const prefixes = { gbp: 'gbp_', reputation: 'rep_', website: 'web_', citations: 'cit_', ai_presence: 'ai_' };
  const rawWithClient = {
    ...raw,
    places: { ...raw.places, client: { place_id: 'x', business_status: 'OPERATIONAL', opening_hours_set: true, photos_count: 1, rating: 4.9, user_ratings_total: 5 } },
  };
  const full = scoreAudit(clientConfig, rawWithClient);
  for (const [pillarName, prefix] of Object.entries(prefixes)) {
    for (const check of full.scores.pillars[pillarName].checks) {
      assert.ok(check.id.startsWith(prefix), `${check.id} should start with ${prefix}`);
      assert.match(check.id, /^[a-z0-9_]+$/);
    }
  }
});
