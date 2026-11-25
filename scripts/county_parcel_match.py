#!/usr/bin/env python3
"""Check a client's contacts against county tax-parcel records (Rice + Steele, MN).

Public data from the Minnesota Geospatial Commons (gis.data.mn.gov):
  Rice    the county's TaxParcels service (owner name + owner mailing address + sale date)
  Steele  the statewide "Parcels, Compiled from Opt-In Open Data Counties" layer
Downloaded once into --cache-dir (outside the repo; refreshed after 7 days).

For each past/active client whose address is not already verified/county_record:
  A. has a current address -> find the parcel at that address
       owner is still them          -> CONFIRMED: use the owner mailing address (where the county
                                       sends their tax statement)
       owner changed (they sold)    -> search for them elsewhere (B); if not found the address is
                                       marked needs_lookup + 'county_owner_changed'
       parcel not found             -> left alone (outside Rice/Steele, or address mismatch)
  B. no current address (sellers who moved) -> search owner names for them
       exactly one owner mailing address among their parcels (homestead preferred) -> FOUND
       several possibilities        -> AMBIGUOUS, left for the agent
       nothing                      -> left for NCOA / the agent
Name rule: an owner record matches a person when it contains BOTH their first and last name
(nicknames normalized).
Confidence tiers -- only STRONG results are written as county_record / owner_changed:
  strong   confirmed owner; or a new address where every household member is on the owner record
           (and, when they came from an "owner changed" property, the county shows a sale dated
           after their purchase); or owner changed with that later sale date
  review   anything weaker (one spouse of two, no sale date to confirm a move, ...) -> the contact
           gets review flag 'county_review' and metadata.county_suggestion for the agent's sheet
Nothing is deleted.

DRY RUN IS THE DEFAULT (--apply to write). Prints counts only; a row-level results CSV for
spot checks is written to --out (keep it outside the repo).
Usage:
  python3 scripts/county_parcel_match.py --client-id <uuid> --cache-dir DIR --out results.csv [--apply]
"""
import argparse
import csv
import datetime
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clean_contacts import canon_first, canon_last, norm_street, title_name, STREET_SUFFIX  # noqa: E402

SOURCES = {
    "Rice": {
        "url": "https://asr-arcgis01.ricecountymn.gov/arcgis/rest/services/Maps/TaxParcels/MapServer/1/query",
        "where": "1=1", "order": "OBJECTID",
        "fields": ["OWNER_NAME", "OWNER_MORE", "OWN_ADD_L1", "OWN_ADD_L2", "OWN_ADD_L3", "OWN_ADD_L4",
                   "SiteAddrFull", "SITUS_CITY", "ZIP", "HOMESTEAD", "SALE_DATE", "COUNTY_PIN"],
    },
    "Steele": {
        "url": "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_mngeo/plan_parcels_open/FeatureServer/0/query",
        "where": "co_name='Steele'", "order": "objectid",
        "fields": ["owner_name", "owner_more", "own_add_l1", "own_add_l2", "own_add_l3", "own_add_l4",
                   "anumber", "anumbersuf", "st_pre_dir", "st_pre_typ", "st_name", "st_pos_typ",
                   "st_pos_dir", "ctu_name", "zip", "homestead", "county_pin"],
    },
}
PAGE = 2000
ADDRESS_FLAGS = ["no_current_address_sold_or_seller_side", "purchase_5plus_years_ago_may_have_moved",
                 "zip_is_city_default_validate_with_usps", "zip_missing", "address_truncated_or_incomplete",
                 "address_differs_from_purchase", "county_owner_changed"]
DIRS = {"north": "n", "south": "s", "east": "e", "west": "w", "northeast": "ne", "northwest": "nw",
        "southeast": "se", "southwest": "sw"}
EXTRA = {"county": "co", "cty": "co", "cnty": "co", "highway": "hwy", "trunk": "hwy"}
SUFFIX_TOKENS = {v.lower() for v in STREET_SUFFIX.values()}
DIR_TOKENS = set(DIRS.values())
CITY_LINE = re.compile(r"^\s*(.*?)[\s,]+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?\s*$")


# ── download ───────────────────────────────────────────────────────────────────
def fetch(county, cache_dir):
    path = os.path.join(cache_dir, f"parcels_{county.lower()}.json")
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < 7 * 86400:
        with open(path) as f:
            return json.load(f)
    src, rows, offset = SOURCES[county], [], 0
    while True:
        q = urllib.parse.urlencode({
            "where": src["where"], "outFields": ",".join(src["fields"]), "returnGeometry": "false",
            "orderByFields": src["order"], "resultOffset": offset, "resultRecordCount": PAGE, "f": "json"})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(src["url"] + "?" + q, timeout=120) as r:
                    data = json.load(r)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(3)
        if "error" in data:
            sys.exit(f"{county}: {data['error'].get('message')}")
        feats = [f["attributes"] for f in data.get("features", [])]
        rows += feats
        print(f"  {county}: {len(rows)} parcels downloaded", flush=True)
        if len(feats) < PAGE and not data.get("exceededTransferLimit"):
            break
        offset += PAGE
    os.makedirs(cache_dir, exist_ok=True)
    with open(path, "w") as f:
        json.dump(rows, f)
    return rows


# ── normalization ─────────────────────────────────────────────────────────────
def name_tokens(s):
    return {canon_first(t) for t in re.findall(r"[a-z']+", (s or "").lower())} - {""}


def street_tokens(street):
    out = []
    for t in re.findall(r"[a-z0-9]+", (street or "").lower()):
        t = EXTRA.get(t, t)
        t = DIRS.get(t, t)
        t = STREET_SUFFIX.get(t, t).lower() if t in STREET_SUFFIX else t
        out.append(t)
    return out


def site_keys(street):
    toks = street_tokens(street)
    if not toks or not toks[0][:1].isdigit():
        return None, None
    full = " ".join(toks)
    core = " ".join([toks[0]] + [t for t in toks[1:] if t not in SUFFIX_TOKENS and t not in DIR_TOKENS])
    return full, core


def parse_owner_address(lines):
    lines = [l.strip() for l in lines if l and l.strip()]
    for i in range(len(lines) - 1, 0, -1):
        m = CITY_LINE.match(lines[i])
        if m:
            street = lines[i - 1]
            if not re.search(r"\d", street) and not street.upper().startswith("PO"):
                return None  # the line above the city is a name/"c/o", not a street
            return {"street": norm_street(street), "city": title_name(m.group(1)),
                    "state": m.group(2).upper(), "zip": m.group(3)}
    return None


def normalize(county, a):
    if county == "Rice":
        owner = " ".join(filter(None, [a.get("OWNER_NAME"), a.get("OWNER_MORE")]))
        lines = [a.get("OWN_ADD_L1"), a.get("OWN_ADD_L2"), a.get("OWN_ADD_L3"), a.get("OWN_ADD_L4")]
        site, city, home = a.get("SiteAddrFull"), a.get("SITUS_CITY"), a.get("HOMESTEAD")
        sd = a.get("SALE_DATE")
        sale = datetime.date(1970, 1, 1) + datetime.timedelta(milliseconds=sd) if isinstance(sd, (int, float)) else None
    else:
        owner = " ".join(filter(None, [a.get("owner_name"), a.get("owner_more")])).replace("/", " ")
        lines = [a.get("own_add_l1"), a.get("own_add_l2"), a.get("own_add_l3"), a.get("own_add_l4")]
        num = f'{a.get("anumber") or ""}{a.get("anumbersuf") or ""}'
        site = " ".join(str(x) for x in [num, a.get("st_pre_dir"), a.get("st_pre_typ"), a.get("st_name"),
                                         a.get("st_pos_typ"), a.get("st_pos_dir")] if x)
        city, home, sale = a.get("ctu_name"), a.get("homestead"), None
    full, core = site_keys(site)
    return {"county": county, "pin": str(a.get("COUNTY_PIN") or a.get("county_pin") or ""),
            "owner_tokens": name_tokens(owner), "owner_addr": parse_owner_address(lines),
            "site_full": full, "site_core": core, "site_city": (city or "").lower(),
            "homestead": str(home or "").lower().startswith("y"), "sale_date": sale}


# ── matching ──────────────────────────────────────────────────────────────────
def sold_after(here, bought):
    """County shows a sale of the property dated after the client bought it (Rice has dates)."""
    return bool(bought and any(h["sale_date"] and h["sale_date"] > bought for h in here))


def person_match(p, toks):
    return bool(p[0] and p[1] and p[0] in toks and p[1] in toks)


def find_at_address(street, city, by_full, by_core):
    full, core = site_keys(street)
    if not full:
        return []
    hits = by_full.get(full) or by_core.get(core) or []
    if len(hits) > 1 and city:
        same_city = [h for h in hits if h["site_city"] and h["site_city"] in city.lower()]
        hits = same_city or hits
    return hits


def search_owner(people, exclude_pins, by_last):
    cands = {}
    for p in people:
        for h in by_last.get(p[1], []):
            if h["pin"] not in exclude_pins and person_match(p, h["owner_tokens"]) and h["owner_addr"]:
                cands[h["county"] + h["pin"]] = h
    if not cands:
        return "not_found", None
    pool = [h for h in cands.values() if h["homestead"]] or list(cands.values())
    addrs = {(h["owner_addr"]["street"].lower(), h["owner_addr"]["zip"]) for h in pool}
    if len(addrs) == 1:
        return ("found_homestead" if pool[0]["homestead"] else "found_owner"), pool[0]
    return "ambiguous", None


CONTACTS = """
SELECT c.id::text, c.display_name, c.first_name, c.last_name, c.second_first_name, c.second_last_name,
       c.address_status, c.mail_street, c.mail_city,
       buy.closing_date, sold.street, sold.city
FROM contacts c
LEFT JOIN LATERAL (SELECT t.closing_date FROM contact_transactions t WHERE t.contact_id = c.id
                   AND t.side = 'Buyer' AND t.deal_status = 'closed' ORDER BY t.closing_date DESC LIMIT 1) buy ON TRUE
LEFT JOIN LATERAL (SELECT t.street, t.city FROM contact_transactions t WHERE t.contact_id = c.id
                   AND t.side = 'Seller' AND t.deal_status = 'closed' ORDER BY t.closing_date DESC LIMIT 1) sold ON TRUE
WHERE c.client_id = %s AND c.stage IN ('past_client', 'active_client') AND NOT c.do_not_mail
  AND c.address_status NOT IN ('verified', 'county_record', 'undeliverable')
"""
SET_COUNTY = """
UPDATE contacts SET mail_street = %(street)s, mail_city = %(city)s, mail_state = %(state)s, mail_zip = %(zip)s,
  address_status = 'county_record', address_verified_at = now(),
  review_reasons = ARRAY(SELECT r FROM unnest(review_reasons) r WHERE r <> ALL(%(flags)s)),
  metadata = COALESCE(metadata, '{}'::jsonb)
             || jsonb_build_object('county_match', %(result)s::text, 'county', %(county)s::text,
                                   'county_pin', %(pin)s::text, 'county_checked', now()::date::text)
WHERE id = %(id)s::uuid AND client_id = %(client_id)s::uuid
  AND address_status NOT IN ('verified', 'county_record', 'undeliverable')
"""
FLAG_REVIEW = """
UPDATE contacts SET
  review_reasons = array_append(array_remove(review_reasons, 'county_review'), 'county_review'),
  metadata = COALESCE(metadata, '{}'::jsonb)
             || jsonb_build_object('county_match', %(result)s::text, 'county_pin', %(pin)s::text,
                                   'county_suggestion', %(suggestion)s::text, 'county_checked', now()::date::text)
WHERE id = %(id)s::uuid AND client_id = %(client_id)s::uuid
  AND address_status NOT IN ('verified', 'county_record', 'undeliverable')
"""
MARK_SOLD = """
UPDATE contacts SET address_status = 'needs_lookup',
  review_reasons = array_append(array_remove(review_reasons, 'county_owner_changed'), 'county_owner_changed'),
  metadata = COALESCE(metadata, '{}'::jsonb)
             || jsonb_build_object('county_match', 'owner_changed', 'county_pin', %(pin)s::text,
                                   'county_checked', now()::date::text)
WHERE id = %(id)s::uuid AND client_id = %(client_id)s::uuid
  AND address_status IN ('buyer_property', 'contact_file')
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--client-id", required=True)
    ap.add_argument("--cache-dir", required=True)
    ap.add_argument("--out", required=True, help="row-level results CSV (contains names; keep outside the repo)")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set.")

    parcels = []
    for county in SOURCES:
        parcels += [normalize(county, r) for r in fetch(county, a.cache_dir)]
    by_full, by_core, by_last = defaultdict(list), defaultdict(list), defaultdict(list)
    for p in parcels:
        if p["site_full"]:
            by_full[p["site_full"]].append(p)
            by_core[p["site_core"]].append(p)
        for t in p["owner_tokens"]:
            by_last[t].append(p)
    print(f"parcels indexed: {len(parcels)}  (with owner mailing address: "
          f"{sum(1 for p in parcels if p['owner_addr'])})")

    import psycopg
    results = []
    with psycopg.connect(url) as conn:
        rows = conn.execute(CONTACTS, (a.client_id,)).fetchall()
        for (cid, display, f1, l1, f2, l2, status, st, city, bought, sold_st, sold_city) in rows:
            people = [(canon_first(f), canon_last(l)) for f, l in ((f1, l1), (f2, l2)) if f and l]
            res, hit, note, here = None, None, "", []
            if status != "needs_lookup" and st:
                here = find_at_address(st, city, by_full, by_core)
                if not here:
                    res = "not_in_county_data"
                else:
                    mine = [h for h in here if any(person_match(p, h["owner_tokens"]) for p in people)]
                    if mine:
                        hit = next((h for h in mine if h["owner_addr"]), None)
                        res = "confirmed_owner" if hit else "owner_no_mailing_address"
                    else:
                        res, hit = search_owner(people, {h["pin"] for h in here}, by_last)
                        note = "owner_changed"
                        if res in ("not_found", "ambiguous"):
                            res, hit = "owner_changed_" + res, here[0]
            else:
                sold_pins = {h["pin"] for h in find_at_address(sold_st, sold_city, by_full, by_core)} if sold_st else set()
                res, hit = search_owner(people, sold_pins, by_last)
            if res in ("found_homestead", "found_owner") and hit:
                on_record = sum(1 for p in people if person_match(p, hit["owner_tokens"]))
                strong = people and on_record == len(people)
                if note == "owner_changed":
                    strong = strong and sold_after(here, bought)
                if not strong:
                    res = "review_" + res
            elif res.startswith("owner_changed_") and not sold_after(here, bought):
                res = "review_owner_name_differs"
            results.append((cid, display, res, hit, note, st, city))

        stats = Counter(r[2] for r in results)
        print("results:", dict(sorted(stats.items())))
        applied = Counter()
        for cid, display, res, hit, note, st, city in results:
            p = {"id": cid, "client_id": a.client_id, "flags": ADDRESS_FLAGS}
            if res in ("confirmed_owner", "found_homestead", "found_owner") and hit and hit["owner_addr"]:
                cur = conn.execute(SET_COUNTY, {**p, **hit["owner_addr"], "result": res,
                                                "county": hit["county"], "pin": hit["pin"]})
                applied["set_county_record"] += cur.rowcount
            elif res.startswith("review_"):
                oa = (hit or {}).get("owner_addr")
                sug = f'{oa["street"]}, {oa["city"]}, {oa["state"]} {oa["zip"]}' if oa and res != "review_owner_name_differs" else ""
                cur = conn.execute(FLAG_REVIEW, {**p, "result": res, "pin": (hit or {}).get("pin", ""),
                                                 "suggestion": sug})
                applied["flagged_for_review"] += cur.rowcount
            elif res.startswith("owner_changed_"):
                cur = conn.execute(MARK_SOLD, {**p, "pin": hit["pin"] if hit else ""})
                applied["marked_owner_changed"] += cur.rowcount
        print(("APPLIED: " if a.apply else "DRY RUN (rolled back): ") + str(dict(applied)))
        conn.commit() if a.apply else conn.rollback()

    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["contact_id", "name", "result", "note", "county", "pin", "old_street", "old_city",
                    "new_street", "new_city", "new_state", "new_zip"])
        for cid, display, res, hit, note, st, city in results:
            oa = (hit or {}).get("owner_addr") or {}
            w.writerow([cid, display, res, note, (hit or {}).get("county", ""), (hit or {}).get("pin", ""),
                        st or "", city or "", oa.get("street", ""), oa.get("city", ""),
                        oa.get("state", ""), oa.get("zip", "")])
    print("results file:", a.out)


if __name__ == "__main__":
    main()
