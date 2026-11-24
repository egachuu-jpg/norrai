#!/usr/bin/env python3
"""Export the contacts an agent needs to review into a CSV for a Google Sheet.

Sections (one row per household):
  1 Needs address     address_status = needs_lookup (mostly sellers who moved)
  2 Confirm address   purchase 5+ years ago -- they may have moved since
  3 Check duplicate   flagged possible_duplicate_contact by the loader
Only past_client / active_client contacts, never do_not_mail ones.

The agent fills in the NEW_* columns and/or ACTION, then the sheet is downloaded as CSV and
applied with scripts/import_address_review.py (dry run by default).

Usage:
  python3 scripts/export_address_review.py --client-id <uuid> -o review.csv
Requires DATABASE_URL and `pip install "psycopg[binary]"`. Prints counts only.
"""
import argparse
import csv
import os
import sys

QUERY = """
SELECT c.id::text, c.stage, c.display_name, c.phone, c.email,
       concat_ws(', ', c.mail_street, c.mail_city, c.mail_state || ' ' || c.mail_zip) AS current_mail,
       c.address_status, c.review_reasons, c.last_closing,
       last_deal.street, last_deal.city, last_deal.side, last_deal.closing_date
FROM contacts c
LEFT JOIN LATERAL (
  SELECT t.street, t.city, t.side, t.closing_date FROM contact_transactions t
  WHERE t.contact_id = c.id AND t.deal_status <> 'cancelled'
  ORDER BY t.closing_date DESC NULLS FIRST LIMIT 1) last_deal ON TRUE
WHERE c.client_id = %s AND c.stage IN ('past_client', 'active_client') AND NOT c.do_not_mail
"""

COLS = ["contact_id", "section", "stage", "name", "phone", "email",
        "last_deal", "last_deal_date", "current_mailing_address",
        "NEW_street", "NEW_city", "NEW_state", "NEW_zip", "ACTION", "notes"]


def section_of(status, reasons):
    if "possible_duplicate_contact" in reasons:
        return "3 Check duplicate"
    if status == "needs_lookup":
        return "1 Needs address"
    if "purchase_5plus_years_ago_may_have_moved" in reasons and status != "verified":
        return "2 Confirm address"
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--client-id", required=True)
    ap.add_argument("-o", "--output", required=True)
    a = ap.parse_args()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set.")
    import psycopg
    with psycopg.connect(url) as conn:
        rows = conn.execute(QUERY, (a.client_id,)).fetchall()

    out = []
    for (cid, stage, name, phone, email, cur, status, reasons, last_close,
         d_street, d_city, d_side, d_date) in rows:
        sec = section_of(status, list(reasons or []))
        if not sec:
            continue
        last_deal = f"{d_side or ''}: {d_street or ''}, {d_city or ''}".strip(": ,") if d_street else ""
        out.append({
            "contact_id": cid, "section": sec, "stage": stage, "name": name or "",
            "phone": phone or "", "email": email or "",
            "last_deal": last_deal, "last_deal_date": d_date or "",
            "current_mailing_address": cur if status != "needs_lookup" else "",
            "NEW_street": "", "NEW_city": "", "NEW_state": "", "NEW_zip": "", "ACTION": "", "notes": "",
        })
    # Most recent deals first inside each section: those are the ones the agent remembers.
    out.sort(key=lambda r: (r["section"], -(r["last_deal_date"].toordinal() if r["last_deal_date"] else 0)))
    with open(a.output, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows(out)
    from collections import Counter
    print("rows:", len(out), dict(Counter(r["section"] for r in out)))
    print("wrote", a.output)


if __name__ == "__main__":
    main()
