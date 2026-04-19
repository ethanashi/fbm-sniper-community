# FBM Sniper Community v2 User Guide

FBM Sniper Community is a local desktop app for watching marketplace deals across:

- Cars on Facebook Marketplace
- Facebook Marketplace electronics
- Wallapop electronics
- Vinted electronics

The app runs on your computer, stores data locally, and gives you a live dashboard for starting bots, tuning targets, reviewing found listings, and sending optional Discord alerts.

## Join The Discord

If you need help, examples, or target JSON templates, join the community Discord:

**[discord.gg/BkpQSnth4C](https://discord.gg/BkpQSnth4C)**

Use `#how-to-use-bot` for walkthroughs, `#questions` for setup help, and `#best-flips` to share wins.

## Install The App

Download the latest release from GitHub:

**[github.com/ethanashi/fbm-sniper-community/releases](https://github.com/ethanashi/fbm-sniper-community/releases)**

| Platform | File |
| --- | --- |
| Apple Silicon Mac | `FBM.Sniper.Community-2.0.0-arm64.dmg` |
| Intel Mac | `FBM.Sniper.Community-2.0.0.dmg` |
| Windows x64 | `FBM.Sniper.Community.Setup.2.0.0.exe` |

On macOS, open the `.dmg`, drag the app into Applications, then open it.

If macOS says the app is damaged, the app is being blocked because it is unsigned. Run this once:

```bash
xattr -cr "/Applications/FBM Sniper Community.app"
```

On Windows, SmartScreen may warn because the app is unsigned. Click **More info** and then **Run anyway**.

On first launch, the app downloads Puppeteer Chrome into app data. This is a one-time setup of about 150 MB. After that, the app opens normally.

## What Runs Locally

Everything important is local:

- Your watchlists and settings live in app data.
- Found listings and seen IDs live in app data.
- Discord webhooks are optional.
- The app does not require a hosted account or cloud login.

When packaged as Electron, app data is stored in the operating system user-data folder. When running from source, data lives under the repo `data/` folder.

## Dashboard Tour

The top navigation has eight main areas.

### Cars

The Cars tab keeps the original Facebook Marketplace car workflow in one place.

Use the Cars sub-tabs:

- **Overview** shows scanner stats and the car scanner process card.
- **Watchlist** manages car targets with the 10-active-target limit.
- **Found** shows car listings marked `Buy Now` or `Maybe`.
- **Rejected** shows listings the car scanner skipped and why.
- **Config** contains quick settings, raw car config JSON, raw car target JSON, and Reset Memory.

Cars use dollar-based underwriting fields such as estimated retail, max buy, margin, fees reserve, recon reserve, title status, mileage, and risk score.

### Facebook

The Facebook tab controls the shared Facebook electronics sniper.

You can:

- Start or stop the Facebook bot.
- Set the Facebook poll interval.
- Refresh recent Facebook deals.
- Filter deal cards by grade.
- Watch the Facebook bot log beside the deal feed.

Facebook uses the shared Watchlist and shared Settings.

### Wallapop

The Wallapop tab controls the shared Wallapop electronics sniper.

You can:

- Start or stop the Wallapop bot.
- Set the Wallapop poll interval.
- Review live Wallapop hits with photos.
- Filter by grade.
- Watch Wallapop logs in the same tab.

Wallapop uses the shared Watchlist and shared Settings. Targets can override Wallapop min and max price separately from Facebook or Vinted.

### Vinted

The Vinted tab controls the shared Vinted electronics sniper.

You can:

- Start or stop the Vinted bot.
- Set the Vinted poll interval.
- Paste an optional Vinted cookie.
- Paste the matching User-Agent for that cookie.
- Review Vinted hits with fee-aware pricing.
- Watch Vinted logs in the same tab.

The cookie should include `access_token_web=...`. If you leave it blank, the bot still tries its automatic cookie flow.

### Found Listings

Found Listings is the combined live feed. It merges:

- Cars
- Facebook
- Wallapop
- Vinted

Use it when you want one real-time deal board instead of switching tabs.

You can:

- Search by title.
- Filter by platform.
- Filter to good deals or okay-or-better deals.
- Toggle entire platforms on or off with the platform chips.
- Open listings directly from the cards.

Each card shows the source platform badge, listing photo when available, price, target, group, grade, and deal notes.

### Watchlist

The top-level Watchlist tab is for the shared Facebook, Wallapop, and Vinted targets.

Each shared target can run on one or more platforms. A target card includes:

- Target label
- Search query
- Group
- Enabled or disabled state
- Platform checkboxes for Facebook, Wallapop, and Vinted
- Optional per-platform min and max prices
- Aliases
- Must-include keywords
- Must-avoid keywords

Use **+ Add Target** to paste a new target JSON object.

### Settings

The top-level Settings tab controls the shared marketplace workspace for Facebook, Wallapop, and Vinted.

It includes:

- Proxy URL
- Proxy Pool
- Location label
- Latitude and longitude
- Include photos in Discord alerts
- Max photos per alert
- Browser opening behavior
- Auto-open Buy Now toggle
- Discord webhook for all deals
- Discord webhook for Buy Now deals
- Discord webhook for Maybe deals
- Per-bot poll intervals
- Vinted cookie and User-Agent
- Raw shared watchlist JSON

Click **Save Shared Settings** after editing. The app shows a green side notification when the save completes.

### Logs

The Logs tab shows terminal output for:

- Cars
- Facebook
- Wallapop
- Vinted

Use it when a bot is not starting, gets blocked, or returns bad responses.

## Starting A Bot

1. Open the tab for the bot you want to run.
2. Check the poll interval.
3. Click **Start**.
4. Watch the Live Deals panel and the log panel.
5. Click **Stop** when you want the current bot to stop after the current step finishes.

Each bot runs separately. You can run only the platforms you care about.

## Shared Target JSON

Shared targets power Facebook, Wallapop, and Vinted. This is the simplest useful shape:

```json
{
  "id": "iphone-15-pro",
  "label": "iPhone 15 Pro",
  "group": "Phones",
  "enabled": true,
  "product": "iphone",
  "targetType": "electronics",
  "platforms": ["facebook", "wallapop", "vinted"],
  "query": "iPhone 15 Pro",
  "aliases": ["iPhone 15 Pro", "15 Pro"],
  "mustInclude": [],
  "mustAvoid": ["icloud", "bloqueado", "parts", "repuestos"],
  "radiusKM": null,
  "minPrice": 150,
  "maxPrice": 900,
  "allowShipping": true,
  "platformOverrides": {
    "wallapop": {
      "minPrice": 150,
      "maxPrice": 850
    },
    "vinted": {
      "minPrice": 120,
      "maxPrice": 750
    }
  }
}
```

Important fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable unique ID. If omitted, the app creates one from the label/query. |
| `label` | Human-readable target name. |
| `group` | UI bucket for filtering. |
| `enabled` | `false` hides the target from bot runs. |
| `product` | Supported values include `iphone`, `mac`, `ipad`, `airpods`, `playstation`, and `console`. |
| `targetType` | Usually `electronics` for shared marketplace bots. |
| `platforms` | Any mix of `facebook`, `wallapop`, and `vinted`. |
| `query` | Search text sent to the platform. |
| `aliases` | Extra words that help match listings back to the target. |
| `mustInclude` | If set, listing text must include at least one of these terms. |
| `mustAvoid` | Listings containing these terms are skipped. |
| `radiusKM` | Optional target-specific search radius. `null` uses shared location defaults. |
| `minPrice` / `maxPrice` | Shared price band. |
| `allowShipping` | Whether shippable listings are allowed when the platform supports it. |
| `platformOverrides` | Per-site price overrides, useful because prices differ by marketplace. |

## Car Target JSON

Car targets are separate from shared electronics targets and live under Cars -> Config or Cars -> Watchlist.

Example:

```json
{
  "id": "toyota-camry-2018-2022",
  "label": "Toyota Camry 2018-2022",
  "group": "Reliable Sedans",
  "enabled": true,
  "targetType": "vehicle",
  "make": "Toyota",
  "model": "Camry",
  "query": "Toyota Camry",
  "yearStart": 2018,
  "yearEnd": 2022,
  "minPrice": 5000,
  "maxPrice": 18000,
  "radiusKM": 120,
  "allowShipping": false,
  "retailBase": 16000,
  "baselineYear": 2020,
  "yearlyAdjustment": 900,
  "baselineMiles": 85000,
  "mileagePenaltyPer10k": 450,
  "maxMileage": 145000,
  "feesReserve": 650,
  "reconBase": 900,
  "marginFloor": 2200,
  "mustInclude": [],
  "mustAvoid": ["salvage", "flood", "frame damage", "parts only"],
  "trimBoostKeywords": ["xse", "xle", "hybrid"]
}
```

Cars are capped at 10 active targets. If you add an 11th enabled target, disable another target first.

## How Deal Grades Work

The community edition uses programmatic scoring, not AI.

For shared marketplace electronics:

| Grade | Meaning |
| --- | --- |
| `A` | Strong deal, usually far below max-buy. |
| `B` | Good deal. |
| `C` | Fair deal, worth checking. |
| `D` | Lowball target, likely only worth messaging with a lower offer. |
| `F` | Skip or junk. |
| `?` | No reference price was available, so review manually. |

Deal borders in the UI are based on real price-vs-ceiling or price-vs-max-buy data when available. A good grade alone does not always mean a green border if the app does not have enough pricing context.

For cars:

| Verdict | Meaning |
| --- | --- |
| `Buy Now` | Listing appears under max buy with enough spread and acceptable risk. |
| `Maybe` | Worth reviewing or sending a low offer. |
| `Pass` | Rejected or not enough edge. |

## Discord Alerts

Discord is optional. If all webhook fields are blank, the app still runs normally.

In Settings, you can set:

- **All Deals Webhook** for every graded deal.
- **Buy Now Webhook** for grades `A` and `B`.
- **Maybe Webhook** for grades `C` and `D`.

You can also choose whether alerts include photos and how many photos to attach.

## Vinted Cookie Setup

If Vinted starts returning auth errors, paste a fresh cookie:

1. Log into `vinted.es` in your browser.
2. Open DevTools.
3. Go to Application or Storage cookies.
4. Find the cookie string that includes `access_token_web=...`.
5. Copy the cookie value.
6. Paste it into the Vinted cookie field.
7. Copy the same browser User-Agent from DevTools Network headers.
8. Paste it into the Vinted User-Agent field.
9. Click **Apply** or **Save Shared Settings**.

The cookie and User-Agent should come from the same browser session.

## Proxies

Marketplace sites rate-limit aggressively. If you see repeated `429`, `403`, Facebook `1675004`, or straight request failures, add proxies.

Use either:

- **Proxy URL** for one proxy.
- **Proxy Pool** for multiple proxies, one per line.

Format:

```text
http://user:pass@host:port
```

Proxy wiring is currently different by bot:

- Cars use the proxy fields under Cars -> Config -> Quick Settings.
- Facebook uses the same desktop proxy environment that is created from the car config proxy field.
- Vinted uses the top-level Settings proxy and proxy pool fields.
- Wallapop mainly relies on polling/backoff right now; if it starts rate-limiting, raise the poll interval first.

## Reset Memory

Reset Memory only affects the car scanner. It wipes:

- Car found listings
- Car rejected log
- Car seen-ID cache

Use it when you want the car scanner to re-process listings it has already seen. It does not wipe shared Facebook, Wallapop, or Vinted found files.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| No shared deals appear | Open the platform tab, confirm the bot is running, confirm the target has that platform checked, and check logs. |
| Found Listings is empty | Make sure at least one platform chip is enabled and filters are not hiding everything. |
| Facebook fails or rate-limits | Log into Facebook again if prompted, then add a proxy if errors continue. |
| Wallapop returns repeated errors | Check target price/radius settings, then add a proxy or increase the poll interval. |
| Vinted returns 403/429 | Refresh the Vinted cookie and User-Agent, then slow the poll interval. |
| Discord does not post | Verify webhook URLs, make sure the grade matches the route, and confirm Discord alerts are not blocked by network settings. |
| Save does nothing | Watch for the green side notification. If it does not appear, check Logs or reload Settings. |
| App will not open on macOS | Run the `xattr -cr` command from the install section. |

## Developer Commands

Most users do not need these. If running from source:

```bash
npm install
npm run seed
npm run desktop
```

Useful commands:

```bash
npm run ui
npm run scan
npm run scan:test
npm run check
npm run build:all
```

On Apple Silicon, local Windows packaging needs `makensis`:

```bash
brew install makensis
```

## Data Files

When running from source, data is under `data/`:

```text
data/config.json
data/watchlist.json
data/found_listings.ndjson
data/rejected_listings.csv
data/seen_ids.json
data/shared-marketplace/config.json
data/shared-marketplace/watchlist.json
data/facebook/found.ndjson
data/wallapop/found.ndjson
data/vinted/found.ndjson
```

In the packaged app, the same files are stored in your operating system app-data folder.

## Best Workflow

1. Open Settings and set location, proxies, Discord, and poll intervals.
2. Open Watchlist and confirm each shared target is enabled on the right platforms.
3. Start one bot first, not all four.
4. Watch logs for a full cycle.
5. Open Found Listings and review hits.
6. Tighten `mustAvoid`, aliases, and price bands.
7. Add more platforms once the first one is stable.

Read the guide, start small, tune one variable at a time, and post good flips in Discord.
