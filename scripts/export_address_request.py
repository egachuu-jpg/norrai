#!/usr/bin/env python3
"""Build the "where do they live now?" spreadsheet for an agent, and mark those contacts.

Selects every past/active client with no current mailing address (address_status = needs_lookup,
not do_not_mail). Writes an .xlsx the agent can fill in -- most recent deals first, with the
county-record suggestion where one exists -- and (with --apply) marks each contact:
  review_reasons += 'address_requested_from_agent'
  metadata.address_requested_on = today
They stay needs_lookup, so labels keep skipping them until an address comes back.

The agent fills NEW_street / NEW_city / NEW_state / NEW_zip (or ACTION = DO NOT MAIL). Apply the
returned file with scripts/import_address_review.py --csv <file.xlsx or .csv> (dry run first).

Usage:
  python3 scripts/export_address_request.py --client-id <uuid> -o request.xlsx [--apply]
Requires DATABASE_URL, `pip install "psycopg[binary]" openpyxl`. Prints counts only.
"""
import argparse
import datetime
import os
import sys

QUERY = """
SELECT c.id::text, c.display_name, c.stage, c.phone, c.email, c.metadata->>'county_suggestion',
       d.side, d.street, d.city, d.closing_date
FROM contacts c
LEFT JOIN LATERAL (
  SELECT t.side, t.street, t.city, t.closing_date FROM contact_transactions t
  WHERE t.contact_id = c.id AND t.deal_status <> 'cancelled'
  ORDER BY t.closing_date DESC NULLS FIRST LIMIT 1) d ON TRUE
WHERE c.client_id = %s AND c.stage IN ('past_client', 'active_client')
  AND c.address_status = 'needs_lookup' AND NOT c.do_not_mail
"""
MARK = """
UPDATE contacts SET
  review_reasons = array_append(array_remove(review_reasons, 'address_requested_from_agent'),
                                'address_requested_from_agent'),
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('address_requested_on', %(today)s::text)
WHERE id = ANY(%(ids)s::uuid[]) AND client_id = %(client_id)s::uuid AND address_status = 'needs_lookup'
"""
COLS = [  # (header, width)
    ("Client", 30), ("Phone", 14), ("Email", 28), ("Last deal", 11), ("Property", 34), ("Year", 7),
    ("County record suggests", 36),
    ("NEW_street", 28), ("NEW_city", 16), ("NEW_state", 10), ("NEW_zip", 10), ("ACTION", 14), ("notes", 30),
    ("contact_id", 38),
]


def phone_fmt(p):
    return f"({p[:3]}) {p[3:6]}-{p[6:]}" if p and len(p) == 10 and p.isdigit() else (p or "")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--client-id", required=True)
    ap.add_argument("-o", "--output", required=True)
    ap.add_argument("--apply", action="store_true", help="mark the contacts as requested (default: file only)")
    a = ap.parse_args()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set.")
    import psycopg
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.worksheet.datavalidation import DataValidation

    with psycopg.connect(url) as conn:
        rows = conn.execute(QUERY, (a.client_id,)).fetchall()
        rows.sort(key=lambda r: (r[9] is None, -(r[9].toordinal() if r[9] else 0)))  # newest first

        wb = Workbook()
        ws = wb.active
        ws.title = "Where are they now"
        ws.append([c for c, _ in COLS])
        for cid, name, stage, phone, email, sugg, side, street, city, closed in rows:
            deal = {"Seller": "Sold", "Buyer": "Bought"}.get(side, side or "")
            if stage == "active_client":
                deal += " (active)"
            prop = ", ".join(x for x in (street, city) if x)
            ws.append([name, phone_fmt(phone), email or "", deal, prop, closed.year if closed else "",
                       sugg or "", "", "", "", "", "", "", cid])
        head_fill, fill_in = PatternFill("solid", fgColor="0A0F1A"), PatternFill("solid", fgColor="FFF6D6")
        for i, (_, width) in enumerate(COLS, start=1):
            col = ws.cell(row=1, column=i).column_letter
            ws.column_dimensions[col].width = width
            ws.cell(row=1, column=i).font = Font(bold=True, color="FFFFFF")
            ws.cell(row=1, column=i).fill = head_fill
        for r in range(2, ws.max_row + 1):  # highlight the columns Evan fills in
            for c in range(8, 14):
                ws.cell(row=r, column=c).fill = fill_in
        ws.column_dimensions["N"].hidden = True  # contact_id: needed for the import, not for Evan
        ws.freeze_panes = "B2"
        ws.auto_filter.ref = f"A1:M{ws.max_row}"
        dv = DataValidation(type="list", formula1='"DO NOT MAIL"', allow_blank=True)
        ws.add_data_validation(dv)
        dv.add(f"L2:L{max(ws.max_row, 2)}")

        info = wb.create_sheet("How to fill this in")
        for line in [
            "These past clients moved and we don't know their current address.",
            "",
            "If you know where they live now: fill in the yellow NEW_street, NEW_city and NEW_zip columns",
            "  (NEW_state can stay blank for Minnesota).",
            "If 'County record suggests' shows an address and it's right, copy it into the NEW_ columns.",
            "If they should not get mail from you: choose DO NOT MAIL in the ACTION column.",
            "If you don't know: leave the row blank -- that's fine, they just stay off the mailing list.",
            "",
            "Please don't change the Client column or delete rows. Send the file back when you're done.",
        ]:
            info.append([line])
        info.column_dimensions["A"].width = 100
        for row in info.iter_rows():
            row[0].alignment = Alignment(wrap_text=False)
        wb.save(a.output)

        from collections import Counter
        kinds = Counter(r[6] or "none" for r in rows)
        print(f"rows: {len(rows)}  last deal side: {dict(kinds)}  "
              f"with county suggestion: {sum(1 for r in rows if r[5])}  active: {sum(1 for r in rows if r[2] == 'active_client')}")
        print("wrote", a.output)
        if a.apply:
            cur = conn.execute(MARK, {"ids": [r[0] for r in rows], "client_id": a.client_id,
                                      "today": datetime.date.today().isoformat()})
            conn.commit()
            print(f"marked {cur.rowcount} contacts: address_requested_from_agent")
        else:
            print("not marked (pass --apply to mark them as requested)")


if __name__ == "__main__":
    main()
