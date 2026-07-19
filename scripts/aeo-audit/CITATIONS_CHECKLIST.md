# AEO Audit — Citations Pillar Checklist

AI engines (Google's AI Overviews, ChatGPT, Perplexity) rank answers by cross-checking business identity consistency. A plumber listed as "Smith Plumbing" on Yelp, "Smith's Plumbing" on BBB, and "Smith Plumbing LLC" on Google confuses the ranking signal. This checklist captures Name, Address/service-area, and Phone (NAP) consistency across 8 directories — the operator fills it by hand in ~30 minutes per audit. Results populate the audit report's citations pillar (15 points).

---

## The 8 Directories to Check

For each directory below: search for the business, record whether it exists and whether NAP matches the Google Business Profile values exactly.

| Directory | Look-up URL | How to check |
|-----------|-----------|---|
| **Google Business Profile** | https://business.google.com | Sign in, find the business. Verify it exists, primary category is set, and description mentions key services |
| **Bing Places** | https://www.bing.com/places/search | Search "[business name] [city]" — click the business card if it appears |
| **Apple Maps** | https://business.apple.com (or search Apple Maps app) | Search the business name; if listed, check the Apple Business Connect dashboard |
| **Yelp** | https://www.yelp.com/search | Search "[business name] [city]" — click the business profile |
| **Facebook** | https://www.facebook.com/search/pages | Search the business name; if a page exists, verify it's the official one (check follow count, post history) |
| **BBB (Better Business Bureau)** | https://www.bbb.org/search | Search "[business name] [city]" — verify listing (if BBB is relevant for that industry) |
| **Angi** (formerly Angie's List) | https://www.angi.com/companylist/search | Search "[business name] [city]" — appears as contractor profile |
| **Nextdoor** | https://www.nextdoor.com (as user; or check public listing) | Search the business in the Nextdoor app or visit the public profile URL if available |

---

## What "NAP Match" Means

**NAP = Name + Address/Service-area + Phone.** For each directory, check if these three data points match the Google Business Profile values **exactly**:

- **Name:** Business name must match word-for-word. "507 Air Heating & Cooling" ≠ "507 Air" ≠ "507 Air Heating and Cooling LLC" (use "&" vs "and", match punctuation, match capitalization)
- **Address/Service-area:** For service-area businesses (like HVAC, plumbing, construction), the street address may be intentionally hidden. Match on:
  - **If GBP shows a street address:** the directory must also show that exact address
  - **If GBP hides the address (service-area business):** the directory should show the service-area cities or "serves [area]". Exact match is harder here — if the directory shows multiple cities overlapping GBP's service area, mark it as matching
- **Phone:** Must match exactly, including formatting. (507) 491-3063 = 507-491-3063 = 5074913063? For the purposes of this checklist, consistent 10-digit US formatting is close enough (area code + 7 digits). International formats vary; use common sense.

**nap_match = true only if all three (name + address/area + phone) align closely.** If any one is off, mark `nap_match = false`.

---

## How to Record Results

For each directory you check, add an entry to the `citations` array in the client config file. Each entry is a JSON object with four fields:

```json
{
  "directory": "Yelp",
  "listed": true,
  "nap_match": false,
  "url": "https://www.yelp.com/biz/507-air-heating-cooling-faribault"
}
```

| Field | Value |
|-------|-------|
| `directory` | Exact name from the table above (e.g., "Yelp", "BBB") |
| `listed` | `true` if the business has a profile/listing; `false` if not found |
| `nap_match` | `true` if Name, Address/service-area, and Phone all match the GBP values; `false` otherwise |
| `url` | The full URL of the listing (copy from your browser). Empty string `""` if not listed |

---

## Example: Filled Citations Array

Here's what a completed `citations` array looks like in the client config:

```json
"citations": [
  { "directory": "Google Business Profile", "listed": true, "nap_match": true, "url": "https://www.google.com/maps/place/507+Air+Heating+Cooling+Faribault" },
  { "directory": "Bing Places", "listed": true, "nap_match": true, "url": "https://www.bing.com/local/details.aspx?..." },
  { "directory": "Apple Maps", "listed": false, "nap_match": false, "url": "" },
  { "directory": "Yelp", "listed": true, "nap_match": false, "url": "https://www.yelp.com/biz/507-air-heating-cooling-faribault" },
  { "directory": "Facebook", "listed": true, "nap_match": true, "url": "https://www.facebook.com/507airheatingcooling" },
  { "directory": "BBB", "listed": true, "nap_match": false, "url": "https://www.bbb.org/us/mn/faribault/profile/..." },
  { "directory": "Angi", "listed": false, "nap_match": false, "url": "" },
  { "directory": "Nextdoor", "listed": true, "nap_match": true, "url": "https://www.nextdoor.com/local/..." }
]
```

**Score:** 4 of 8 directories list the business; 3 of 8 have NAP match. Citations pillar gets partial credit.

---

## Common Fixes (If Time Allows)

If you spot issues while checking, note them for the client or Norr AI to fix:

| Issue | How to fix |
|-------|---|
| **Unclaimed listing** (business shows up, but no owner control) | Claim it in that directory's manager dashboard (Yelp Claim, Bing My Business, etc.) |
| **Phone format mismatch** (e.g., "507-491-3063" vs "(507) 491-3063") | Update the listing in that directory's manager console to match GBP |
| **Old business name** (e.g., "Smith Heating" listed, but rebranded to "Smith Air") | Update the business name in the directory's manager tool |
| **Dead website link** | Update website URL in the directory's manager console |
| **Missing from a major directory** | Add the business (some directories allow self-service signup; others require claiming) |

**Ownership note:** GBP is the source of truth. All other directories should match it, not the reverse. If there's a conflict between GBP and another directory, GBP wins — correct the other listing.

---

## Next Steps

Once the citations array is complete (even if some entries show `listed: false` or `nap_match: false`), the audit engine scores the pillar and includes findings in the report. The report will flag which directories are missing or mismatched, and the client gets a prioritized list of "fix these first."

For retainer clients, the citations checklist is re-run quarterly to catch new directories or stale data.
