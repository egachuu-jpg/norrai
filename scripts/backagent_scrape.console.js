// Back Agent transaction list -> CSV. Paste into the browser DevTools Console while signed in
// on page 1 of the Transactions list (https://<backagent host>/.../?page=1). It runs entirely in
// your browser: nothing is sent anywhere, and a "Download N rows" button appears at the top right
// when it finishes (click it -- browsers block downloads that aren't tied to a click).
//
//   - Set LIMIT = 2 first to test on two pages, then LIMIT = 0 for every page.
//   - Output columns: page, side, phase, status, phases_done, type, photo_label, display_name,
//     tag, detail_url, client, started, agent, closing  (labels like "Client:" become columns).
//   - This was written against Back Agent's markup: rows are .TransactionListingContainer,
//     pagination is plain ?page=N links, Buyer/Seller is a class on .ListingPhoto.
//   - To adapt it to another system (e.g. BrokerSumo): change the row selector, the pagination
//     (URL param vs. a Next button), and the field selectors in parseBox. See
//     docs/handoffs/2026-11-22-contact-ingestion.md.
//
// NEVER commit the CSV this produces -- it contains client names and addresses.
(async () => {
  const LIMIT = 2;                 // test with 2 pages first; set to 0 for all pages
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();

  const pageNums = [...document.querySelectorAll('.PageControls a[href*="page="]')]
    .map(a => +new URL(a.href, location.href).searchParams.get('page')).filter(Boolean);
  const total = pageNums.length ? Math.max(...pageNums) : 37;
  const pages = LIMIT ? Math.min(LIMIT, total) : total;

  const parseBox = (box, page) => {
    const t = s => clean(box.querySelector(s)?.textContent);
    const photo = box.querySelector('.ListingPhoto');
    const row = {
      page,
      side: clean((photo?.className || '').replace('ListingPhoto', '')),
      phase: t('.PhaseTitle'),
      status: t('.StatusTitle'),
      phases_done: box.querySelectorAll('.PhaseMarker.Done').length,
      type: t('.TypeCover'),
      photo_label: t('.ListingPhotoLabel'),
      display_name: t('.ListingDisplayName'),
      tag: t('.TagDisp strong'),
      detail_url: photo?.querySelector('a')?.href || '',
    };
    // ListingDetails: lines separated by <br>, each "Label: value"
    const details = box.querySelector('.ListingDetails');
    if (details) {
      const lines = [[]];
      details.childNodes.forEach(n => n.nodeName === 'BR' ? lines.push([]) : lines[lines.length - 1].push(n));
      lines.forEach(nodes => {
        const labelEl = nodes.find(n => n.classList?.contains('LabelTitle'));
        const closing = nodes.find(n => n.classList?.contains('ClosingTitle'));
        const value = clean(nodes
          .filter(n => n !== labelEl && !n.classList?.contains('ListingDisplayName'))
          .map(n => n.textContent).join(' '));
        const key = labelEl ? clean(labelEl.textContent).replace(/:$/, '').toLowerCase().replace(/\W+/g, '_')
                  : closing ? 'closing' : null;
        if (key && value !== '') row[key] = row[key] ? row[key] + ' | ' + value : value;
        else if (key && !(key in row)) row[key] = '';
      });
    }
    return row;
  };

  const all = [];
  for (let p = 1; p <= pages; p++) {
    const url = new URL(location.pathname + '?page=' + p, location.origin);
    const html = await (await fetch(url, { credentials: 'include' })).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const boxes = [...doc.querySelectorAll('.TransactionListingContainer')];
    if (!boxes.length) { console.warn('No rows on page', p, '- stopping (logged out?)'); break; }
    boxes.forEach(b => all.push(parseBox(b, p)));
    console.log('page', p, 'of', pages, '-', boxes.length, 'rows');
    await sleep(500);
  }

  const cols = [];
  all.forEach(r => Object.keys(r).forEach(k => { if (!cols.includes(k)) cols.push(k); }));
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = '﻿' + [cols, ...all.map(r => cols.map(c => r[c]))].map(r => r.map(esc).join(',')).join('\n');
  window.__csv = csv;               // backup: still in the Console as __csv (copy(__csv))
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const btn = document.createElement('a');
  btn.href = url;
  btn.download = 'transactions.csv';
  btn.textContent = `Download ${all.length} rows (click me)`;
  btn.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;padding:14px 20px;background:#0A0F1A;color:#fff;font:600 16px sans-serif;border-radius:8px;text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.4)';
  document.body.appendChild(btn);
  console.log(all.length, 'rows ready. Click the Download button at the top right of the page.');
})();
