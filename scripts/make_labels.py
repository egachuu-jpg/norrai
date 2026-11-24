#!/usr/bin/env python3
"""Print mailing labels (Avery 5160-style sheets) from the contacts list.

Reads either the cleaned households CSV (output of clean_contacts.py) or the `contacts` table,
keeps only rows that are safe to mail, and lays them out on standard label sheets.

A row is mailable when ALL of these hold:
  - it has a street, city, state and 5-digit ZIP
  - address_status is in --status (default: buyer_property, contact_file, verified)
    -> 'needs_lookup' (sold / no current address) and 'undeliverable' are never printed by default
  - it is not do_not_mail (database mode)
  - it has none of the --exclude-reason flags (default: address_truncated_or_incomplete,
    only_cancelled_deals)
Everything skipped is listed, with the reason, in <output>.skipped.csv.

Examples:
  # from the cleaned CSV
  python3 scripts/make_labels.py --csv OUT/households.csv -o labels.pdf
  # from Neon (needs DATABASE_URL and `pip install "psycopg[binary]"`)
  python3 scripts/make_labels.py --client-id <uuid> --stage past_client -o labels.pdf
  # check alignment before wasting label stock: prints outlines on plain paper
  python3 scripts/make_labels.py --csv OUT/households.csv --test-grid -o grid.pdf
  # sheet already partly used? skip the first 7 label positions
  python3 scripts/make_labels.py --csv OUT/households.csv --skip 7 -o labels.pdf

ALWAYS print one test page on plain paper first and hold it against a label sheet to a light.
Requires:  pip install reportlab
"""
import argparse
import csv
import os
import sys
import unicodedata

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

# Sheet geometry in inches: label width/height, columns, rows, left margin, top margin,
# horizontal pitch (left edge to left edge), vertical pitch. Letter paper, 8.5 x 11.
TEMPLATES = {
    "5160": dict(w=2.625, h=1.0,    cols=3, rows=10, left=0.1875,  top=0.5,    hp=2.75,   vp=1.0),
    "8160": dict(w=2.625, h=1.0,    cols=3, rows=10, left=0.1875,  top=0.5,    hp=2.75,   vp=1.0),
    "5161": dict(w=4.0,   h=1.0,    cols=2, rows=10, left=0.15625, top=0.5,    hp=4.1875, vp=1.0),
    "5162": dict(w=4.0,   h=1.3333, cols=2, rows=7,  left=0.15625, top=0.8333, hp=4.1875, vp=1.3333),
    "5163": dict(w=4.0,   h=2.0,    cols=2, rows=5,  left=0.15625, top=0.5,    hp=4.1875, vp=2.0),
}
PAD = 0.12  # inches of padding inside each label


def read_csv_rows(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            yield {
                "id": r.get("household_id", ""), "name": r["display_name"],
                "street": r["mail_street"], "city": r["mail_city"], "state": r["mail_state"],
                "zip": r["mail_zip"], "status": r["address_status"], "stage": "past_client",
                "reasons": [x for x in (r.get("review_reasons") or "").split(";") if x],
                "do_not_mail": False,
            }


def read_db_rows(client_id, stages):
    import psycopg
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set.")
    q = """SELECT id::text, display_name, mail_street, mail_city, mail_state, mail_zip,
                  address_status, stage, review_reasons, do_not_mail
           FROM contacts WHERE client_id = %s AND stage = ANY(%s) ORDER BY last_name, first_name"""
    with psycopg.connect(url) as conn:
        for (cid, name, st, city, state, zipc, status, stage, reasons, dnm) in conn.execute(q, (client_id, stages)):
            yield {"id": cid, "name": name or "", "street": st or "", "city": city or "",
                   "state": state or "", "zip": zipc or "", "status": status, "stage": stage,
                   "reasons": list(reasons or []), "do_not_mail": bool(dnm)}


def skip_reason(r, statuses, bad_reasons, stages):
    if r["do_not_mail"]:
        return "do_not_mail"
    if r["stage"] not in stages:
        return f"stage_{r['stage']}"
    if r["status"] not in statuses:
        return f"status_{r['status']}"
    if not (r["street"] and r["city"] and r["state"]):
        return "address_incomplete"
    if not (r["zip"].isdigit() and len(r["zip"]) == 5):
        return "zip_missing_or_invalid"
    hit = [x for x in r["reasons"] if x in bad_reasons]
    if hit:
        return hit[0]
    if not r["name"].strip():
        return "no_name"
    return None


def printable(text):
    """Helvetica only covers Latin-1/WinAnsi. Anything else is accent-stripped so it never
    prints as a box (USPS prefers plain ASCII anyway)."""
    out = []
    for ch in text:
        try:
            ch.encode("cp1252")
            out.append(ch)
        except UnicodeEncodeError:
            out.append(unicodedata.normalize("NFKD", ch).encode("ascii", "ignore").decode())
    return "".join(out)


def label_lines(r, upper):
    lines = [r["name"].strip(), r["street"].strip(), f'{r["city"].strip()}, {r["state"].strip().upper()} {r["zip"].strip()}']
    lines = [printable(l) for l in lines]
    if upper:  # USPS-friendly: uppercase, no commas
        lines = [l.upper().replace(",", "") for l in lines]
    return lines


def wrap_name(name, font, size, max_w):
    """One line if it fits, else the most balanced two-line split that fits; None if impossible."""
    w = lambda t: pdfmetrics.stringWidth(t, font, size)
    if w(name) <= max_w:
        return [name]
    words = name.split()
    best = None
    for i in range(1, len(words)):
        l1, l2 = " ".join(words[:i]), " ".join(words[i:])
        if w(l1) <= max_w and w(l2) <= max_w:
            spread = abs(w(l1) - w(l2))
            if best is None or spread < best[0]:
                best = (spread, [l1, l2])
    return best[1] if best else None


def layout(lines, font, max_w, max_h, start, floor=8.0):
    """Largest font size (>= floor) at which everything fits the label; None if none does."""
    size = start
    while size >= floor:
        name_lines = wrap_name(lines[0], font, size, max_w)
        if name_lines:
            block = name_lines + lines[1:]
            fits_w = all(pdfmetrics.stringWidth(l, font, size) <= max_w for l in block)
            if fits_w and size * 1.18 * len(block) <= max_h:
                return size, block
        size -= 0.25
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--csv", help="households.csv from clean_contacts.py")
    src.add_argument("--client-id", help="read the contacts table for this client (needs DATABASE_URL)")
    ap.add_argument("-o", "--output", required=True)
    ap.add_argument("--template", default="5160", choices=sorted(TEMPLATES))
    ap.add_argument("--stage", action="append", help="repeatable; default past_client")
    ap.add_argument("--status", default="buyer_property,contact_file,verified",
                    help="comma-separated address_status values to print")
    ap.add_argument("--exclude-reason", action="append",
                    help="repeatable review_reasons flag that blocks printing "
                         "(default: address_truncated_or_incomplete, only_cancelled_deals)")
    ap.add_argument("--skip", type=int, default=0, help="blank label positions to leave at the start (used sheets)")
    ap.add_argument("--limit", type=int, default=0, help="print only the first N labels (0 = all)")
    ap.add_argument("--uppercase", action="store_true", help="USPS-style: UPPERCASE, no commas")
    ap.add_argument("--font", help="path to a .ttf font (e.g. a handwriting font); default Helvetica")
    ap.add_argument("--font-size", type=float, default=11.0, help="starting font size, shrinks to fit")
    ap.add_argument("--test-grid", action="store_true", help="outline every label + sample text, for alignment checks")
    a = ap.parse_args()

    t = TEMPLATES[a.template]
    per_page = t["cols"] * t["rows"]
    stages = set(a.stage or ["past_client"])
    statuses = {s.strip() for s in a.status.split(",") if s.strip()}
    bad = set(a.exclude_reason or ["address_truncated_or_incomplete", "only_cancelled_deals"])

    font = "Helvetica"
    if a.font:
        font = "UserFont"
        pdfmetrics.registerFont(TTFont(font, a.font))

    rows = list(read_csv_rows(a.csv)) if a.csv else list(read_db_rows(a.client_id, sorted(stages)))
    keep, skipped = [], []
    for r in rows:
        why = skip_reason(r, statuses, bad, stages)
        (skipped.append((r, why)) if why else keep.append(r))
    max_w = (t["w"] - 2 * PAD) * inch
    max_h = (t["h"] - 0.16) * inch
    fitted = []
    for r in keep:
        lay = layout(label_lines(r, a.uppercase), font, max_w, max_h, a.font_size)
        if lay:
            r["_layout"] = lay
            fitted.append(r)
        else:
            skipped.append((r, "name_or_address_too_long_to_fit"))
    keep = fitted
    if a.limit:
        keep = keep[:a.limit]

    if a.test_grid:
        keep = [{"name": "Sample Name & Partner", "street": "123 Maple St",
                 "city": "Faribault", "state": "MN", "zip": "55021"}] * per_page
        a.skip = 0
        for r in keep:
            r["_layout"] = layout(label_lines(r, False), font, max_w, max_h, a.font_size)

    c = canvas.Canvas(a.output, pagesize=letter)
    c.setTitle("Mailing labels")
    page_h = letter[1]
    slots = [None] * a.skip + keep
    for i, r in enumerate(slots):
        pos = i % per_page
        if i and pos == 0:
            c.showPage()
        if r is None:
            continue
        col, row = pos % t["cols"], pos // t["cols"]
        x = (t["left"] + col * t["hp"]) * inch
        y = page_h - (t["top"] + row * t["vp"] + t["h"]) * inch  # bottom-left of the label
        if a.test_grid:
            c.setLineWidth(0.4)
            c.setStrokeGray(0.6)
            c.rect(x, y, t["w"] * inch, t["h"] * inch)
        size, block = r["_layout"]
        c.setFont(font, size)
        lead = size * 1.18
        ty = y + (t["h"] * inch + lead * len(block)) / 2 - size  # vertically centre the block
        for ln in block:
            c.drawString(x + PAD * inch, ty, ln)
            ty -= lead
    c.save()

    sheets = -(-len(slots) // per_page) if slots else 0
    print(f"rows read: {len(rows)}   labels printed: {len(keep)}   sheets ({a.template}, {per_page}/sheet): {sheets}")
    if a.skip:
        print(f"first {a.skip} positions left blank")
    if skipped and not a.test_grid:
        from collections import Counter
        print("skipped:", dict(Counter(w for _, w in skipped)))
        with open(a.output + ".skipped.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["id", "name", "address_status", "reason"])
            for r, why in skipped:
                w.writerow([r["id"], r["name"], r["status"], why])
        print("skipped list:", a.output + ".skipped.csv")
    print("wrote", a.output)


if __name__ == "__main__":
    main()
