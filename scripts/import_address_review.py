#!/usr/bin/env python3
"""Apply the agent's address review (sheet downloaded as CSV) to the contacts table.

Per row, keyed by contact_id (rows with nothing filled in are ignored):
  NEW_street + NEW_city (+ NEW_state, NEW_zip)  -> set as the mailing address, address_status
                                                    'verified' (later imports never overwrite it)
  ACTION = CONFIRMED                            -> the current address is right -> 'verified'
  ACTION = DO NOT MAIL                          -> do_not_mail = true (labels skip them)
  ACTION = SAME AS <contact_id>                 -> duplicate: this row is marked do_not_mail and
                                                    noted; merge the two by hand if needed
Address-related review flags are cleared once an address is verified.

DRY RUN IS THE DEFAULT; pass --apply to write. Prints counts and row numbers only.
Accepts the sheet as .csv or .xlsx (first worksheet), e.g. the file from export_address_request.py.
Usage:
  python3 scripts/import_address_review.py --client-id <uuid> --csv reviewed.csv|.xlsx [--apply]
"""
import argparse
import csv
import os
import re
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clean_contacts import norm_street, title_name  # noqa: E402

ADDRESS_FLAGS = ["no_current_address_sold_or_seller_side", "purchase_5plus_years_ago_may_have_moved",
                 "zip_is_city_default_validate_with_usps", "zip_missing", "address_truncated_or_incomplete",
                 "address_differs_from_purchase", "county_owner_changed", "county_review",
                 "address_requested_from_agent"]

SET_ADDRESS = """
UPDATE contacts SET mail_street = %(street)s, mail_city = %(city)s, mail_state = %(state)s,
  mail_zip = %(zip)s, address_status = 'verified', address_verified_at = now(),
  review_reasons = ARRAY(SELECT r FROM unnest(review_reasons) r WHERE r <> ALL(%(flags)s))
WHERE id = %(id)s AND client_id = %(client_id)s
"""
CONFIRM = """
UPDATE contacts SET address_status = 'verified', address_verified_at = now(),
  review_reasons = ARRAY(SELECT r FROM unnest(review_reasons) r WHERE r <> ALL(%(flags)s))
WHERE id = %(id)s AND client_id = %(client_id)s AND mail_street IS NOT NULL
"""
DO_NOT_MAIL = """
UPDATE contacts SET do_not_mail = true, opted_out_at = COALESCE(opted_out_at, now()),
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('review_note', %(note)s::text)
WHERE id = %(id)s AND client_id = %(client_id)s
"""


def clean(v):
    return re.sub(r"\s+", " ", (v or "")).strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--client-id", required=True)
    ap.add_argument("--csv", required=True)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    uuid.UUID(a.client_id)

    plan, problems = [], []
    if a.csv.lower().endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        ws = load_workbook(a.csv, read_only=True, data_only=True).worksheets[0]
        it = ws.iter_rows(values_only=True)
        header = [str(h or "").strip() for h in next(it)]
        sheet = [{k: ("" if v is None else str(v)) for k, v in zip(header, row)} for row in it]
    else:
        with open(a.csv, encoding="utf-8-sig", newline="") as f:
            sheet = list(csv.DictReader(f))
    if True:
        for i, r in enumerate(sheet, start=2):  # row 1 is the header
            cid = clean(r.get("contact_id"))
            street, city = clean(r.get("NEW_street")), clean(r.get("NEW_city"))
            state = clean(r.get("NEW_state")).upper() or ("MN" if street else "")
            zipc = re.sub(r"\D", "", r.get("NEW_zip") or "")[:5]
            action = clean(r.get("ACTION")).upper()
            if not (street or city or zipc or action):
                continue
            try:
                uuid.UUID(cid)
            except ValueError:
                problems.append(f"row {i}: missing/invalid contact_id")
                continue
            if street or city or zipc:
                if not (street and city):
                    problems.append(f"row {i}: new address needs at least street and city")
                    continue
                if zipc and len(zipc) != 5:
                    problems.append(f"row {i}: ZIP must be 5 digits")
                    continue
                if len(state) != 2:
                    problems.append(f"row {i}: state must be 2 letters")
                    continue
                plan.append(("address", {"id": cid, "street": norm_street(street), "city": title_name(city),
                                         "state": state, "zip": zipc or None}))
            elif action == "CONFIRMED":
                plan.append(("confirm", {"id": cid}))
            elif action == "DO NOT MAIL":
                plan.append(("dnm", {"id": cid, "note": clean(r.get("notes")) or "do not mail (agent review)"}))
            elif action.startswith("SAME AS"):
                plan.append(("dnm", {"id": cid, "note": f"duplicate of {action[7:].strip()} (agent review)"}))
            else:
                problems.append(f"row {i}: unknown ACTION (use CONFIRMED, DO NOT MAIL or SAME AS <contact_id>)")

    if problems:
        print(f"{len(problems)} row(s) need fixing in the sheet first:")
        for p in problems[:30]:
            print("  -", p)
        sys.exit(1)
    from collections import Counter
    print("planned:", dict(Counter(k for k, _ in plan)))
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL not set -- validation only.")
        return
    import psycopg
    sql = {"address": SET_ADDRESS, "confirm": CONFIRM, "dnm": DO_NOT_MAIL}
    with psycopg.connect(url) as conn:
        done, missing = Counter(), 0
        for kind, p in plan:
            cur = conn.execute(sql[kind], {**p, "client_id": a.client_id, "flags": ADDRESS_FLAGS})
            if cur.rowcount:
                done[kind] += 1
            else:
                missing += 1
        print(("APPLIED: " if a.apply else "DRY RUN (rolled back): ") + str(dict(done)) +
              (f"  ({missing} row(s) matched no contact for this client)" if missing else ""))
        conn.commit() if a.apply else conn.rollback()


if __name__ == "__main__":
    main()
