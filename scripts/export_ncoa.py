#!/usr/bin/env python3
"""Export a client's mailing list in the layout NCOA / CASS providers expect.

One row per household:
  address_source = current     -> the contact's mailing address (NCOA says whether they moved;
                                  CASS fixes ZIPs/abbreviations even if they did not)
  address_source = last_sold   -> no current address (seller who moved): the house they SOLD,
                                  so NCOA can return the forwarding address they filed with USPS
Skipped: prospects, sphere, do_not_mail, verified/undeliverable addresses, and active clients with
no current address (they still live in the house they are selling).

record_id is the contact id -- keep it in the provider's output so results can be matched back.
Usage:
  python3 scripts/export_ncoa.py --client-id <uuid> -o ncoa_input.csv
Requires DATABASE_URL and `pip install "psycopg[binary]"`. Prints counts only.
"""
import argparse
import csv
import os
import sys

QUERY = """
SELECT c.id::text, c.first_name, c.last_name, c.display_name, c.stage, c.address_status,
       c.mail_street, c.mail_city, c.mail_state, c.mail_zip,
       sold.street, sold.city, sold.state, sold.zip, sold.closing_date
FROM contacts c
LEFT JOIN LATERAL (
  SELECT t.street, t.city, t.state, t.zip, t.closing_date FROM contact_transactions t
  WHERE t.contact_id = c.id AND t.side = 'Seller' AND t.deal_status = 'closed'
  ORDER BY t.closing_date DESC LIMIT 1) sold ON TRUE
WHERE c.client_id = %s AND c.stage IN ('past_client', 'active_client') AND NOT c.do_not_mail
  AND c.address_status NOT IN ('verified', 'undeliverable')
"""
COLS = ["record_id", "address_source", "first_name", "last_name", "full_name",
        "address1", "city", "state", "zip"]


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

    out, skipped = [], {"active_seller_still_at_listing": 0, "no_address_at_all": 0}
    for (cid, first, last, display, stage, status, st, city, state, zipc,
         s_st, s_city, s_state, s_zip, s_date) in rows:
        if status != "needs_lookup" and st:
            src, addr = "current", (st, city, state, zipc)
        elif stage == "active_client":
            skipped["active_seller_still_at_listing"] += 1
            continue
        elif s_st:
            src, addr = "last_sold", (s_st, s_city, s_state, s_zip)
        else:
            skipped["no_address_at_all"] += 1
            continue
        out.append({"record_id": cid, "address_source": src, "first_name": first or "",
                    "last_name": last or "", "full_name": display or "",
                    "address1": addr[0] or "", "city": addr[1] or "", "state": addr[2] or "MN",
                    "zip": addr[3] or ""})
    with open(a.output, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows(out)
    from collections import Counter
    print("records:", len(out), dict(Counter(r["address_source"] for r in out)))
    print("missing ZIP:", sum(1 for r in out if not r["zip"]), " skipped:", skipped)
    print("wrote", a.output)


if __name__ == "__main__":
    main()
