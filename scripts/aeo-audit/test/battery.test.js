'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { generateQueries, normalize, detectMention, extractNamesFromText, INTENTS } = require('../lib/collect/battery');

const clientConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample-client.json'), 'utf8'),
);

test('generateQueries caps at 20 and covers all four intents', () => {
  const queries = generateQueries(clientConfig);
  assert.ok(queries.length <= 20);
  assert.ok(queries.length > 0);

  const intentsSeen = new Set(queries.map((q) => q.intent));
  for (const intent of INTENTS) {
    assert.ok(intentsSeen.has(intent), `intent ${intent} should be covered`);
  }

  // sample-client.json has 4 services x 4 cities = 16 pairs, cap 20 -> exactly 5 per intent
  const perIntentCounts = {};
  for (const q of queries) perIntentCounts[q.intent] = (perIntentCounts[q.intent] || 0) + 1;
  for (const intent of INTENTS) {
    assert.equal(perIntentCounts[intent], 5, `${intent} should have even coverage`);
  }

  for (const q of queries) {
    assert.ok(clientConfig.services.includes(q.service));
    assert.ok(clientConfig.cities.includes(q.city));
    assert.equal(typeof q.query, 'string');
    assert.ok(q.query.length > 0);
  }
});

test('generateQueries respects a custom cap', () => {
  const queries = generateQueries(clientConfig, 8);
  assert.ok(queries.length <= 8);
});

test('generateQueries returns [] when services or cities are missing', () => {
  assert.deepEqual(generateQueries({ ...clientConfig, services: [] }), []);
  assert.deepEqual(generateQueries({ ...clientConfig, cities: [] }), []);
});

test('normalize lowercases and strips punctuation', () => {
  assert.equal(normalize('507-Air Heating & Cooling!'), '507 air heating cooling');
  assert.equal(normalize('  extra   spaces  '), 'extra spaces');
  assert.equal(normalize(null), '');
});

test('detectMention matches the exact business name, case-insensitively', () => {
  const text = 'For furnace repair, we recommend 507 Air Heating & Cooling — they answered fast.';
  assert.equal(detectMention(text, '507 Air Heating & Cooling', ['507 Air']), true);
});

test('detectMention matches punctuation-insensitively', () => {
  const text = 'Call 507-Air today for a free quote.';
  assert.equal(detectMention(text, '507 Air Heating & Cooling', ['507 Air']), true);
});

test('detectMention matches a shorter name variant', () => {
  const text = 'Try 507 AIR for your furnace — open 24/7.';
  assert.equal(detectMention(text, '507 Air Heating & Cooling', ['507 Air']), true);
});

test('detectMention returns false when the business is not named', () => {
  const text = 'We recommend Cannon Valley Heating & Air for this job.';
  assert.equal(detectMention(text, '507 Air Heating & Cooling', ['507 Air']), false);
});

test('detectMention does not false-positive on partial-word substrings', () => {
  // "507 Air" should not match inside an unrelated longer token
  const text = 'Visit 5075551234 for details, not a real match.';
  assert.equal(detectMention(text, '507 Air Heating & Cooling', ['507 Air']), false);
});

test('extractNamesFromText pulls capitalized multi-word candidates and drops stopwords', () => {
  const text = 'We recommend Cannon Valley Heating & Air. They have great reviews. The best choice locally.';
  const names = extractNamesFromText(text);
  assert.ok(names.some((n) => n.includes('Cannon Valley')));
  assert.ok(!names.some((n) => n.toLowerCase().startsWith('the ')));
});
