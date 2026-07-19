'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  analyzeSite,
  extractJsonLd,
  extractTypes,
  extractPhone,
  extractTitle,
  extractMetaDescription,
  discoverLinks,
} = require('../lib/collect/site');

const clientConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample-client.json'), 'utf8'),
);
const html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample-site.html'), 'utf8');

test('extractJsonLd finds and parses both JSON-LD blocks', () => {
  const blocks = extractJsonLd(html);
  assert.equal(blocks.length, 2);
});

test('extractTypes detects the LocalBusiness-family type and FAQPage', () => {
  const types = extractTypes(extractJsonLd(html));
  assert.ok(types.includes('HVACBusiness'));
  assert.ok(types.includes('FAQPage'));
});

test('extractJsonLd tolerates malformed JSON-LD without throwing', () => {
  const broken = '<script type="application/ld+json">{ not valid json </script>';
  assert.doesNotThrow(() => extractJsonLd(broken));
  assert.deepEqual(extractJsonLd(broken), []);
});

test('extractPhone finds the NAP phone number', () => {
  assert.equal(extractPhone(html), '(507) 491-3063');
});

test('extractTitle and extractMetaDescription pull homepage metadata', () => {
  assert.equal(extractTitle(html), '507 Air Heating & Cooling | Faribault MN HVAC');
  assert.match(extractMetaDescription(html), /furnace repair/i);
});

test('discoverLinks finds same-origin nav links and excludes external + asset links', () => {
  const links = discoverLinks(html, 'https://507air.com/');
  const paths = links.map((l) => new URL(l).pathname);
  assert.ok(paths.includes('/services.html'));
  assert.ok(paths.includes('/about.html'));
  assert.ok(paths.includes('/contact.html'));
  assert.ok(paths.includes('/faribault-hvac.html'));
  assert.ok(!links.some((l) => l.includes('facebook.com')), 'external links excluded');
});

test('analyzeSite: full pipeline against the fixture page', () => {
  const pages = [{ url: 'https://507air.com/', html }];
  const raw = analyzeSite({ pages, config: clientConfig, gbpPhone: '(507) 491-3063' });

  assert.equal(raw.jsonld_blocks, 2);
  assert.ok(raw.jsonld_types.includes('HVACBusiness'));
  assert.ok(raw.jsonld_types.includes('FAQPage'));

  assert.equal(raw.nap.phone, '(507) 491-3063');
  assert.equal(raw.nap.matches_gbp, true);

  assert.ok(raw.entity_signals.includes('license'));
  assert.ok(raw.entity_signals.includes('years_in_business'));
  assert.ok(raw.entity_signals.includes('brands'));

  assert.equal(raw.faq.has_faq_page, true);
  assert.ok(raw.faq.services_matched.includes('furnace repair'));
  assert.ok(raw.faq.services_matched.includes('AC installation'));

  assert.ok(raw.city_pages.some((cp) => cp.city === 'Faribault'));
});

test('analyzeSite: NAP mismatch is detected when phone differs from GBP', () => {
  const pages = [{ url: 'https://507air.com/', html }];
  const raw = analyzeSite({ pages, config: clientConfig, gbpPhone: '(555) 000-0000' });
  assert.equal(raw.nap.matches_gbp, false);
});

test('analyzeSite: matches_gbp is null when no GBP phone is available to compare', () => {
  const pages = [{ url: 'https://507air.com/', html }];
  const raw = analyzeSite({ pages, config: clientConfig, gbpPhone: null });
  assert.equal(raw.nap.matches_gbp, null);
});
