# FBM Sniper — User Guide

Welcome. This guide walks a brand-new user through getting the bot running, understanding what it does, and using the dashboard to actually flip cars (or whatever else you're hunting). If you get stuck anywhere in here, the Discord is the fastest way to unblock.

## 👉 First thing: Join the Discord

If you haven't already, join the community Discord:

**[discord.gg/BkpQSnth4C](https://discord.gg/BkpQSnth4C)**

That's where setup help, write-ups, and live Q&A happen. You'll want access before you start tinkering — it saves a ton of time.

---

## 1. What is FBM Sniper?

FBM Sniper is a desktop app that watches Facebook Marketplace for deals that match rules you set, scores each listing against those rules, and shows you the winners in a local dashboard. Think of it as a 24/7 buyer sitting on Marketplace refreshing search results for you — except it also runs the numbers on every listing before it bothers you about it.

Everything is local. There's no server you log into, no account, no data sent anywhere. The scanner talks to Facebook from your machine, stores the results in `data/`, and the dashboard reads from that folder.

**Core loop:**
1. You define **targets** — what you're hunting (e.g. "Honda Civic 2016-2021 under $18k within 120km").
2. The **scanner** queries Facebook Marketplace for each active target on a rolling interval.
3. Each listing is parsed, decoded (VIN lookup + recall check if a VIN is available), and scored against your target rules.
4. The **underwriter** assigns a verdict: `buy_now`, `maybe`, or `pass`.
5. Passing listings go to the Found tab. Failed listings go to Rejected with the reason.
6. You click through to the FB listing and close the deal.

---

## 2. Installing it

No Node.js or technical setup required. Go to the GitHub releases page and download the right file for your Mac:

**→ [github.com/ethanashi/fbm-sniper-community/releases](https://github.com/ethanashi/fbm-sniper-community/releases)**

| Your Mac | File to download |
| --- | --- |
| Apple Silicon (M1/M2/M3/M4) | `FBM.Sniper.Community-0.1.0-arm64.dmg` |
| Intel Mac | `FBM.Sniper.Community-0.1.0.dmg` |

Double-click the `.dmg`, drag the app to `/Applications`, and open it.

**"App is damaged" on first open?** The app isn't signed with an Apple Developer ID, so macOS Gatekeeper throws a scary-sounding warning. It's not actually damaged. Open Terminal and run this once:

```bash
xattr -cr "/Applications/FBM Sniper Community.app"
```

Then reopen the app. That's it — you won't need to do it again.

**First launch:** the app will download Chrome automatically (~150 MB). You'll see a "Downloading Chrome" screen — this only happens once. After that, the app opens instantly every time.

**After Chrome downloads:** a browser window will open and ask you to log into Facebook. Do that — the scanner needs an authenticated session to pull listings. Once you're logged in, close that window and you're ready to configure your targets and start scanning.

If you're not sure if your Mac is Apple Silicon or Intel: Apple menu → About This Mac. If it says "Apple M1" (or M2/M3/M4), grab the arm64 file. If it says "Intel Core", grab the regular one.

---

## 3. The dashboard tour

When the Electron app opens you get six tabs:

### Dashboard
Top-level stats: number of Buy Now finds, Maybes, average margin, and recall flags. Below that is the **Process** card — the green Start button spins up the scanner. The Targets summary shows how many targets are enabled and how they're grouped.

### Watchlist
All your targets as cards. You can toggle targets on/off with the switch, or click **+ Add Target** to paste in a new one. The pill at the top shows how many are active out of 10 (the hard cap).

### Found Listings
Every listing the bot decided was a Buy Now or Maybe. Filter by keyword, verdict, or group. Click a card to open the review modal with full numbers — estimated retail, max buy, margin, recon reserve, fees reserve, risk score. From there you can open the listing in your browser with one click.

### Rejected
Listings the bot threw out, with the exact reason (flagged keyword, mileage cap, title status, below margin floor, etc.). This is where you go when you're tuning a target — if it's rejecting things you'd actually want, loosen a rule.

### Settings
Three panels:
- **Quick Settings** — the stuff you change often: scan cooldown, search radius, shipping, location (label + lat/lng), search/detail worker counts, proxy URL, proxy pool.
- **App Config (JSON)** — raw config for power users.
- **Targets (JSON)** — the full watchlist as JSON. Edit and save.
- **Danger Zone** — Reset Memory wipes found/rejected/seen-IDs so the scanner re-processes everything it sees next loop.

### Logs
Live terminal output from the scanner. If something is failing, this is where the error shows up.

---

## 4. Setting up your first target

Open the **Watchlist** tab → **+ Add Target**. Paste a JSON object that looks like this:

```json
{
  "id": "honda-civic-2016-2021",
  "label": "Honda Civic 2016-2021",
  "group": "Reliable Sedans",
  "enabled": true,
  "make": "Honda",
  "model": "Civic",
  "query": "Honda Civic",
  "yearStart": 2016,
  "yearEnd": 2021,
  "minPrice": 5000,
  "maxPrice": 18000,
  "radiusKM": 120,
  "allowShipping": false,
  "retailBase": 14500,
  "baselineYear": 2019,
  "yearlyAdjustment": 900,
  "baselineMiles": 85000,
  "mileagePenaltyPer10k": 450,
  "maxMileage": 145000,
  "feesReserve": 650,
  "reconBase": 900,
  "marginFloor": 2200,
  "mustInclude": [],
  "mustAvoid": ["salvage", "flood", "frame damage", "parts only"],
  "trimBoostKeywords": ["touring", "si"]
}
```

The fields that actually matter for scoring:

| Field | What it does |
| --- | --- |
| `query` | The FB Marketplace search string |
| `yearStart` / `yearEnd` | Hard filter on model year |
| `minPrice` / `maxPrice` | Hard filter on list price |
| `radiusKM` | Search radius from your Settings location |
| `retailBase` | Your estimated retail for the baseline year/mileage |
| `baselineYear` / `yearlyAdjustment` | How much retail changes per year off baseline |
| `baselineMiles` / `mileagePenaltyPer10k` | How much retail drops per 10k miles over baseline |
| `maxMileage` | Hard reject above this |
| `feesReserve` + `reconBase` | Money you reserve for fees/recon before calculating margin |
| `marginFloor` | Minimum profit the bot needs to see before calling it Buy Now |
| `mustInclude` | Listing must contain at least one of these words |
| `mustAvoid` | Listing with any of these words is rejected |
| `trimBoostKeywords` | Retail bumped up if the listing mentions these trims |

You can have up to **10 enabled targets** at once.

---

## 5. How scoring actually works

For each listing the bot pulls, it runs this pipeline:

1. **Hard filters** — keyword avoid list, price band, year range, mileage cap, title status. Fail here → Rejected.
2. **Retail estimate** — starts from `retailBase`, adjusts up/down by year and mileage vs. baseline, applies trim boost if relevant keywords are present.
3. **VIN decode + recalls** — if a VIN is in the listing, the NHTSA free API fills in make/model/year/trim and flags open recalls.
4. **Reserves** — subtracts `feesReserve` + `reconBase` + any recon cost inferred from issue signals (e.g. "needs tires", "ac not working").
5. **Max buy** = `estRetail - reconReserve - feesReserve`.
6. **Margin** = `estRetail - listingPrice - reconReserve - feesReserve`.
7. **Verdict**:
   - `buy_now` — listing price is at or below max buy *and* risk score is low
   - `maybe` — within ~8% of max buy, medium risk (worth a lowball)
   - `pass` — everything else

Photo grading is rules-only in this edition — listings come back as `ungraded` with a "needs manual review" flag so you eyeball the photos yourself before pulling the trigger.

---

## 6. Proxies (read this if you plan to run more than a few scans)

Facebook rate-limits residential IPs aggressively. If you run the scanner without a proxy for more than a few loops, you'll start seeing error 1675004 in the logs — that's an IP block.

Fix it by adding a proxy in **Settings → Quick Settings → Proxy URL**. Any HTTP proxy in the form `http://user:pass@host:port` works. If you have multiple, drop them in the **Proxy Pool** field (one per line); the scanner cycles through them across your active targets.

Ask in the Discord `#questions` channel if you need recommendations for proxy providers.

---

## 7. Tuning and troubleshooting

- **Nothing is showing up in Found.** Check Rejected first. 9 times out of 10 a `mustAvoid` keyword or your `marginFloor` is too aggressive. Loosen one thing at a time.
- **Everything is rejected with "above mileage cap".** Bump `maxMileage` on the target.
- **Bot finds stuff but it's stale.** Lower the scan cooldown in Quick Settings (minimum 180 seconds — that's 3 minutes, the floor in this edition).
- **Getting rate-limited / IP blocked.** Configure a proxy. See section 6.
- **FB login prompt keeps popping up.** Your cached session expired. Log in again in the Puppeteer window.
- **Something weirder.** Check the **Logs** tab. If you're still stuck, drop it in `#questions` on Discord.

---

## 8. How the Discord works

**[discord.gg/BkpQSnth4C](https://discord.gg/BkpQSnth4C)**

🚨 **Bot Access Is Open** 🚨 — if you just got let in, welcome. Things move fast; here's the lay of the land.

### ❓ Questions
If you need help with anything bot-related, drop it in **#questions**. Someone is usually around, and write-ups for common issues get posted there too. Don't DM — asking publicly means the next person with the same problem finds the answer.

### 📘 How to Use It
**#how-to-use-bot** — full setup guide and write-up. If you're trying to get started and haven't read this yet, start here. The newest write-up is always pinned.

### 💰 Got a Flip?
If the bot helps you catch a good flip, post it in **#best-flips**. Screenshots, numbers, the before/after — let's see who's really cooking. This is also the easiest way to get a feel for what good targets look like before you build your own.

---

**Read the guide. Run the bot. Post your wins.**
