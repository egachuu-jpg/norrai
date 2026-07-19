#!/usr/bin/env node
'use strict';

/**
 * AEO Audit Engine CLI. See CONTRACT.md for the frozen interface.
 *
 *   node scripts/aeo-audit/run.js --input <client.json> [--out <dir>] [--from-raw <raw.json>]
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');

const { scoreAudit } = require('./lib/scoring');
const { collectPlaces } = require('./lib/collect/places');
const { collectSite } = require('./lib/collect/site');
const { collectPagespeed } = require('./lib/collect/pagespeed');
const { runBattery } = require('./lib/collect/battery');

const REPO_ROOT = path.join(__dirname, '..', '..');

/** Tiny built-in-only .env loader. Never overrides an already-set env var. */
function loadDotEnv() {
  const envPath = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function slugify(name) {
  return String(name || 'client')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'client';
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function readJson(filePath) {
  const abs = path.resolve(process.cwd(), filePath);
  const text = fs.readFileSync(abs, 'utf8');
  return JSON.parse(text);
}

async function collectRaw(clientConfig) {
  // Places runs first (cheap, no dependency) so site.js can be handed the
  // GBP phone number for NAP matching in the same pass.
  const places = await collectPlaces(clientConfig).catch((err) => ({
    skipped: true, reason: 'collector_error', error: String(err), client: null, competitors: [],
  }));
  const gbpPhone = places && places.client && places.client.phone ? places.client.phone : null;

  const [site, pagespeed] = await Promise.all([
    collectSite(clientConfig, { gbpPhone }).catch((err) => ({ skipped: true, reason: 'collector_error', error: String(err) })),
    collectPagespeed(clientConfig.website).catch((err) => ({ skipped: true, reason: 'collector_error', error: String(err), mobile: null })),
  ]);

  const battery = await runBattery(clientConfig).catch((err) => ({
    skipped: true, reason: 'collector_error', error: String(err), mention_rate: 0, queries: [],
  }));

  return {
    places,
    site,
    pagespeed,
    battery,
    citations: clientConfig.citations || [],
  };
}

function loadReportRenderer() {
  try {
    // eslint-disable-next-line global-require
    return require('./lib/report');
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') return null;
    throw err;
  }
}

async function main() {
  loadDotEnv();

  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      out: { type: 'string' },
      'from-raw': { type: 'string' },
    },
    allowPositionals: false,
  });

  if (!values.input) {
    console.error('Usage: node scripts/aeo-audit/run.js --input <client.json> [--out <dir>] [--from-raw <raw.json>]');
    process.exit(1);
  }

  let clientConfig;
  try {
    clientConfig = readJson(values.input);
  } catch (err) {
    console.error(`Failed to read --input ${values.input}: ${err.message}`);
    process.exit(1);
    return;
  }

  let raw;
  if (values['from-raw']) {
    try {
      raw = readJson(values['from-raw']);
    } catch (err) {
      console.error(`Failed to read --from-raw ${values['from-raw']}: ${err.message}`);
      process.exit(1);
      return;
    }
  } else {
    raw = await collectRaw(clientConfig);
  }

  const auditResult = scoreAudit(clientConfig, raw);

  const outDir = values.out
    ? path.resolve(process.cwd(), values.out)
    : path.join(__dirname, 'out', `${slugify(clientConfig.business_name)}-${todayStr()}`);
  fs.mkdirSync(outDir, { recursive: true });

  const auditPath = path.join(outDir, 'audit.json');
  fs.writeFileSync(auditPath, JSON.stringify(auditResult, null, 2));

  const renderReport = loadReportRenderer();
  if (renderReport && renderReport.renderReport) {
    try {
      const html = renderReport.renderReport(auditResult);
      fs.writeFileSync(path.join(outDir, 'report.html'), html);
    } catch (err) {
      console.warn(`report.html skipped: renderReport threw: ${err.message}`);
    }
  } else {
    console.warn('report.html skipped: lib/report.js not found yet (owned by the report task)');
  }

  console.log(`AEO audit for ${auditResult.meta.business_name || 'client'}: ${auditResult.scores.total}/100`);
  if (auditResult.meta.partial) {
    console.log(`  partial run — skipped collectors: ${auditResult.meta.skipped_collectors.join(', ')}`);
  }
  console.log(`  wrote ${auditPath}`);

  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { loadDotEnv, slugify, collectRaw };
