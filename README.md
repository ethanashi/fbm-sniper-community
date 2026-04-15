# FBM Sniper — Community Edition

An open-source desktop sniper for Facebook Marketplace. Scans in the background, scores listings against your rules, and shows the winners in a local dashboard.

**This is the free edition.** It's fully functional for the core use case — scan, score, surface deals — and shares its data format with FBM Sniper Pro so you can upgrade later without losing anything.

## What you get

- Headless Puppeteer scanner that pulls listings from Facebook Marketplace
- Local Electron dashboard (no cloud, no account — everything stays on your machine)
- Rules-based scoring: price band, keyword allow/deny lists, mileage, title status
- NHTSA VIN decoder + recall check (free public API)
- Per-target groups, filters, found/rejected history
- Click any listing to jump straight to the FB Marketplace page

## What's different from Pro

| Feature                        | Community | Pro |
| ------------------------------ | :-------: | :-: |
| FB Marketplace scanner         | ✅ | ✅ |
| Local dashboard                | ✅ | ✅ |
| Rules-based scoring            | ✅ | ✅ |
| NHTSA VIN + recall check       | ✅ | ✅ |
| Max active targets             | 3 | ∞ |
| Minimum scan interval          | 3 min | 30 sec |
| AI photo grading (Gemini)      | — | ✅ |
| AI target generator (describe → schema) | — | ✅ |
| Telegram / Discord alerts      | — | ✅ |
| Preset target library          | — | ✅ |

The community edition has the limits hardcoded. When you're ready for more, [upgrade to Pro](https://gumroad.com/).

## Quick start

```bash
git clone <this-repo> fbm-sniper
cd fbm-sniper
npm install
npm run seed        # writes starter watchlist + sample data to data/
npm run desktop     # launches the Electron dashboard
```

First time running, log into Facebook in the Puppeteer window it opens so the scanner can pull listings.

If you prefer the CLI:
```bash
npm run scan        # continuous scan loop
npm run scan:test   # one-shot test scan, then exit
```

## Configuring targets

Targets live in [`data/watchlist.json`](data/watchlist.json). You can edit the JSON directly or use the **Add Target** drawer in the dashboard. Each target looks like:

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

Community edition enforces **max 3 enabled targets** at a time. Disable one to enable another.

## Proxies

FB will rate-limit a raw residential IP fast. Add a proxy URL (or a pool) in Settings → Quick Settings. Any proxy that accepts `http://user:pass@host:port` works.

## How scoring works

1. Target rules filter by keyword, price, title, mileage.
2. Rules engine estimates retail from `retailBase` + year/mileage adjustments.
3. NHTSA VIN decode + recall check (if VIN is in the listing).
4. Verdict: `buy_now`, `maybe`, or `pass` based on the margin floor.

The photo-grading hook is stubbed in this edition — listings come back as `ungraded` with a "needs manual review" flag. Pro ships a Gemini-vision grader that scores exterior/interior condition from the listing photos.

## Project layout

```
lib/          # scanner + core logic (ESM)
server.cjs    # Express + WebSocket backend for the UI
electron.cjs  # Electron shell
ui/           # Static dashboard (HTML/CSS/JS)
data/         # Runtime data: watchlist.json, config.json, found/rejected logs
config/       # (reserved for future config presets)
```

## License

MIT — see [LICENSE](LICENSE). Fork it, extend it, ship it.

## Upgrading to Pro

[Get FBM Sniper Pro on Gumroad](https://gumroad.com/) — one-time purchase, ships as a signed .exe/.dmg. Your community-edition `data/` folder drops straight in.
