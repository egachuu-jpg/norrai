'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { renderReport } = require('../lib/report.js');
const fixture = require(path.join(__dirname, '..', 'fixtures', 'sample-audit-result.json'));

// Deep clone so each test can mutate its own copy without touching the frozen fixture.
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const PILLAR_LABELS = [
  'Google Business Profile',
  'Reputation',
  'Website Answerability',
  'Citations',
  'AI Answer Presence',
];

test('renders the canonical fixture with all required elements', () => {
  const html = renderReport(fixture);

  assert.equal(typeof html, 'string');
  assert.match(html, /^<!doctype html>/i);
  assert.ok(html.includes('507 Air Heating &amp; Cooling'), 'business name present (escaped)');
  assert.ok(html.includes('>31<'), 'total score rendered');

  for (const label of PILLAR_LABELS) {
    assert.ok(html.includes(label), `pillar label "${label}" present`);
  }

  assert.ok(html.includes('Cannon Valley Heating &amp; Air'), 'a competitor name is present');
  assert.ok(
    html.includes('best furnace repair near Faribault MN'),
    'a battery query is present',
  );
});

test('unassessed pillar renders "Pending" and produces no NaN', () => {
  const html = renderReport(fixture);

  // The canonical fixture already has an unassessed pillar (citations).
  assert.ok(html.includes('Pending'), 'unassessed pillar shows a Pending state');
  assert.ok(!html.includes('NaN'), 'no NaN leaks into the rendered output');
});

test('fully unassessed pillars (no checks at all) still render without NaN', () => {
  const data = clone(fixture);
  for (const key of Object.keys(data.scores.pillars)) {
    data.scores.pillars[key] = { score: 0, max: data.scores.pillars[key].max, assessed: false, checks: [] };
  }
  const html = renderReport(data);
  assert.ok(!html.includes('NaN'));
  assert.ok(html.includes('Pending'));
});

test('empty battery.queries and empty competitors do not throw', () => {
  const data = clone(fixture);
  data.battery.queries = [];
  data.competitors = [];

  assert.doesNotThrow(() => {
    const html = renderReport(data);
    assert.ok(!html.includes('NaN'));
    assert.ok(html.length > 0);
  });
});

test('missing/null meta.place_id and minimal shapes do not throw', () => {
  const data = clone(fixture);
  data.meta.place_id = null;
  assert.doesNotThrow(() => renderReport(data));

  // Also verify a maximally sparse object survives.
  assert.doesNotThrow(() => renderReport({}));
});

test('meta.partial=true renders a partial-audit notice with skipped collectors', () => {
  const data = clone(fixture);
  data.meta.partial = true;
  data.meta.skipped_collectors = ['pagespeed', 'battery'];

  const html = renderReport(data);
  assert.ok(html.includes('Partial audit'));
  assert.ok(html.includes('pagespeed'));
  assert.ok(html.includes('battery'));
});

test('output never contains a <script> tag', () => {
  const html = renderReport(fixture);
  assert.equal((html.match(/<script/gi) || []).length, 0);
});

test('HTML in business name is escaped, not injected', () => {
  const data = clone(fixture);
  data.meta.business_name = '<b>Evil</b> & "Sons" \'Co\'';

  const html = renderReport(data);
  assert.ok(!html.includes('<b>Evil</b>'), 'raw tag must not appear unescaped');
  assert.ok(html.includes('&lt;b&gt;Evil&lt;/b&gt;'), 'tag is escaped');
  assert.ok(html.includes('&amp;'), 'ampersand escaped');
  assert.ok(html.includes('&quot;Sons&quot;'), 'double quotes escaped');
});

test('HTML in query battery / competitor data is escaped', () => {
  const data = clone(fixture);
  data.competitors[0].name = '<img src=x onerror=alert(1)>Bad Co';
  data.battery.queries[0].answer_summary = '<script>alert(1)</script> summary';
  data.battery.queries[0].mentioned_names = ['<i>Injected</i>'];

  const html = renderReport(data);
  assert.equal((html.match(/<script>/gi) || []).length, 0);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<i>Injected</i>'));
  assert.ok(html.includes('&lt;i&gt;Injected&lt;/i&gt;'));
});
