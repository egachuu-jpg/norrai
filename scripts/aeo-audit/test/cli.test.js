'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUN_JS = path.join(__dirname, '..', 'run.js');
const FIXTURES = path.join(__dirname, '..', 'fixtures');

test('--from-raw end-to-end produces a valid audit.json without touching the network', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeo-audit-cli-test-'));

  const result = spawnSync(
    process.execPath,
    [
      RUN_JS,
      '--input', path.join(FIXTURES, 'sample-client.json'),
      '--from-raw', path.join(FIXTURES, 'sample-raw.json'),
      '--out', outDir,
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, `run.js exited nonzero: ${result.stderr}`);

  const auditPath = path.join(outDir, 'audit.json');
  assert.ok(fs.existsSync(auditPath), 'audit.json was written');

  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  assert.equal(audit.meta.business_name, '507 Air Heating & Cooling');
  assert.equal(audit.meta.engine_version, '1.0.0');
  assert.equal(typeof audit.scores.total, 'number');
  assert.ok(audit.scores.total >= 0 && audit.scores.total <= 100);
  assert.ok(audit.scores.pillars.gbp);
  assert.ok(audit.scores.pillars.reputation);
  assert.ok(audit.scores.pillars.website);
  assert.ok(audit.scores.pillars.citations);
  assert.ok(audit.scores.pillars.ai_presence);
  assert.ok(Array.isArray(audit.competitors));
  assert.ok(audit.battery && Array.isArray(audit.battery.queries));

  // lib/report.js may not exist yet (owned by a parallel task) — that must
  // never crash the CLI; it should just skip report.html and warn.
  assert.doesNotMatch(result.stderr || '', /Fatal error/);

  fs.rmSync(outDir, { recursive: true, force: true });
});

test('missing --input exits nonzero with a usage message, does not crash', () => {
  const result = spawnSync(process.execPath, [RUN_JS], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});
