#!/usr/bin/env python3
"""Clean a Back Agent transaction export + a contacts export into one deduped,
household-level client list ready for mailing labels / outreach.

Inputs  (paths are arguments -- client data never lives in the repo):
  --transactions  CSV of deals. --format back_agent (default): the Back Agent list scrape
                  (side, display_name, client, started, closing, detail_url, ...).
                  --format brokersumo: the BrokerSumo API extract (one row per party:
                  transaction_id, status_code, contact_name, contact_role, close_date, ...).
                  BrokerSumo status 3 and 8 are cancelled and dropped; a closed deal makes the
                  household past_client, an open or pending one active_client.
  --contacts      XLSX/CSV contacts export (vCard-style: GivenName, FamilyName, Phone, Email,
                  StreetAddress, Locality, Region, PostalCode, OrganizationName, ...)
  --out           output directory (created if missing)
  --office-street street fragment(s) that identify the brokerage office, so contacts at that
                  address are treated as colleagues, not clients (repeatable)

Outputs (in --out):
  households.csv           one row per client household, with a mailing address + status flag
  transactions_clean.csv   one row per deal, addresses normalized
  contacts_unmatched.csv   contacts that are not in the transaction data (sphere/vendors/etc.)

Nothing is verified against USPS or county records here -- address_status says how
trustworthy each mailing address is, and review_reasons says why a row needs a human look.

Usage:
  python3 scripts/clean_contacts.py --transactions tx.csv --contacts contacts.xlsx \
      --out /path/outside/repo --office-street "1801 Green"
"""
import argparse
import csv
import datetime
import os
import re
import sys
from collections import defaultdict

NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "md", "dds", "phd"}
NICKNAMES = {
    "dave": "david", "mike": "michael", "bob": "robert", "rob": "robert", "bill": "william",
    "will": "william", "jim": "james", "jimmy": "james", "tom": "thomas", "tim": "timothy",
    "steve": "steven", "chris": "christopher", "matt": "matthew", "dan": "daniel",
    "joe": "joseph", "jeff": "jeffrey", "greg": "gregory", "ken": "kenneth", "ron": "ronald",
    "don": "donald", "rick": "richard", "rich": "richard", "dick": "richard", "pat": "patrick",
    "tony": "anthony", "andy": "andrew", "nick": "nicholas", "sue": "susan", "kate": "katherine",
    "katie": "katherine", "kathy": "katherine", "liz": "elizabeth", "beth": "elizabeth",
    "jen": "jennifer", "jenny": "jennifer", "becky": "rebecca", "debbie": "deborah",
    "deb": "deborah", "barb": "barbara", "peggy": "margaret", "meg": "margaret",
    "cindy": "cynthia", "sandy": "sandra", "terry": "terrence", "ed": "edward", "ted": "edward",
}
STREET_SUFFIX = {
    "street": "St", "st": "St", "avenue": "Ave", "ave": "Ave", "road": "Rd", "rd": "Rd",
    "drive": "Dr", "dr": "Dr", "lane": "Ln", "ln": "Ln", "court": "Ct", "ct": "Ct",
    "boulevard": "Blvd", "blvd": "Blvd", "circle": "Cir", "cir": "Cir", "place": "Pl",
    "pl": "Pl", "highway": "Hwy", "hwy": "Hwy", "parkway": "Pkwy", "pkwy": "Pkwy",
    "terrace": "Ter", "ter": "Ter", "trail": "Trl", "trl": "Trl", "way": "Way",
}
DIRECTIONS = {"n", "s", "e", "w", "ne", "nw", "se", "sw"}
# Single-ZIP towns in the target area, used ONLY as a placeholder until USPS validation.
CITY_ZIP = {
    "faribault": "55021", "owatonna": "55060", "northfield": "55057", "kenyon": "55946",
    "waterville": "56096", "medford": "55049", "morristown": "55052", "cannon falls": "55009",
    "waseca": "56093",
}
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
STATE_ABBR = {"minnesota": "MN", "wisconsin": "WI", "iowa": "IA", "south dakota": "SD",
              "north dakota": "ND", "illinois": "IL"}
BROKERSUMO_KEEP = {"0", "1", "2"}  # 0 active, 1 pending, 2 closed; 3 and 8 are cancelled


# ── small helpers ────────────────────────────────────────────────────────────
def clean(s):
    return re.sub(r"\s+", " ", (s or "")).strip()


def title_name(s):
    s = clean(s)
    if s and (s.isupper() or s.islower()):
        s = s.title()
        s = re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), s)
        s = re.sub(r"\bO'([a-z])", lambda m: "O'" + m.group(1).upper(), s)
    return s


def canon_first(f):
    f = re.sub(r"[^a-z]", "", f.lower())
    return NICKNAMES.get(f, f)


def canon_last(l):
    return re.sub(r"[^a-z]", "", l.lower())


def norm_phone(p):
    d = re.sub(r"\D", "", str(p or ""))
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return d if len(d) == 10 else ""


def parse_date(text):
    m = re.search(r"([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})", text or "")
    if not m or m.group(1).lower() not in MONTHS:
        return None
    return datetime.date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2)))


def norm_street(s):
    s = clean(s).rstrip(".,")
    out = []
    for w in s.split(" "):
        lw = w.lower().rstrip(".,")
        if lw in DIRECTIONS:
            out.append(lw.upper())
        elif lw in STREET_SUFFIX:
            out.append(STREET_SUFFIX[lw])
        elif re.fullmatch(r"\d+(st|nd|rd|th)", lw):
            out.append(lw)
        elif re.fullmatch(r"\d+[a-z]?", lw):
            out.append(lw.upper())
        else:
            out.append(w.title() if (w.isupper() or w.islower()) else w)
    return " ".join(out)


def addr_key(street, city):
    return (re.sub(r"[^a-z0-9]", "", street.lower()), re.sub(r"[^a-z]", "", city.lower()))


def parse_address(display):
    """'123 maple st, Faribault, MN 55021' -> dict. Flags truncated ('…') strings."""
    raw = clean(display)
    truncated = "…" in raw or "..." in raw
    raw = raw.replace("…", "").replace("...", "")
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    street = city = state = zipc = ""
    if parts:
        street = parts[0]
    if len(parts) >= 2:
        city = parts[1]
    if len(parts) >= 3:
        m = re.match(r"([A-Za-z]{2})\b\s*(\d{5})?(?:-\d{4})?", parts[2])
        if m:
            state, zipc = m.group(1).upper(), m.group(2) or ""
        else:
            truncated = True
    zm = re.search(r"\b(\d{5})(?:-\d{4})?\b", raw)
    if zm and not zipc:
        zipc = zm.group(1)
    zip_source = "source" if zipc else ""
    if not zipc and city.lower() in CITY_ZIP:
        zipc, zip_source = CITY_ZIP[city.lower()], "city_default"
    problems = truncated or not (street and city and state)
    return {
        "street": norm_street(street), "city": title_name(city), "state": state or "",
        "zip": zipc, "zip_source": zip_source, "address_incomplete": bool(problems),
    }


def parse_people(raw):
    """'David & Jenny Campbell' -> [(David, Campbell), (Jenny, Campbell)]."""
    s = clean(re.sub(r"\([^)]*\)", "", raw or ""))
    parts = [p.split() for p in re.split(r"\s+(?:&|and)\s+", s, flags=re.I)]
    parsed = []
    for toks in parts:
        suffix = ""
        if len(toks) > 2 and toks[-1].rstrip(".").lower() in NAME_SUFFIXES:
            suffix = toks.pop()
        parsed.append((toks, suffix))
    shared_last = next((t[-1] for t, _ in reversed(parsed) if len(t) >= 2), "")
    people = []
    for toks, suffix in parsed:
        if not toks:
            continue
        if len(toks) == 1:
            first, last = toks[0], shared_last
        else:
            first, last = toks[0], toks[-1]
        people.append({"first": title_name(first), "last": title_name(last), "suffix": suffix})
    return people


# ── load ─────────────────────────────────────────────────────────────────────
def read_table(path):
    if path.lower().endswith((".xlsx", ".xlsm")):
        import openpyxl
        ws = openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets[0]
        it = ws.iter_rows(values_only=True)
        header = [clean(str(h)) if h is not None else "" for h in next(it)]
        return [dict(zip(header, ["" if v is None else str(v) for v in r]))
                for r in it if any(v not in (None, "") for v in r)]
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def iso_date(v):
    v = clean(v)[:10]
    try:
        return datetime.date.fromisoformat(v) if v else None
    except ValueError:
        return None


def read_brokersumo(rows, today):
    """One BrokerSumo deal can list several people per side; merge them into one party."""
    groups = defaultdict(list)
    for r in rows:
        role, name = clean(r.get("contact_role")), clean(r.get("contact_name"))
        if clean(r.get("status_code")) not in BROKERSUMO_KEEP or role not in ("Buyer", "Seller") or not name:
            continue
        groups[(clean(r.get("transaction_id")), role)].append(r)
    txs = []
    for (tid, role), rs in groups.items():
        r0 = rs[0]
        names = list(dict.fromkeys(clean(x["contact_name"]) for x in rs))
        people, seen = [], set()
        for nm in names:
            for p in parse_people(nm):
                k = (canon_first(p["first"]), canon_last(p["last"]))
                if k not in seen:
                    seen.add(k)
                    people.append(p)
        state = clean(r0.get("state"))
        state = STATE_ABBR.get(state.lower(), state.upper()[:2])
        addr = parse_address(f'{r0.get("street", "")}, {r0.get("city", "")}, {state} {clean(r0.get("zip"))}')
        closing = iso_date(r0.get("close_date"))
        closed = bool(closing and closing <= today) and clean(r0.get("status_code")) in ("0", "1", "2")
        side = role
        if "Lease" in clean(r0.get("side")):
            side = "Tenant" if role == "Buyer" else "Landlord"
        emails = [clean(x.get("contact_mailing_address")).lower() for x in rs
                  if "@" in clean(x.get("contact_mailing_address"))]
        phones = [norm_phone(x.get("contact_phone")) for x in rs if norm_phone(x.get("contact_phone"))]
        txs.append({
            "people": people, "client_raw": " & ".join(names), "side": side,
            "closing": closing, "started": iso_date(r0.get("contract_date")),
            "phase": "status_" + clean(r0.get("status_code")), "agent": clean(r0.get("agents")),
            "detail_url": f"brokersumo:{tid}:{side}", "source": "brokersumo",
            "stage": "past_client" if closed else "active_client",
            "email": emails[0] if emails else "", "phone": phones[0] if phones else "",
            **addr,
        })
    return txs


# ── union-find to merge the same household across deals ─────────────────────
class DSU:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        self.p[self.find(a)] = self.find(b)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--transactions", required=True)
    ap.add_argument("--contacts", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--office-street", action="append", default=[])
    ap.add_argument("--stale-years", type=int, default=5)
    ap.add_argument("--today", default=None, help="YYYY-MM-DD (testing)")
    ap.add_argument("--format", default="back_agent", choices=["back_agent", "brokersumo"])
    a = ap.parse_args()
    today = datetime.date.fromisoformat(a.today) if a.today else datetime.date.today()
    os.makedirs(a.out, exist_ok=True)
    office = [clean(s).lower() for s in a.office_street]

    # ---- transactions ------------------------------------------------------
    tx_rows = read_table(a.transactions)
    txs = read_brokersumo(tx_rows, today) if a.format == "brokersumo" else []
    for r in (tx_rows if a.format == "back_agent" else []):
        addr = parse_address(r.get("display_name", ""))
        txs.append({
            "people": parse_people(r.get("client", "")),
            "client_raw": clean(r.get("client", "")),
            "side": clean(r.get("side", "")),
            "closing": parse_date(r.get("closing", "")),
            "started": parse_date(r.get("started", "")),
            "phase": clean(r.get("phase", "")),
            "agent": clean(r.get("agent", "")),
            "detail_url": clean(r.get("detail_url", "")),
            "source": "back_agent", "stage": "past_client", "email": "", "phone": "",
            **addr,
        })

    dsu = DSU(len(txs))
    owner = {}
    for i, t in enumerate(txs):
        for p in t["people"]:
            k = (canon_first(p["first"]), canon_last(p["last"]))
            if not k[0] or not k[1]:
                continue
            if k in owner:
                dsu.union(i, owner[k])
            else:
                owner[k] = i
    groups = defaultdict(list)
    for i in range(len(txs)):
        groups[dsu.find(i)].append(i)

    # ---- contacts index ----------------------------------------------------
    contacts = read_table(a.contacts)
    by_exact, by_initial = defaultdict(list), defaultdict(list)
    for idx, c in enumerate(contacts):
        g, f = clean(c.get("GivenName")), clean(c.get("FamilyName"))
        if g and f:
            by_exact[(canon_first(g), canon_last(f))].append(idx)
            by_initial[(canon_first(g)[:1], canon_last(f))].append(idx)

    def is_office(street):
        s = clean(street).lower()
        return any(o in s for o in office)

    def contact_addr(c):
        street = clean(c.get("StreetAddress"))
        if not street or is_office(street):
            return None
        city = title_name(c.get("Locality"))
        zipc = re.sub(r"\D", "", c.get("PostalCode", ""))
        zipc = zipc if len(zipc) == 5 else (CITY_ZIP.get(city.lower(), "") if len(zipc) < 5 else zipc[:5])
        return {"street": norm_street(street), "city": city,
                "state": (clean(c.get("Region")) or "MN").upper()[:2], "zip": zipc}

    # ---- households --------------------------------------------------------
    households, matched_contacts = [], set()
    for n, (_, idxs) in enumerate(sorted(groups.items(), key=lambda kv: min(kv[1])), 1):
        hid = f"H{n:04d}"
        items = [txs[i] for i in idxs]
        # name: the variant that lists the most people
        best = max(items, key=lambda t: (len(t["people"]), len(t["client_raw"])))
        people = best["people"]
        last_names = sorted({p["last"] for p in people})
        display = " & ".join(
            f'{p["first"]}{(" " + p["last"]) if (p["last"] and (j == len(people) - 1 or p["last"] != people[j + 1]["last"])) else ""}'
            for j, p in enumerate(people)) or best["client_raw"]
        reasons = []

        # contact match
        exact_idx, prob_idx = [], []
        for p in people:
            k = (canon_first(p["first"]), canon_last(p["last"]))
            hits = by_exact.get(k, [])
            if hits:
                exact_idx += hits
            else:
                ph = by_initial.get((k[0][:1], k[1]), [])
                if len(ph) == 1:
                    prob_idx += ph
        match = "exact" if exact_idx else ("probable" if prob_idx else "none")
        use = list(dict.fromkeys(exact_idx or prob_idx))
        matched_contacts.update(use)
        phones, emails = [], []
        for ci in use:
            c = contacts[ci]
            ph = norm_phone(c.get("Phone"))
            em = clean(c.get("Email")).lower()
            if ph and ph not in phones:
                phones.append(ph)
            if em and em not in emails:
                emails.append(em)
        for t in items:  # deal-level phone/email (BrokerSumo) fill gaps
            if t.get("phone") and t["phone"] not in phones:
                phones.append(t["phone"])
            if t.get("email") and t["email"] not in emails:
                emails.append(t["email"])
        if match == "probable":
            reasons.append("contact_match_probable_check_name")

        # mailing address
        dated = sorted(items, key=lambda t: t["closing"] or datetime.date.min)
        sold = {addr_key(t["street"], t["city"]) for t in dated if t["side"] != "Buyer"}
        # only a CLOSED purchase is where they live now (an active buyer still lives elsewhere)
        buyer = [t for t in dated if t["side"] == "Buyer" and t["street"]
                 and t["closing"] and t["closing"] <= today]
        cand = None
        for t in reversed(buyer):
            if addr_key(t["street"], t["city"]) not in {
                    addr_key(s["street"], s["city"]) for s in dated
                    if s["side"] != "Buyer" and (s["closing"] or datetime.date.min) >= (t["closing"] or datetime.date.min)}:
                cand = t
                break
        c_addr = next((contact_addr(contacts[ci]) for ci in use if contact_addr(contacts[ci])), None)
        last_close = max((t["closing"] for t in items if t["closing"] and t["closing"] <= today), default=None)
        years = round((today - last_close).days / 365.25, 1) if last_close else ""

        if c_addr:
            m = c_addr
            status, zip_src = "contact_file", ("source" if m["zip"] else "")
            if cand and addr_key(cand["street"], cand["city"]) != addr_key(m["street"], m["city"]):
                reasons.append("address_differs_from_purchase")
        elif cand:
            m, status, zip_src = cand, "buyer_property", cand["zip_source"]
            if cand["address_incomplete"]:
                reasons.append("address_truncated_or_incomplete")
            if isinstance(years, float) and years >= a.stale_years:
                reasons.append(f"purchase_{a.stale_years}plus_years_ago_may_have_moved")
        else:
            m, status, zip_src = None, "needs_lookup", ""
            reasons.append("no_current_address_sold_or_seller_side")

        if m is not None and zip_src == "city_default":
            reasons.append("zip_is_city_default_validate_with_usps")
        if m is not None and not m.get("zip"):
            reasons.append("zip_missing")
        if len({t["agent"] for t in items} - {""}) > 1 or any(t["agent"] and t["agent"] != items[0]["agent"] for t in items):
            reasons.append("multiple_agents_on_deals")
        if not people or not all(p["first"] and p["last"] for p in people):
            reasons.append("name_incomplete")

        households.append({
            "household_id": hid,
            "display_name": display,
            "person_1_first": people[0]["first"] if people else "",
            "person_1_last": people[0]["last"] if people else "",
            "person_2_first": people[1]["first"] if len(people) > 1 else "",
            "person_2_last": people[1]["last"] if len(people) > 1 else "",
            "people_count": len(people),
            "deal_count": len(items),
            "buyer_deals": sum(t["side"] == "Buyer" for t in items),
            "seller_deals": sum(t["side"] == "Seller" for t in items),
            "first_closing": min((t["closing"] for t in items if t["closing"] and t["closing"] <= today), default="") or "",
            "last_closing": last_close or "",
            "years_since_last_close": years,
            "mail_street": m["street"] if m else "",
            "mail_city": m["city"] if m else "",
            "mail_state": (m["state"] or "MN") if m else "",
            "mail_zip": m.get("zip", "") if m else "",
            "address_status": status,
            "last_known_property": (f'{dated[-1]["street"]}, {dated[-1]["city"]}' if status == "needs_lookup" else ""),
            "phone": phones[0] if phones else "",
            "email": emails[0] if emails else "",
            "contact_match": match,
            "review_reasons": ";".join(dict.fromkeys(reasons)),
            "stage": "active_client" if any(t["stage"] == "active_client" for t in items) else "past_client",
            "source": items[0]["source"],
        })
        for t in items:
            t["household_id"] = hid

    # ---- unmatched contacts -----------------------------------------------
    unmatched, seen = [], set()
    for idx, c in enumerate(contacts):
        if idx in matched_contacts:
            continue
        ph, em = norm_phone(c.get("Phone")), clean(c.get("Email")).lower()
        key = em or ph or clean(c.get("FN")).lower()
        if key in seen:
            continue
        seen.add(key)
        street = clean(c.get("StreetAddress"))
        flags = []
        if clean(c.get("OrganizationName")):
            flags.append("has_organization")
        if street and is_office(street):
            flags.append("office_address_likely_colleague")
        if not ph and not em:
            flags.append("no_phone_or_email")
        unmatched.append({
            "name": clean(c.get("FN")), "given": clean(c.get("GivenName")),
            "family": clean(c.get("FamilyName")), "organization": clean(c.get("OrganizationName")),
            "phone": ph, "email": em, "street": street, "city": clean(c.get("Locality")),
            "state": clean(c.get("Region")), "zip": clean(c.get("PostalCode")),
            "flags": ";".join(flags),
        })

    # ---- write -------------------------------------------------------------
    def write(name, rows):
        if not rows:
            return
        with open(os.path.join(a.out, name), "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)

    write("households.csv", households)
    write("transactions_clean.csv", [{
        "household_id": t.get("household_id", ""), "client_raw": t["client_raw"], "side": t["side"],
        "closing_date": t["closing"] or "", "started_date": t["started"] or "", "phase": t["phase"],
        "agent": t["agent"], "street": t["street"], "city": t["city"], "state": t["state"],
        "zip": t["zip"], "zip_source": t["zip_source"], "address_incomplete": t["address_incomplete"],
        "detail_url": t["detail_url"], "source": t["source"]} for t in txs])
    write("contacts_unmatched.csv", unmatched)

    # ---- summary (counts only -- no personal data) -------------------------
    from collections import Counter
    st = Counter(h["address_status"] for h in households)
    rs = Counter(r for h in households for r in h["review_reasons"].split(";") if r)
    print(f"transactions: {len(txs)}  households: {len(households)}")
    print("address_status:", dict(st))
    print("stage:", dict(Counter(h["stage"] for h in households)))
    print("contact_match:", dict(Counter(h["contact_match"] for h in households)))
    print("with phone:", sum(bool(h["phone"]) for h in households),
          " with email:", sum(bool(h["email"]) for h in households))
    print("review_reasons:", dict(rs))
    print(f"unmatched contacts kept: {len(unmatched)}",
          dict(Counter(f for u in unmatched for f in u["flags"].split(";") if f)))
    print("wrote:", a.out)


if __name__ == "__main__":
    sys.exit(main())
