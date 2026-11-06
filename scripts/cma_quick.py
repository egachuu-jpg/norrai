#!/usr/bin/env python3
"""Quick-and-dirty CMA: Gemini (Google Search grounded) finds sold comps; we score,
adjust, and print a low/mid/high range. Not an appraisal. See PRD/cma-tool.md.

Usage:  GEMINI_API_KEY=... python3 scripts/cma_quick.py [--comps-file comps.json]
"""
import json, os, re, sys, statistics, urllib.request
from datetime import date, datetime

SUBJECT = dict(address="1106 Cuylle Ct", city="Faribault", state="MN", beds=3, baths=2,
               sqft=2000, year_built=2021, lot_sqft=int(0.3 * 43560), garage_stalls=3)
MODEL = "gemini-2.5-flash"

PROMPT = """Find recently SOLD single-family homes (closed in the last 12 months, newest first) near {address}, {city}, {state}.
Prefer Faribault, MN homes built 2005 or later, 1,500-2,600 sqft, 2-4 beds. Search Zillow, Redfin, Realtor.com.
Return ONLY a JSON array (no prose, no markdown fence) of up to 12 objects:
{{"address":str,"sold_price":int,"sold_date":"YYYY-MM-DD","beds":int|null,"baths":number|null,"sqft":int|null,
"year_built":int|null,"lot_sqft":int|null,"garage_stalls":int|null,"distance_miles":number|null}}
Do not invent or estimate anything. Omit a home rather than guess its price/date; use null for unknown fields.
No demographic or crime data."""

def fetch_comps():
    key = os.environ["GEMINI_API_KEY"]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={key}"
    body = {"contents": [{"parts": [{"text": PROMPT.format(**SUBJECT)}]}], "tools": [{"google_search": {}}]}
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
    resp = json.load(urllib.request.urlopen(req, timeout=120))
    text = "".join(p.get("text", "") for p in resp["candidates"][0]["content"]["parts"])
    m = re.search(r"\[.*\]", text, re.S)
    return json.loads(m.group(0))

def score_and_adjust(c, s, today):
    days = (today - datetime.strptime(c["sold_date"], "%Y-%m-%d").date()).days
    sqft = c.get("sqft") or s["sqft"]
    score = 100 - abs(sqft - s["sqft"]) / s["sqft"] * 30
    score -= abs((c.get("beds") or s["beds"]) - s["beds"]) * 10
    score -= abs((c.get("baths") or s["baths"]) - s["baths"]) * 7
    score -= abs((c.get("year_built") or s["year_built"]) - s["year_built"]) / 10
    score -= (c.get("distance_miles") or 2) * 5
    score -= days / 30 * 2
    ppsf = c["sold_price"] / sqft
    adj = {"sqft": round(ppsf * 0.5 * (s["sqft"] - sqft))}  # 50% of avg $/sqft: marginal sqft is worth less
    adj["beds"] = ((s["beds"] - (c.get("beds") or s["beds"])) * 7500)
    adj["baths"] = round((s["baths"] - (c.get("baths") or s["baths"])) * 5000)
    adj["age"] = round((c.get("year_built") or s["year_built"]) and (s["year_built"] - c.get("year_built", s["year_built"])) / 10 * 5000)
    if c.get("garage_stalls") is not None:
        adj["garage"] = (s["garage_stalls"] - c["garage_stalls"]) * 8000
    if c.get("lot_sqft"):
        adj["lot"] = round((s["lot_sqft"] - c["lot_sqft"]) * 1.5)
    total = sum(adj.values())
    return dict(c, score=round(score, 1), days=days, adj=adj, adj_total=total, adjusted=c["sold_price"] + total)

def main():
    if "--comps-file" in sys.argv:
        comps = json.load(open(sys.argv[sys.argv.index("--comps-file") + 1]))
    else:
        comps = fetch_comps()
    today = date.today()
    ranked = sorted((score_and_adjust(c, SUBJECT, today) for c in comps if c.get("sold_price") and c.get("sold_date")),
                    key=lambda x: -x["score"])
    good = [c for c in ranked if c["score"] >= 60][:6]
    print(f"\nSubject: {SUBJECT['address']}, {SUBJECT['city']} {SUBJECT['state']} - "
          f"{SUBJECT['beds']}bd/{SUBJECT['baths']}ba, {SUBJECT['sqft']} sqft, built {SUBJECT['year_built']}\n")
    print(f"{'Address':32}{'Sold':>10}{'Date':>12}{'Sqft':>6}{'Score':>7}{'Adj':>9}{'Adjusted':>10}")
    for c in ranked:
        mark = "*" if c in good else " "
        print(f"{mark}{c['address'][:31]:31}{c['sold_price']:>10,}{c['sold_date']:>12}{c.get('sqft') or 0:>6}"
              f"{c['score']:>7}{c['adj_total']:>+9,}{c['adjusted']:>10,}")
    print("(* = used in estimate; score >= 60, top 6)")
    if len(good) < 3:
        print("\nToo few good comps for an estimate - treat the table above as raw data only.")
        return
    adj = sorted(c["adjusted"] for c in good)
    w = [c["score"] for c in sorted(good, key=lambda x: x["adjusted"])]
    # weighted median
    half, acc, mid = sum(w) / 2, 0, adj[-1]
    for p, wt in zip(adj, w):
        acc += wt
        if acc >= half: mid = p; break
    low, high = statistics.mean(adj[:2]), statistics.mean(adj[-2:])
    print(f"\nEstimate  low ${low:,.0f}   mid ${mid:,.0f}   high ${high:,.0f}")
    print(f"List range (mid +/-2.5%): ${mid*0.975:,.0f} - ${mid*1.025:,.0f}   [{len(good)} comps]")
    print("Draft from public web data, not an appraisal. Verify comps and condition before relying on it.")

if __name__ == "__main__":
    main()
