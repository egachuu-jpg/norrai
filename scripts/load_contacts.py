#!/usr/bin/env python3
"""Load the cleaned household list (output of clean_contacts.py) into Neon.

Writes `contacts` (one row per household) and `contact_transactions` (one row per deal).
Safe to re-run: rows are upserted on (client_id, source, source_key|source_ref), and a re-run
never overwrites hand-curated data:
  - stage is DERIVED after every load from each contact's deals (any active/pending deal ->
    active_client, else any closed deal -> past_client); contacts with stage_locked are skipped,
    and contacts whose deals are all cancelled get 'only_cancelled_deals' and become prospect
    (they never closed with the agent)
  - a household whose deals are all cancelled is never created; it is only updated if it exists
  - a household already loaded from ANOTHER source (e.g. Back Agent, then BrokerSumo) is
    matched by person name and merged into the existing contact, not duplicated; a deal that
    already exists from the other source (same contact, close date and street) is skipped
  - address is kept if address_status is 'verified' or 'undeliverable'
  - opt-out / do_not_mail flags are never touched

DRY RUN IS THE DEFAULT. Nothing is written without --apply.

Requires:  pip install "psycopg[binary]"   and   DATABASE_URL in the environment
           (the pooled Neon string from .env -- it is read from the environment and never printed).

Usage:
  export DATABASE_URL=...            # e.g.  set -a; . ./.env; set +a
  python3 scripts/load_contacts.py --client-id <uuid> \\
      --households OUT/households.csv --transactions OUT/transactions_clean.csv           # dry run
  python3 scripts/load_contacts.py ... --apply                                            # write

Optional: --unmatched OUT/contacts_unmatched.csv loads the rest of the contact book as
stage 'sphere' (vendors/colleagues flagged in metadata).
"""
import argparse
import csv
import datetime
import hashlib
import json
import os
import re
import sys
import uuid

SIDES = {"Buyer", "Seller", "Landlord", "Tenant"}
NICK = {"dave": "david", "mike": "michael", "bob": "robert", "rob": "robert", "bill": "william",
        "will": "william", "jim": "james", "tom": "thomas", "tim": "timothy", "steve": "steven",
        "chris": "christopher", "matt": "matthew", "dan": "daniel", "joe": "joseph",
        "jeff": "jeffrey", "greg": "gregory", "ken": "kenneth", "ron": "ronald", "don": "donald",
        "rick": "richard", "rich": "richard", "pat": "patrick", "tony": "anthony", "andy": "andrew",
        "nick": "nicholas", "sue": "susan", "kate": "katherine", "katie": "katherine",
        "liz": "elizabeth", "beth": "elizabeth", "jen": "jennifer", "jenny": "jennifer"}


def n(v):
    """Empty string -> None."""
    v = (v or "").strip()
    return v or None


def d(v):
    v = (v or "").strip()
    return datetime.date.fromisoformat(v) if v else None


def canon(first, last):
    f = re.sub(r"[^a-z]", "", (first or "").lower())
    return NICK.get(f, f) + "|" + re.sub(r"[^a-z]", "", (last or "").lower())


def household_key(row):
    people = [canon(row["person_1_first"], row["person_1_last"])]
    if row.get("person_2_first") or row.get("person_2_last"):
        people.append(canon(row["person_2_first"], row["person_2_last"]))
    return hashlib.sha1("&".join(sorted(people)).encode()).hexdigest()[:20]


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def build(households, transactions, unmatched):
    """Validate + shape everything in memory before touching the database."""
    contacts, errors, seen = [], [], {}
    for h in households:
        key = household_key(h)
        if key in seen:
            errors.append(f"duplicate household key: {h['household_id']} and {seen[key]}")
            continue
        seen[key] = h["household_id"]
        if not (h.get("display_name") or "").strip():
            errors.append(f"{h['household_id']}: empty display_name")
            continue
        contacts.append({
            "hid": h["household_id"], "source": n(h.get("source")) or "back_agent", "source_key": key,
            "people": [canon(h["person_1_first"], h["person_1_last"])] +
                      ([canon(h["person_2_first"], h["person_2_last"])]
                       if (h.get("person_2_first") or h.get("person_2_last")) else []),
            "display_name": h["display_name"].strip(),
            "first_name": n(h["person_1_first"]), "last_name": n(h["person_1_last"]),
            "second_first_name": n(h["person_2_first"]), "second_last_name": n(h["person_2_last"]),
            "phone": n(h["phone"]), "email": n(h["email"]),
            "mail_street": n(h["mail_street"]), "mail_city": n(h["mail_city"]),
            "mail_state": n(h["mail_state"]), "mail_zip": n(h["mail_zip"]),
            "address_status": h["address_status"],
            "review_reasons": [r for r in (h.get("review_reasons") or "").split(";") if r],
            "first_closing": d(h["first_closing"]), "last_closing": d(h["last_closing"]),
            "deal_count": int(h["deal_count"] or 0),
            "stage": n(h.get("stage")) or "past_client",
            "cancelled_only": (h.get("cancelled_only") or "").strip() == "True",
            "metadata": {"contact_match": h.get("contact_match"),
                         "last_known_property": n(h.get("last_known_property"))},
        })
    hid_to_key = {c["hid"]: c["source_key"] for c in contacts}

    txs = []
    for t in transactions:
        hid = t.get("household_id")
        if hid not in hid_to_key:
            errors.append(f"transaction for unknown household {hid!r}")
            continue
        if t["side"] not in SIDES:
            errors.append(f"{hid}: unexpected side {t['side']!r}")
            continue
        if not n(t.get("detail_url")):
            errors.append(f"{hid}: transaction has no source reference")
            continue
        txs.append({
            "contact_key": hid_to_key[hid], "hid": hid, "side": t["side"],
            "closing_date": d(t["closing_date"]), "started_date": d(t["started_date"]),
            "phase": n(t["phase"]), "agent_name": n(t["agent"]),
            "street": n(t["street"]), "city": n(t["city"]), "state": n(t["state"]), "zip": n(t["zip"]),
            "address_incomplete": t["address_incomplete"] == "True",
            "deal_status": n(t.get("deal_status")) or "closed",
            "source": n(t.get("source")) or "back_agent", "source_ref": t["detail_url"].strip(),
        })

    sphere = []
    for u in unmatched:
        ident = (u.get("email") or u.get("phone") or u.get("name") or "").strip().lower()
        if not ident or not (u.get("name") or "").strip():
            continue
        flags = [f for f in (u.get("flags") or "").split(";") if f]
        has_addr = bool(n(u.get("street"))) and "office_address_likely_colleague" not in flags
        sphere.append({
            "source": "contacts_export", "source_key": hashlib.sha1(ident.encode()).hexdigest()[:20],
            "display_name": u["name"].strip(),
            "first_name": n(u.get("given")), "last_name": n(u.get("family")),
            "second_first_name": None, "second_last_name": None,
            "first_closing": None, "last_closing": None,
            "phone": n(u.get("phone")), "email": n(u.get("email")),
            "mail_street": n(u["street"]) if has_addr else None,
            "mail_city": n(u["city"]) if has_addr else None,
            "mail_state": n(u["state"]) if has_addr else None,
            "mail_zip": n(u["zip"]) if has_addr else None,
            "address_status": "contact_file" if has_addr else "needs_lookup",
            "review_reasons": flags, "stage": "sphere", "deal_count": 0,
            "metadata": {"organization": n(u.get("organization"))},
        })
    return contacts, txs, sphere, errors


UPSERT_CONTACT = """
INSERT INTO contacts (client_id, display_name, first_name, last_name, second_first_name,
  second_last_name, phone, email, mail_street, mail_city, mail_state, mail_zip, address_status,
  stage, review_reasons, first_closing, last_closing, deal_count, source, source_key, metadata)
VALUES (%(client_id)s, %(display_name)s, %(first_name)s, %(last_name)s, %(second_first_name)s,
  %(second_last_name)s, %(phone)s, %(email)s, %(mail_street)s, %(mail_city)s, %(mail_state)s,
  %(mail_zip)s, %(address_status)s, %(stage)s, %(review_reasons)s, %(first_closing)s,
  %(last_closing)s, %(deal_count)s, %(source)s, %(source_key)s, %(metadata)s)
ON CONFLICT (client_id, source, source_key) WHERE source IS NOT NULL AND source_key IS NOT NULL
DO UPDATE SET
  display_name   = EXCLUDED.display_name,
  first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
  second_first_name = EXCLUDED.second_first_name, second_last_name = EXCLUDED.second_last_name,
  phone = COALESCE(EXCLUDED.phone, contacts.phone), email = COALESCE(EXCLUDED.email, contacts.email),
  mail_street = CASE WHEN contacts.address_status IN ('verified','undeliverable') THEN contacts.mail_street ELSE EXCLUDED.mail_street END,
  mail_city   = CASE WHEN contacts.address_status IN ('verified','undeliverable') THEN contacts.mail_city   ELSE EXCLUDED.mail_city   END,
  mail_state  = CASE WHEN contacts.address_status IN ('verified','undeliverable') THEN contacts.mail_state  ELSE EXCLUDED.mail_state  END,
  mail_zip    = CASE WHEN contacts.address_status IN ('verified','undeliverable') THEN contacts.mail_zip    ELSE EXCLUDED.mail_zip    END,
  address_status = CASE WHEN contacts.address_status IN ('verified','undeliverable') THEN contacts.address_status ELSE EXCLUDED.address_status END,
  review_reasons = EXCLUDED.review_reasons,
  first_closing = EXCLUDED.first_closing, last_closing = EXCLUDED.last_closing,
  deal_count = EXCLUDED.deal_count,
  metadata = COALESCE(contacts.metadata, '{}'::jsonb) || EXCLUDED.metadata
  -- stage is recomputed from deals after the load; opt-out / do_not_mail never touched
RETURNING id, source_key, (xmax = 0) AS inserted
"""

UPSERT_TX = """
INSERT INTO contact_transactions (contact_id, client_id, side, closing_date, started_date, phase,
  agent_name, street, city, state, zip, address_incomplete, source, source_ref, deal_status)
VALUES (%(contact_id)s, %(client_id)s, %(side)s, %(closing_date)s, %(started_date)s, %(phase)s,
  %(agent_name)s, %(street)s, %(city)s, %(state)s, %(zip)s, %(address_incomplete)s, %(source)s,
  %(source_ref)s, %(deal_status)s)
ON CONFLICT (client_id, source, source_ref) WHERE source IS NOT NULL AND source_ref IS NOT NULL
DO UPDATE SET contact_id = EXCLUDED.contact_id, side = EXCLUDED.side,
  closing_date = EXCLUDED.closing_date, started_date = EXCLUDED.started_date, phase = EXCLUDED.phase,
  agent_name = EXCLUDED.agent_name, street = EXCLUDED.street, city = EXCLUDED.city,
  state = EXCLUDED.state, zip = EXCLUDED.zip, address_incomplete = EXCLUDED.address_incomplete,
  deal_status = EXCLUDED.deal_status
RETURNING (xmax = 0) AS inserted
"""


MERGE_CONTACT = """
UPDATE contacts SET
  display_name = CASE WHEN length(%(display_name)s::text) > length(display_name)
                      THEN %(display_name)s::text ELSE display_name END,
  second_first_name = COALESCE(second_first_name, %(second_first_name)s::text),
  second_last_name  = COALESCE(second_last_name, %(second_last_name)s::text),
  phone = COALESCE(phone, %(phone)s::text), email = COALESCE(email, %(email)s::text),
  mail_street = CASE WHEN %(take_addr)s::boolean THEN %(mail_street)s::text ELSE mail_street END,
  mail_city   = CASE WHEN %(take_addr)s::boolean THEN %(mail_city)s::text   ELSE mail_city   END,
  mail_state  = CASE WHEN %(take_addr)s::boolean THEN %(mail_state)s::text  ELSE mail_state  END,
  mail_zip    = CASE WHEN %(take_addr)s::boolean THEN %(mail_zip)s::text    ELSE mail_zip    END,
  address_status = CASE WHEN %(take_addr)s::boolean THEN %(address_status)s::text ELSE address_status END,
  review_reasons = CASE WHEN %(take_addr)s::boolean THEN %(review_reasons)s::text[] ELSE review_reasons END,
  metadata = COALESCE(metadata, '{}'::jsonb)
             || jsonb_build_object('also_in_' || %(source)s::text, %(source_key)s::text)
WHERE id = %(id)s::uuid
"""

RECOMPUTE = """
UPDATE contacts c SET
  deal_count = x.n_live, first_closing = x.mn, last_closing = x.mx,
  stage = CASE WHEN c.stage_locked THEN c.stage
               WHEN x.n_open > 0 THEN 'active_client'
               WHEN x.n_closed > 0 THEN 'past_client'
               WHEN c.stage IN ('active_client', 'past_client') THEN 'prospect'  -- never closed: deals all cancelled
               ELSE c.stage END,
  review_reasons = CASE WHEN x.n_live = 0
                        THEN array_append(array_remove(c.review_reasons, 'only_cancelled_deals'), 'only_cancelled_deals')
                        ELSE array_remove(c.review_reasons, 'only_cancelled_deals') END
FROM (SELECT contact_id,
             count(*) FILTER (WHERE deal_status <> 'cancelled') AS n_live,
             count(*) FILTER (WHERE deal_status IN ('active', 'pending')) AS n_open,
             count(*) FILTER (WHERE deal_status = 'closed') AS n_closed,
             min(closing_date) FILTER (WHERE deal_status = 'closed') AS mn,
             max(closing_date) FILTER (WHERE deal_status = 'closed') AS mx
      FROM contact_transactions WHERE client_id = %(client_id)s GROUP BY contact_id) x
WHERE c.id = x.contact_id
"""


FLAG_DUPLICATES = """
WITH people AS (
  SELECT id, lower(first_name) AS f, lower(last_name) AS l FROM contacts
   WHERE client_id = %(client_id)s AND first_name IS NOT NULL AND last_name IS NOT NULL
     AND stage IN ('past_client', 'active_client', 'prospect') AND NOT do_not_mail
  UNION
  SELECT id, lower(second_first_name), lower(second_last_name) FROM contacts
   WHERE client_id = %(client_id)s AND second_first_name IS NOT NULL AND second_last_name IS NOT NULL
     AND stage IN ('past_client', 'active_client', 'prospect') AND NOT do_not_mail),
dup AS (SELECT DISTINCT a.id FROM people a JOIN people b ON a.f = b.f AND a.l = b.l AND a.id <> b.id)
UPDATE contacts c SET review_reasons = CASE
    WHEN c.id IN (SELECT id FROM dup)
      THEN array_append(array_remove(c.review_reasons, 'possible_duplicate_contact'), 'possible_duplicate_contact')
    ELSE array_remove(c.review_reasons, 'possible_duplicate_contact') END
WHERE c.client_id = %(client_id)s
"""
# (a person's name on two live contacts = the same family loaded twice, or two people with
#  the same name; either way the agent decides on the review sheet)


def street_key(street):
    return re.sub(r"[^a-z0-9]", "", (street or "").lower())


def house_no(street):
    m = re.match(r"\s*(\d+)", street or "")
    return m.group(1) if m else None


def same_deal(existing, t):
    """The same sale recorded by two systems: same side, close dates within 3 days,
    same street (normalized) or same house number."""
    side, cd, street, src = existing
    if src == t["source"] or side != t["side"] or not cd or not t["closing_date"]:
        return False
    if abs((cd - t["closing_date"]).days) > 3:
        return False
    return street_key(street) == street_key(t["street"]) or (
        house_no(street) is not None and house_no(street) == house_no(t["street"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--client-id", required=True, help="clients.id of the agent whose book this is")
    ap.add_argument("--households", required=True)
    ap.add_argument("--transactions", required=True)
    ap.add_argument("--unmatched", help="contacts_unmatched.csv -> loaded as stage 'sphere'")
    ap.add_argument("--apply", action="store_true", help="actually write (default: dry run)")
    a = ap.parse_args()

    try:
        uuid.UUID(a.client_id)
    except ValueError:
        sys.exit("--client-id must be a UUID")

    contacts, txs, sphere, errors = build(
        read_csv(a.households), read_csv(a.transactions), read_csv(a.unmatched) if a.unmatched else [])
    if errors:
        print(f"{len(errors)} problem(s) in the input -- fix before loading:")
        for e in errors[:20]:
            print("  -", e)
        sys.exit(1)

    print(f"input ok: {len(contacts)} households, {len(txs)} transactions, {len(sphere)} sphere contacts")
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL not set -- offline validation only.")
        return
    import psycopg
    from psycopg.types.json import Jsonb

    with psycopg.connect(url) as conn:
        row = conn.execute("SELECT business_name FROM clients WHERE id = %s", (a.client_id,)).fetchone()
        if not row:
            sys.exit("No client with that id in this database.")
        print(f"client: {row[0]}")
        stats = {"contacts_inserted": 0, "contacts_updated": 0, "contacts_merged": 0,
                 "merge_ambiguous": 0, "tx_inserted": 0, "tx_updated": 0, "tx_skipped_duplicate": 0}

        # existing contacts for this client, indexed by person, for cross-source merging
        existing = conn.execute(
            """SELECT id, source, source_key, first_name, last_name, second_first_name, second_last_name,
                      address_status, last_closing FROM contacts WHERE client_id = %s""",
            (a.client_id,)).fetchall()
        by_src_key = {(r[1], r[2]): r for r in existing}
        by_person = {}
        for r in existing:
            for f, l in ((r[3], r[4]), (r[5], r[6])):
                if f or l:
                    by_person.setdefault(canon(f, l), set()).add(r[0])
        info = {r[0]: r for r in existing}

        before = dict(conn.execute("SELECT id, stage FROM contacts WHERE client_id = %s",
                                   (a.client_id,)).fetchall())
        stats["skipped_cancelled_only"] = 0
        key_to_id = {}
        for c in contacts + sphere:
            params = {**c, "client_id": a.client_id, "metadata": Jsonb(c["metadata"])}
            target = None
            if (c["source"], c["source_key"]) not in by_src_key and c.get("people"):
                ids = set()
                for pk in c["people"]:
                    ids |= by_person.get(pk, set())
                if len(ids) == 1:
                    target = ids.pop()
                elif len(ids) > 1:
                    stats["merge_ambiguous"] += 1  # inserted as its own contact; flagged below
                    params["review_reasons"] = c["review_reasons"] + ["possible_duplicate_contact"]
            if c.get("cancelled_only") and not target and (c["source"], c["source_key"]) not in by_src_key:
                stats["skipped_cancelled_only"] += 1  # never closed with the agent: not a client
                continue
            if target:
                ex = info[target]
                ex_status, ex_last = ex[7], ex[8]
                take = (ex_status not in ("verified", "undeliverable") and c["address_status"] != "needs_lookup"
                        and (ex_status == "needs_lookup" or (c["last_closing"] and (not ex_last or c["last_closing"] > ex_last))))
                conn.execute(MERGE_CONTACT, {**params, "id": target, "take_addr": take})
                key_to_id[(c["source"], c["source_key"])] = target
                stats["contacts_merged"] += 1
                continue
            cid, key, inserted = conn.execute(UPSERT_CONTACT, params).fetchone()
            key_to_id[(c["source"], key)] = cid
            stats["contacts_inserted" if inserted else "contacts_updated"] += 1

        # deals already recorded from another source (see same_deal)
        deals_by_contact = {}
        for r in conn.execute("""SELECT contact_id, side, closing_date, street, source
                                 FROM contact_transactions WHERE client_id = %s""", (a.client_id,)).fetchall():
            deals_by_contact.setdefault(r[0], []).append(r[1:])
        own_refs = {(r[0], r[1]) for r in conn.execute(
            "SELECT source, source_ref FROM contact_transactions WHERE client_id = %s", (a.client_id,)).fetchall()}
        for t in txs:
            contact_id = key_to_id.get((t["source"], t["contact_key"]))
            if contact_id is None:
                continue  # household skipped (cancelled only)
            if (t["source"], t["source_ref"]) not in own_refs and any(
                    same_deal(e, t) for e in deals_by_contact.get(contact_id, [])):
                stats["tx_skipped_duplicate"] += 1
                continue
            params = {**t, "client_id": a.client_id, "contact_id": contact_id}
            (inserted,) = conn.execute(UPSERT_TX, params).fetchone()
            deals_by_contact.setdefault(contact_id, []).append(
                (t["side"], t["closing_date"], t["street"], t["source"]))
            stats["tx_inserted" if inserted else "tx_updated"] += 1

        conn.execute(RECOMPUTE, {"client_id": a.client_id})
        conn.execute(FLAG_DUPLICATES, {"client_id": a.client_id})
        after_rows = dict(conn.execute("SELECT id, stage FROM contacts WHERE client_id = %s",
                                       (a.client_id,)).fetchall())
        moves = {}
        for cid, st in after_rows.items():
            if cid in before and before[cid] != st:
                k = before[cid] + " -> " + st
                moves[k] = moves.get(k, 0) + 1
        print("stage changes on existing contacts:", moves or "none")
        after = conn.execute(
            """SELECT stage, count(*) FROM contacts WHERE client_id = %s GROUP BY stage ORDER BY stage""",
            (a.client_id,)).fetchall()
        n_tx = conn.execute("SELECT count(*) FROM contact_transactions WHERE client_id = %s",
                            (a.client_id,)).fetchone()[0]
        print("after load -> contacts by stage:", dict(after), " deals:", n_tx)
        print(("APPLIED: " if a.apply else "DRY RUN (rolled back): ") + json.dumps(stats))
        if a.apply:
            conn.commit()
        else:
            conn.rollback()


if __name__ == "__main__":
    main()
