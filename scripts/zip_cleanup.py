#!/usr/bin/env python3
"""Fill in / verify ZIP codes with the free US Census Bureau batch geocoder (no account needed).

Checks every mailable contact whose ZIP is missing or was only a city-default placeholder
(review flag zip_missing / zip_is_city_default_validate_with_usps). Only the STREET ADDRESS is sent
to geocoding.geo.census.gov -- never names, phones or emails.

A Census match updates the record when it is Exact, or Non_Exact with the same house number and
city (e.g. "Co Rd" vs "County Road"). Only the ZIP changes -- street text, status and everything
else are left alone. Other non-exact, tied or unmatched addresses are reported, not changed.

DRY RUN IS THE DEFAULT (--apply to write). Prints counts only.
Usage:
  python3 scripts/zip_cleanup.py --client-id <uuid> [--apply]
"""
import argparse
import csv
import io
import os
import sys
import urllib.request
import uuid

CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
QUERY = """
SELECT id::text, mail_street, mail_city, COALESCE(mail_state, 'MN'), mail_zip
FROM contacts
WHERE client_id = %s AND stage IN ('past_client', 'active_client') AND NOT do_not_mail
  AND address_status IN ('buyer_property', 'contact_file', 'verified', 'county_record')
  AND mail_street IS NOT NULL AND mail_city IS NOT NULL
  AND (mail_zip IS NULL OR mail_zip !~ '^[0-9]{5}$'
       OR 'zip_missing' = ANY(review_reasons)
       OR 'zip_is_city_default_validate_with_usps' = ANY(review_reasons))
"""
UPDATE = """
UPDATE contacts SET mail_zip = %(zip)s,
  review_reasons = array_remove(array_remove(review_reasons, 'zip_missing'),
                                'zip_is_city_default_validate_with_usps'),
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('zip_source', 'census_geocoder')
WHERE id = %(id)s::uuid AND client_id = %(client_id)s::uuid
"""


def census_batch(rows):
    """rows: [(id, street, city, state)] -> {id: (status, match_type, matched_address)}"""
    buf = io.StringIO()
    w = csv.writer(buf)
    for rid, street, city, state in rows:
        w.writerow([rid, street, city, state, ""])
    boundary = "----norrai" + uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"benchmark\"\r\n\r\nPublic_AR_Current\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"addressFile\"; filename=\"a.csv\"\r\n"
            f"Content-Type: text/csv\r\n\r\n{buf.getvalue()}\r\n--{boundary}--\r\n").encode()
    req = urllib.request.Request(CENSUS, data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=300) as r:
        text = r.read().decode("utf-8", "replace")
    out = {}
    for rec in csv.reader(io.StringIO(text)):
        if len(rec) >= 3:
            out[rec[0]] = (rec[2], rec[3] if len(rec) > 3 else "", rec[4] if len(rec) > 4 else "")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--client-id", required=True)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set.")
    import psycopg
    from collections import Counter
    with psycopg.connect(url) as conn:
        rows = conn.execute(QUERY, (a.client_id,)).fetchall()
        print(f"addresses to check: {len(rows)}  (no ZIP: {sum(1 for r in rows if not r[4])})")
        if not rows:
            return
        res = {}
        for i in range(0, len(rows), 9000):  # Census batch limit is 10,000
            res.update(census_batch([(r[0], r[1], r[2], r[3]) for r in rows[i:i + 9000]]))
        outcome, planned = Counter(), []
        for rid, street, city, state, zipc in rows:
            status, mtype, matched = res.get(rid, ("No_Response", "", ""))
            new_zip = matched.rsplit(",", 1)[-1].strip() if matched else ""
            parts = [x.strip().lower() for x in matched.split(",")] if matched else []
            same_spot = (len(parts) >= 2 and parts[0].split(" ")[0] == (street or "").strip().split(" ")[0].lower()
                         and parts[1] == (city or "").strip().lower())
            ok = status == "Match" and (mtype == "Exact" or same_spot)
            if ok and len(new_zip) == 5 and new_zip.isdigit():
                if not zipc:
                    outcome["zip_filled"] += 1
                elif zipc == new_zip:
                    outcome["placeholder_zip_confirmed"] += 1
                else:
                    outcome["placeholder_zip_corrected"] += 1
                planned.append({"id": rid, "zip": new_zip, "client_id": a.client_id})
            else:
                outcome[f"not_changed_{status.lower()}{'_' + mtype.lower() if mtype else ''}"] += 1
        print("results:", dict(outcome))
        for p in planned:
            conn.execute(UPDATE, p)
        print(("APPLIED: " if a.apply else "DRY RUN (rolled back): ") + f"{len(planned)} contacts updated")
        conn.commit() if a.apply else conn.rollback()


if __name__ == "__main__":
    main()
