/**
 * Generates website/norr_ai_og.png (1200x630) for Open Graph / iMessage previews.
 * Run with: node scripts/generate_og_image.js
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px;
    height: 630px;
    background: #0A0F1A;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Arial Narrow', Arial, sans-serif;
    overflow: hidden;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 28px;
  }
  .emblem {
    width: 160px;
    height: 168px;
  }
  .wordmark {
    font-size: 52px;
    font-weight: 700;
    letter-spacing: -2px;
    color: #FAFAF7;
  }
  .wordmark span {
    color: #7FA9B8;
  }
  .tagline {
    font-size: 20px;
    color: #6A6F78;
    letter-spacing: 3px;
    text-transform: uppercase;
    font-family: monospace;
  }
  .domain {
    font-size: 16px;
    color: #3A3F48;
    letter-spacing: 4px;
    font-family: monospace;
    text-transform: uppercase;
    margin-top: -12px;
  }
</style>
</head>
<body>
<div class="card">
  <svg class="emblem" viewBox="0 0 400 420" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="4" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <polygon points="200,52 318,116 318,284 200,348 82,284 82,116" fill="none" stroke="#7FA9B8" stroke-width="1.5" opacity="0.3"/>
    <polygon points="200,62 308,122 308,278 200,338 92,278 92,122" fill="#111827" stroke="#7FA9B8" stroke-width="1" opacity="0.6"/>
    <polygon points="200,78 294,132 294,268 200,322 106,268 106,132" fill="#141C2B"/>
    <line x1="200" y1="110" x2="200" y2="130" stroke="#7FA9B8" stroke-width="1.2" opacity="0.4"/>
    <line x1="200" y1="270" x2="200" y2="290" stroke="#7FA9B8" stroke-width="1.2" opacity="0.4"/>
    <line x1="118" y1="200" x2="138" y2="200" stroke="#7FA9B8" stroke-width="1.2" opacity="0.4"/>
    <line x1="262" y1="200" x2="282" y2="200" stroke="#7FA9B8" stroke-width="1.2" opacity="0.4"/>
    <polygon points="200,138 207,188 200,196 193,188" fill="#7FA9B8" filter="url(#glow)" opacity="0.95"/>
    <polygon points="200,262 207,212 200,204 193,212" fill="#7FA9B8" opacity="0.45"/>
    <polygon points="262,200 212,207 204,200 212,193" fill="#7FA9B8" opacity="0.45"/>
    <polygon points="138,200 188,207 196,200 188,193" fill="#7FA9B8" opacity="0.45"/>
    <circle cx="200" cy="200" r="9" fill="#0A0F1A" stroke="#7FA9B8" stroke-width="1.5"/>
    <circle cx="200" cy="200" r="3.5" fill="#7FA9B8" filter="url(#glow)"/>
  </svg>
  <div class="wordmark">NORR<span> AI</span></div>
  <div class="tagline">AI Automation</div>
  <div class="domain">norrai.co</div>
</div>
</body>
</html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });

  const outputPath = path.join(__dirname, '../website/norr_ai_og.png');
  await page.screenshot({ path: outputPath, type: 'png' });
  await browser.close();

  const size = fs.statSync(outputPath).size;
  console.log(`Generated: website/norr_ai_og.png (${Math.round(size / 1024)}KB)`);
})();
