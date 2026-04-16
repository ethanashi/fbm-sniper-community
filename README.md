# FBM Sniper — Community Edition

An open-source desktop sniper for Facebook Marketplace. Scans in the background, scores listings against your rules, and surfaces the winners in a local dashboard.

Everything runs on your machine — no cloud, no account, no data leaves your laptop.

## Join the Discord

If you're new to the bot, hop into the community Discord. That's where setup help, the full how-to guide, and the flip-sharing channel live.

**→ [discord.gg/BkpQSnth4C](https://discord.gg/BkpQSnth4C)**

## What it does

- Headless Puppeteer scanner that pulls listings directly from Facebook Marketplace
- Local Electron dashboard for reviewing finds (no cloud, no account)
- Rules-based scoring: price band, keyword allow/deny lists, mileage, title status
- NHTSA VIN decoder + open recall check (free public API)
- Per-target groups, filters, and found/rejected history
- Click any listing to jump straight to the FB Marketplace page

## Features

| Feature | Included |
| --- | :---: |
| Facebook Marketplace scanner | ✅ |
| Local Electron dashboard | ✅ |
| Rules-based scoring engine | ✅ |
| NHTSA VIN decode + recall lookup | ✅ |
| Up to 10 active targets at once | ✅ |
| 3-minute minimum scan interval | ✅ |
| Proxy + proxy pool support | ✅ |
| Per-target pricing and underwriting rules | ✅ |
| Found / Rejected history with filters | ✅ |

## Download & install

Head to the [Releases page](https://github.com/ethanashi/fbm-sniper-community/releases) and grab the latest version for your platform:

| Platform | File |
| --- | --- |
| Mac (Apple Silicon — M1/M2/M3/M4) | `FBM Sniper Community-0.1.0-arm64.dmg` |
| Mac (Intel) | `FBM Sniper Community-0.1.0.dmg` |
| Windows (x64) | `FBM Sniper Community Setup 0.1.0.exe` |

Double-click the `.dmg`, drag the app to `/Applications`, and open it. On first launch it will download Chrome automatically (~150 MB, one-time). After that it starts instantly.

### macOS "app is damaged" warning

The app isn't signed with an Apple Developer ID, so macOS Gatekeeper flags it on first launch. **The app is not actually damaged** — this is just the standard unsigned-app warning. To get past it, open Terminal and run:

```bash
xattr -cr "/Applications/FBM Sniper Community.app"
```

Then open the app normally. You only need to do this once.

### Windows SmartScreen warning

The Windows build is unsigned, so SmartScreen may show a "Windows protected your PC" prompt on first launch. Click **More info** and then **Run anyway** to open the app.

**Want to build from source instead?** See the [developer setup](#developer-setup) section below.

## First launch

1. Open the app. If Chrome isn't downloaded yet, you'll see a brief "Downloading Chrome" screen — this happens once.
2. Log into Facebook in the browser window that opens. The scanner needs an authenticated session to pull listings.
3. Add your first target via **Watchlist → + Add Target**, configure your location in **Settings → Quick Settings**, then hit **Start** on the Dashboard.

## Developer setup

Requires Node.js 18+ and git.

```bash
git clone https://github.com/ethanashi/fbm-sniper-community fbm-sniper
cd fbm-sniper
npm install
npm run seed        # writes starter watchlist + sample data to data/
npm run desktop     # launches the Electron dashboard
```

If you prefer the CLI:
```bash
npm run scan        # continuous scan loop
npm run scan:test   # one-shot test scan, then exit
```

For packaged desktop release builds:

```bash
npm run build:all
```

On Apple Silicon Macs, install `makensis` once first:

```bash
brew install makensis
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

You can have up to **10 enabled targets** running at a time. Disable one to enable another.

## Proxies

Facebook will rate-limit a raw residential IP fast. Add a proxy URL (or a pool) in Settings → Quick Settings. Any proxy that accepts `http://user:pass@host:port` works.

## How scoring works

1. Target rules filter by keyword, price, title, mileage.
2. Rules engine estimates retail from `retailBase` + year/mileage adjustments.
3. NHTSA VIN decode + open recall check (if a VIN is in the listing).
4. Verdict: `buy_now`, `maybe`, or `pass` based on the margin floor.

Listings without enough signal come back as `ungraded` with a "needs manual review" flag so you can eyeball them in the dashboard.

## Project layout

```
lib/          # scanner + core logic (ESM)
server.cjs    # Express + WebSocket backend for the UI
electron.cjs  # Electron shell
ui/           # Static dashboard (HTML/CSS/JS)
data/         # Runtime data: watchlist.json, config.json, found/rejected logs
config/       # (reserved for future config presets)
docs/         # User guide and walkthroughs
```

See [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md) for the full walkthrough.

## License

MIT — see [LICENSE](LICENSE). Fork it, extend it, ship it.
