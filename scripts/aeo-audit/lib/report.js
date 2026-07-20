'use strict';

/**
 * AEO Audit Engine — Report Renderer
 *
 * Pure function: audit-result JSON in, standalone HTML string out.
 * No fs, no network, no npm dependencies. See CONTRACT.md § "Report renderer".
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PILLAR_ORDER = ['gbp', 'reputation', 'website', 'citations', 'ai_presence'];

const PILLAR_META = {
  gbp: {
    label: 'Google Business Profile',
    blurb: 'Completeness &amp; activity',
  },
  reputation: {
    label: 'Reputation',
    blurb: 'Reviews, rating, response rate',
  },
  website: {
    label: 'Website Answerability',
    blurb: 'Schema, FAQ, city pages, Core Web Vitals',
  },
  citations: {
    label: 'Citations &amp; Consistency',
    blurb: 'NAP match across directories',
  },
  ai_presence: {
    label: 'AI Answer Presence',
    blurb: 'Named in the query battery',
  },
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** HTML-escape any value that may originate from scraped/AI-generated data. */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Coerce to a finite number, defaulting to 0. Guards against NaN in output. */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Format an ISO date string without relying on ICU/locale data. */
function fmtDate(iso) {
  if (!iso) return 'Unknown date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function verdictTier(total) {
  if (total <= 40) {
    return { label: 'Invisible to AI search', tone: 'fail' };
  }
  if (total <= 70) {
    return { label: 'Findable but losing', tone: 'warn' };
  }
  return { label: 'Competitive', tone: 'pass' };
}

/** pass / partial / fail classification for a single check. */
function checkStatus(check) {
  const max = num(check.max_points);
  const pts = num(check.points);
  if (max <= 0) return 'pass';
  if (pts >= max) return 'pass';
  if (pts <= 0) return 'fail';
  return 'partial';
}

function statusMarker(status) {
  if (status === 'pass') return '&#10003;'; // check
  if (status === 'partial') return '&#8211;'; // en dash
  return '&#10007;'; // cross
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function renderPartialNotice(meta) {
  if (!meta || meta.partial !== true) return '';
  const skipped = Array.isArray(meta.skipped_collectors) ? meta.skipped_collectors : [];
  const list = skipped.length
    ? skipped.map((s) => esc(s)).join(', ')
    : 'unspecified sources';
  return `
    <div class="notice notice-partial">
      <strong>Partial audit.</strong> The following data sources were skipped this run: ${list}.
      Scores below reflect only the data that could be collected — re-run once the missing
      sources are available for a complete picture.
    </div>`;
}

function renderHero(meta, scores, battery) {
  const total = clamp(num(scores.total), 0, 100);
  const tier = verdictTier(total);
  const meterPct = clamp(total, 0, 100);

  const queries = Array.isArray(battery.queries) ? battery.queries : [];
  const mentionedCount = queries.filter((q) => q && q.client_mentioned === true).length;
  let headline;
  if (queries.length > 0) {
    headline = `Named in ${mentionedCount} of ${queries.length} AI answers checked`;
  } else if (typeof battery.mention_rate === 'number') {
    headline = `AI mention rate: ${Math.round(battery.mention_rate * 100)}%`;
  } else {
    headline = 'AI query battery not yet run';
  }

  const noGbp = !meta.place_id
    ? `<p class="hero-subnote">No Google Business Profile is currently linked to this business
       &mdash; that absence is itself the top finding.</p>`
    : '';

  return `
    <section class="hero">
      <div class="hero-score">
        <div class="hero-score-number">${total}<span class="hero-score-max"> / 100</span></div>
        <div class="hero-meter" role="img" aria-label="Score meter">
          <div class="hero-meter-fill hero-meter-fill--${tier.tone}" style="width:${meterPct}%;"></div>
        </div>
        <div class="hero-tier hero-tier--${tier.tone}">${esc(tier.label)}</div>
      </div>
      <div class="hero-stat">
        <div class="hero-stat-label">AI presence</div>
        <div class="hero-stat-value">${esc(headline)}</div>
      </div>
      ${noGbp}
    </section>`;
}

function renderCheckRow(check) {
  const status = checkStatus(check);
  const pts = num(check.points);
  const max = num(check.max_points);
  const note = check.note ? `<div class="check-note">${esc(check.note)}</div>` : '';
  const value = check.value ? `<div class="check-value">${esc(check.value)}</div>` : '';
  const unassessed = check.assessed === false;

  return `
    <li class="check-row check-row--${unassessed ? 'pending' : status}">
      <span class="check-marker" aria-hidden="true">${unassessed ? '&#8230;' : statusMarker(status)}</span>
      <div class="check-body">
        <div class="check-label-row">
          <span class="check-label">${esc(check.label || check.id || 'Check')}</span>
          <span class="check-points">${unassessed ? 'Pending' : `${pts} / ${max}`}</span>
        </div>
        ${value}
        ${note}
      </div>
    </li>`;
}

function renderPillarCard(key, pillar) {
  const meta = PILLAR_META[key] || { label: key, blurb: '' };
  const p = pillar || { score: 0, max: 0, assessed: false, checks: [] };
  const max = num(p.max);
  const score = num(p.score);
  const assessed = p.assessed === true;
  const checks = Array.isArray(p.checks) ? p.checks : [];
  const pct = assessed && max > 0 ? clamp((score / max) * 100, 0, 100) : 0;

  const scoreDisplay = assessed
    ? `${score} <span class="pillar-max">/ ${max}</span>`
    : `<span class="pillar-pending-label">Pending &mdash; manual check</span>`;

  const meterFill = assessed
    ? `<div class="pillar-meter-fill" style="width:${pct}%;"></div>`
    : `<div class="pillar-meter-fill pillar-meter-fill--pending"></div>`;

  const checksHtml = assessed && checks.length > 0
    ? `<ul class="check-list">${checks.map(renderCheckRow).join('')}</ul>`
    : assessed
      ? `<p class="pillar-empty">No check detail recorded for this pillar.</p>`
      : `<p class="pillar-empty">Not assessed this run &mdash; requires a manual pass (see the citations checklist) before it can be scored.</p>`;

  return `
    <article class="pillar-card">
      <header class="pillar-card-header">
        <div>
          <h3 class="pillar-title">${meta.label}</h3>
          <p class="pillar-blurb">${meta.blurb}</p>
        </div>
        <div class="pillar-score">${scoreDisplay}</div>
      </header>
      <div class="pillar-meter">${meterFill}</div>
      ${checksHtml}
    </article>`;
}

function renderPillars(pillars) {
  const cards = PILLAR_ORDER.map((key) => renderPillarCard(key, pillars[key])).join('');
  return `
    <section class="section">
      <h2 class="section-title">Pillar Breakdown</h2>
      <div class="pillar-grid">${cards}</div>
    </section>`;
}

function renderBatteryRow(q) {
  const query = q || {};
  const mentioned = query.client_mentioned === true;
  const names = Array.isArray(query.mentioned_names) ? query.mentioned_names : [];
  const namesHtml = names.length > 0
    ? names.map((n) => `<span class="comp-chip">${esc(n)}</span>`).join(' ')
    : '<span class="comp-none">No local business named</span>';

  return `
    <tr class="battery-row battery-row--${mentioned ? 'won' : 'lost'}">
      <td class="battery-query">
        <div class="battery-query-text">&ldquo;${esc(query.query || '')}&rdquo;</div>
        <div class="battery-query-meta">${esc(query.intent || '')}${query.city ? ` &middot; ${esc(query.city)}` : ''}</div>
      </td>
      <td class="battery-mentioned">
        <span class="mentioned-badge mentioned-badge--${mentioned ? 'yes' : 'no'}">
          ${mentioned ? '&#10003; Named' : '&#10007; Not named'}
        </span>
      </td>
      <td class="battery-named">${namesHtml}</td>
      <td class="battery-summary">${esc(query.answer_summary || '')}</td>
    </tr>`;
}

function renderBattery(battery) {
  const queries = Array.isArray(battery.queries) ? battery.queries : [];
  const body = queries.length > 0
    ? `
      <div class="table-scroll">
        <table class="battery-table">
          <thead>
            <tr>
              <th>Query</th>
              <th>Client named?</th>
              <th>Who was named instead</th>
              <th>What the AI answered</th>
            </tr>
          </thead>
          <tbody>${queries.map(renderBatteryRow).join('')}</tbody>
        </table>
      </div>`
    : `<p class="empty-state">No AI query battery has been run for this business yet.</p>`;

  return `
    <section class="section">
      <h2 class="section-title">The Query Battery</h2>
      <p class="section-subtitle">
        These are real questions a customer might ask an AI assistant. Here is who gets named
        &mdash; and who doesn't.
      </p>
      ${body}
    </section>`;
}

function renderCompetitors(competitors, meta, pillars) {
  const list = Array.isArray(competitors) ? competitors : [];

  // Best-effort client rating / review count, sourced from the GBP pillar checks
  // where available. Falls back to em dashes rather than guessing.
  const clientRow = `
    <tr class="competitor-row competitor-row--client">
      <td>${esc(meta.business_name || 'This business')} <span class="you-badge">You</span></td>
      <td>&mdash;</td>
      <td>&mdash;</td>
    </tr>`;

  const rows = list.length > 0
    ? list.map((c) => `
      <tr class="competitor-row">
        <td>${esc(c && c.name)}</td>
        <td>${c && typeof c.rating === 'number' ? esc(c.rating.toFixed(1)) : '&mdash;'}</td>
        <td>${c && typeof c.review_count === 'number' ? esc(c.review_count) : '&mdash;'}</td>
      </tr>`).join('')
    : '';

  const body = list.length > 0
    ? `
      <div class="table-scroll">
        <table class="competitor-table">
          <thead>
            <tr><th>Business</th><th>Rating</th><th>Reviews</th></tr>
          </thead>
          <tbody>${clientRow}${rows}</tbody>
        </table>
      </div>`
    : `<p class="empty-state">No local competitors were identified this run.</p>`;

  return `
    <section class="section">
      <h2 class="section-title">Competitor Comparison</h2>
      ${body}
    </section>`;
}

function computeTopFixes(pillars) {
  const candidates = [];
  for (const key of PILLAR_ORDER) {
    const pillar = pillars[key];
    if (!pillar || pillar.assessed !== true || !Array.isArray(pillar.checks)) continue;
    for (const check of pillar.checks) {
      if (!check || check.assessed === false) continue;
      const max = num(check.max_points);
      const pts = num(check.points);
      const gap = max - pts;
      if (gap > 0) {
        candidates.push({ ...check, gap, pillarKey: key });
      }
    }
  }
  candidates.sort((a, b) => b.gap - a.gap);
  return candidates.slice(0, 8);
}

function renderTopFixes(pillars) {
  const fixes = computeTopFixes(pillars);
  const body = fixes.length > 0
    ? `<ol class="fixes-list">${fixes.map((f) => {
        const pillarLabel = (PILLAR_META[f.pillarKey] || {}).label || f.pillarKey;
        const secondary = f.note
          ? esc(f.note)
          : f.value
            ? `Currently: ${esc(f.value)}`
            : '';
        return `
          <li class="fix-item">
            <div class="fix-points">+${f.gap}</div>
            <div class="fix-body">
              <div class="fix-label">${esc(f.label || f.id)}</div>
              ${secondary ? `<div class="fix-note">${secondary}</div>` : ''}
              <div class="fix-pillar">${pillarLabel}</div>
            </div>
          </li>`;
      }).join('')}</ol>`
    : `<p class="empty-state">No outstanding fixes identified from this run's assessed checks.</p>`;

  return `
    <section class="section">
      <h2 class="section-title">Top Fixes</h2>
      <p class="section-subtitle">Ordered by points available &mdash; the highest-leverage moves first.</p>
      ${body}
    </section>`;
}

function renderHeader(meta) {
  return `
    <header class="doc-header">
      <div class="doc-header-inner">
        <div class="wordmark">Norr<span class="wordmark-acc">AI</span></div>
        <div class="doc-header-title">
          <h1>AEO Scorecard</h1>
          <p class="doc-header-business">${esc(meta.business_name || 'Unknown business')}</p>
        </div>
        <div class="doc-header-date">Generated ${fmtDate(meta.generated_at)}</div>
      </div>
    </header>`;
}

function renderFooter(meta) {
  return `
    <footer class="doc-footer">
      <div class="doc-footer-inner">
        <div class="doc-footer-brand">Norr AI &middot; tools.norrai.co</div>
        <div class="doc-footer-meta">Prepared by Norr AI &middot; ${fmtDate(meta.generated_at)}</div>
        <p class="doc-footer-note">
          Scores are built from live Google data plus a monthly AI query battery. AI answers vary
          run to run &mdash; the trend across months matters more than any single result.
        </p>
      </div>
    </footer>`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function styles() {
  return `
:root {
  --bone:       #FAFAF7;
  --ink:        #0A0F1A;
  --glacial:    #7FA9B8;
  --graphite:   #3A3F48;
  --blush:      #E8D4C4;

  --text-primary:   #0A0F1A;
  --text-secondary: #6A6F78;
  --text-muted:     #9EA3AA;
  --border:         #E5E4DE;
  --surface:        #FFFFFF;

  --font-display: 'Inter Tight', sans-serif;
  --font-body:    'Inter', sans-serif;
  --font-mono:    'JetBrains Mono', monospace;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 12px;
  --radius-xl: 20px;

  --max-width: 1080px;
}

/* Additional tokens for the scorecard, built on top of the canonical set above. */
:root {
  --fail: #B3483D;
  --fail-bg: #FBEEEC;
  --warn: #B8863C;
  --warn-bg: #FBF3E6;
  --pass-bg: #EEF3F1;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 16px; -webkit-font-smoothing: antialiased; }
body {
  font-family: var(--font-body);
  background: var(--bone);
  color: var(--text-primary);
  line-height: 1.5;
}
h1, h2, h3 { font-family: var(--font-display); letter-spacing: -0.01em; }
img { display: block; max-width: 100%; }

.doc { max-width: var(--max-width); margin: 0 auto; }

/* Header */
.doc-header { background: var(--ink); color: var(--bone); padding: 32px 48px; }
.doc-header-inner {
  display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap;
}
.wordmark { font-family: var(--font-display); font-weight: 700; font-size: 20px; letter-spacing: -0.04em; }
.wordmark-acc { color: var(--glacial); }
.doc-header-title { flex: 1; min-width: 240px; text-align: center; }
.doc-header-title h1 { font-size: 14px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--glacial); }
.doc-header-business { font-size: 22px; font-weight: 600; margin-top: 4px; }
.doc-header-date { font-size: 13px; color: #9BA3B0; text-align: right; }

/* Notices */
.notice {
  margin: 24px 48px 0; padding: 16px 20px; border-radius: var(--radius-md);
  font-size: 14px; line-height: 1.6;
}
.notice-partial { background: var(--warn-bg); border: 1px solid var(--warn); color: var(--graphite); }

/* Hero */
.hero {
  padding: 56px 48px 40px; text-align: center;
  border-bottom: 1px solid var(--border);
}
.hero-score-number { font-family: var(--font-display); font-size: 72px; font-weight: 700; line-height: 1; }
.hero-score-max { font-size: 28px; font-weight: 500; color: var(--text-muted); }
.hero-meter {
  max-width: 420px; height: 12px; margin: 20px auto 16px;
  background: var(--border); border-radius: 999px; overflow: hidden;
}
.hero-meter-fill { height: 100%; border-radius: 999px; background: var(--glacial); }
.hero-meter-fill--fail { background: var(--fail); }
.hero-meter-fill--warn { background: var(--warn); }
.hero-meter-fill--pass { background: var(--glacial); }
.hero-tier { font-size: 17px; font-weight: 600; }
.hero-tier--fail { color: var(--fail); }
.hero-tier--warn { color: var(--warn); }
.hero-tier--pass { color: var(--graphite); }
.hero-stat { margin-top: 28px; }
.hero-stat-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
.hero-stat-value { font-size: 20px; font-weight: 600; margin-top: 4px; }
.hero-subnote { margin-top: 16px; font-size: 13px; color: var(--text-secondary); max-width: 520px; margin-left: auto; margin-right: auto; }

/* Sections */
.section { padding: 48px; border-bottom: 1px solid var(--border); }
.section-title { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
.section-subtitle { font-size: 14px; color: var(--text-secondary); margin-bottom: 24px; max-width: 640px; }

/* Pillars */
.pillar-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }
.pillar-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
  padding: 24px; break-inside: avoid;
}
.pillar-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.pillar-title { font-size: 16px; font-weight: 700; }
.pillar-blurb { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.pillar-score { font-size: 20px; font-weight: 700; white-space: nowrap; }
.pillar-max { font-size: 13px; font-weight: 500; color: var(--text-muted); }
.pillar-pending-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
.pillar-meter { height: 8px; background: var(--border); border-radius: 999px; overflow: hidden; margin-bottom: 16px; }
.pillar-meter-fill { height: 100%; background: var(--glacial); border-radius: 999px; }
.pillar-meter-fill--pending {
  width: 100%;
  background: repeating-linear-gradient(45deg, var(--border), var(--border) 6px, #DEDCD3 6px, #DEDCD3 12px);
}
.pillar-empty { font-size: 13px; color: var(--text-secondary); font-style: italic; }

.check-list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
.check-row { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: var(--radius-sm); }
.check-row--pass { background: var(--pass-bg); }
.check-row--partial { background: var(--warn-bg); }
.check-row--fail { background: var(--fail-bg); }
.check-row--pending { background: var(--bone); border: 1px dashed var(--border); }
.check-marker { font-size: 13px; font-weight: 700; line-height: 1.4; width: 16px; text-align: center; flex-shrink: 0; }
.check-row--pass .check-marker { color: var(--glacial); }
.check-row--partial .check-marker { color: var(--warn); }
.check-row--fail .check-marker { color: var(--fail); }
.check-row--pending .check-marker { color: var(--text-muted); }
.check-body { flex: 1; min-width: 0; }
.check-label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.check-label { font-size: 13px; font-weight: 600; }
.check-points { font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); white-space: nowrap; }
.check-value { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.check-note { font-size: 12px; color: var(--text-secondary); margin-top: 4px; font-style: italic; }

/* Battery table */
.table-scroll { overflow-x: auto; }
.battery-table, .competitor-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.battery-table th, .competitor-table th {
  text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--text-muted); padding: 10px 12px; border-bottom: 2px solid var(--border);
}
.battery-table td, .competitor-table td { padding: 14px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
.battery-row--lost { background: var(--fail-bg); }
.battery-row--won { background: var(--pass-bg); }
.battery-query-text { font-weight: 600; }
.battery-query-meta { font-size: 11px; color: var(--text-secondary); margin-top: 2px; text-transform: capitalize; }
.mentioned-badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; }
.mentioned-badge--yes { background: var(--glacial); color: var(--ink); }
.mentioned-badge--no { background: var(--fail); color: var(--bone); }
.battery-row--lost .battery-query-text { color: var(--fail); }
.comp-chip {
  display: inline-block; background: var(--surface); border: 1px solid var(--border);
  border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 600; margin: 2px 4px 2px 0;
}
.comp-none { font-size: 12px; color: var(--text-muted); font-style: italic; }
.battery-summary { color: var(--text-secondary); max-width: 320px; }

/* Competitors */
.competitor-row--client { background: var(--pass-bg); font-weight: 700; }
.you-badge {
  display: inline-block; background: var(--ink); color: var(--bone); font-size: 10px;
  font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 8px;
  border-radius: 999px; margin-left: 8px;
}

/* Top fixes */
.fixes-list { list-style: none; counter-reset: fixnum; display: flex; flex-direction: column; gap: 12px; }
.fix-item {
  display: flex; gap: 16px; align-items: flex-start; padding: 16px 20px;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md);
  break-inside: avoid;
}
.fix-points {
  font-family: var(--font-mono); font-weight: 700; font-size: 15px; color: var(--glacial);
  background: var(--pass-bg); border-radius: var(--radius-sm); padding: 4px 8px; flex-shrink: 0;
}
.fix-label { font-size: 14px; font-weight: 700; }
.fix-note { font-size: 13px; color: var(--text-secondary); margin-top: 2px; }
.fix-pillar { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 6px; }

.empty-state { font-size: 14px; color: var(--text-secondary); font-style: italic; }

/* Footer */
.doc-footer { background: var(--ink); color: #C7CCD6; padding: 40px 48px; }
.doc-footer-inner { max-width: var(--max-width); margin: 0 auto; }
.doc-footer-brand { font-family: var(--font-display); font-weight: 700; color: var(--bone); font-size: 15px; }
.doc-footer-meta { font-size: 12px; margin-top: 6px; color: #9BA3B0; }
.doc-footer-note { font-size: 12px; margin-top: 16px; max-width: 640px; line-height: 1.7; color: #9BA3B0; }

@media (max-width: 640px) {
  .doc-header, .section, .hero { padding-left: 20px; padding-right: 20px; }
  .doc-header-inner { flex-direction: column; text-align: center; }
  .doc-header-date { text-align: center; }
  .hero-score-number { font-size: 52px; }
}

@media print {
  body { background: #fff; }
  .doc-header, .doc-footer { background: #fff !important; color: var(--ink) !important; }
  .wordmark-acc { color: var(--graphite) !important; }
  .doc-footer-brand { color: var(--ink) !important; }
  .doc-footer-meta, .doc-footer-note { color: var(--graphite) !important; }
  .pillar-card, .fix-item { box-shadow: none !important; }
  .section { break-inside: avoid; page-break-inside: avoid; }
  .pillar-card, .fix-item, .check-row { page-break-inside: avoid; }
  a { text-decoration: none; color: inherit; }
}
`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * @param {object} auditResult audit-result JSON (see CONTRACT.md)
 * @returns {string} complete standalone HTML document
 */
function renderReport(auditResult) {
  const result = auditResult || {};
  const meta = result.meta || {};
  const scores = result.scores || {};
  const pillars = scores.pillars || {};
  const competitors = Array.isArray(result.competitors) ? result.competitors : [];
  const battery = result.battery || {};

  const title = `AEO Scorecard — ${esc(meta.business_name || 'Business')}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Inter+Tight:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${styles()}</style>
</head>
<body>
<div class="doc">
${renderHeader(meta)}
${renderPartialNotice(meta)}
${renderHero(meta, scores, battery)}
${renderPillars(pillars)}
${renderBattery(battery)}
${renderCompetitors(competitors, meta, pillars)}
${renderTopFixes(pillars)}
${renderFooter(meta)}
</div>
</body>
</html>
`;
}

module.exports = { renderReport };
