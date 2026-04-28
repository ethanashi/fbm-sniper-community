# FBM Sniper Community v2 User Guide (v2.0.3)

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
| Apple Silicon Mac | `FBM.Sniper.Community-2.0.3-arm64.dmg` |
| Intel Mac | `FBM.Sniper.Community-2.0.3.dmg` |
| Windows x64 | `FBM.Sniper.Community.Setup.2.0.3.exe` |

On macOS, open the `.dmg` and **drag the app into Applications first**. Do not launch it from inside the DMG — macOS will apply stricter quarantine rules to apps running from a mounted disk image and you will hit the "could not verify" block on every launch.

Once the app is in `/Applications`, Gatekeeper may still warn that "macOS cannot verify that this app is free of malware" because the app is unsigned. You have two ways to get past it:

**Option A — clear the quarantine attribute (recommended):**

```bash
xattr -cr "/Applications/FBM Sniper Community.app"
```

**Option B — approve it in System Settings (macOS Sequoia 15+):**

1. Double-click the app and let the warning appear.
2. Click **Done**.
3. Open **System Settings → Privacy & Security**.
4. Scroll to the Security section. You will see a line saying *"FBM Sniper Community was blocked..."* with an **Open Anyway** button.
5. Click **Open Anyway**, confirm with your password, and the app will launch. macOS will remember the approval for future launches.

On Windows, SmartScreen may warn because the app is unsigned. Click **More info** and then **Run anyway**.

On first launch, the app opens immediately and downloads Puppeteer Chrome into app data in the background. This is a one-time setup of about 150 MB. The dashboard is usable right away; the Chrome-powered bots (Cars, Facebook) will wait for the download before they can start.

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
- **Pick your Vinted country** from the dropdown. Vinted runs a separate site per country (`www.vinted.es`, `.fr`, `.de`, `.co.uk`, `.com`, etc.) and the bot will refuse to start until you choose one.
- Set the Vinted poll interval.
- Paste an optional Vinted cookie.
- Paste the matching User-Agent for that cookie.
- Review Vinted hits with fee-aware pricing.
- Watch Vinted logs in the same tab.

Supported countries: United States, Spain, France, Germany, United Kingdom, Italy, Netherlands, Belgium, Poland, Czechia, Slovakia, Austria, Portugal, Luxembourg, Lithuania, Finland, Sweden, Denmark, Hungary, Croatia, Greece, Romania, and Ireland.

The cookie should include `access_token_web=...` **from the same country domain you selected**. If you leave it blank, the bot still tries its automatic cookie flow.

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

**Location is now mandatory and blank by default.** The Settings tab no longer has a city label field — only **Latitude** and **Longitude**. None of the snipers (Facebook, Wallapop, Vinted) will start until you fill in both numbers and click **Save Shared Settings**. An amber banner stays pinned to the top of the dashboard with an **Open Settings** shortcut until a valid location is saved.

The latitude/longitude you enter is what actually controls which city's listings the bots search. Typing "Phoenix, AZ" anywhere will do nothing — you must paste Phoenix's coordinates (`33.4484, -112.0740`) for the bots to search Phoenix. Grab coords for any city by googling "<city> latitude longitude" or by right-clicking the map pin in Google Maps (the first line of the popup is the `lat, lng` pair).

It includes:

- Proxy URL
- Proxy Pool
- Recommended proxy provider: [Oxylabs Residential Proxies](https://oxylabs.go2cloud.org/aff_c?offer_id=7&aff_id=2140&url_id=7)
- Latitude and longitude (required — coords only, no label)
- Include photos in Discord alerts
- Max photos per alert
- Browser opening behavior
- Auto-open Buy Now toggle
- Discord webhook for all deals
- Discord webhook for Buy Now deals
- Discord webhook for Maybe deals
- Per-bot poll intervals
- **Facebook GraphQL token fields** — Search doc_id, Search Variables, Detail doc_id, Detail Variables (see **Facebook GraphQL Token Setup** below for how to capture these)
- **Vinted country** (required before the Vinted bot will start)
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

1. Open the top-level **Settings** tab and confirm your latitude and longitude are saved. If you plan to run Vinted, pick your country as well. None of the bots will start without these.
2. Open the tab for the bot you want to run.
3. Check the poll interval.
4. Click **Start**.
5. Watch the Live Deals panel and the log panel.
6. Click **Stop** when you want the current bot to stop after the current step finishes.

Each bot runs separately. You can run only the platforms you care about.

If a bot refuses to start, check its Log tab. A missing-location or missing-Vinted-country error prints a clear red message telling you which field to fill in.

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

## Vinted Country And Cookie Setup

Before Vinted can run, pick your country from the **Vinted Country** dropdown in Settings (or in the inline strip on the Vinted tab). The bot uses the matching domain, locale, and referer for every request.

A cookie is optional — the bot tries an automatic cookie flow first. Paste one only if Vinted starts returning auth errors or you want a stronger bypass. The cookie **must come from the same country site you selected in the dropdown**:

1. Log into your country's Vinted site (for example `www.vinted.fr` if you picked France).
2. Open DevTools.
3. Go to Application or Storage cookies.
4. Find the cookie string that includes `access_token_web=...`.
5. Copy the cookie value.
6. Paste it into the Vinted cookie field.
7. Copy the same browser User-Agent from DevTools Network headers.
8. Paste it into the Vinted User-Agent field.
9. Click **Apply** or **Save Shared Settings**.

The cookie and User-Agent should come from the same browser session on the same country domain. Mixing a `.fr` cookie with a `.es` country selection will fail.

## Facebook GraphQL Token Setup

> **Use a secondary Facebook account — not your real one.** Facebook may flag or restrict accounts used for automated marketplace scraping. This has not been confirmed as a permanent ban trigger, but it is safer to use a throwaway or alternate account. Do not log into your personal Facebook account in the bot's browser.

The Facebook bot connects to Marketplace using Facebook's internal GraphQL API. The API requires a `doc_id` — a server-side query identifier — plus a matching `variables` payload that tells Facebook the shape of the request. These tokens expire and get rotated by Facebook, so if the bot stops returning listings you will need to refresh them.

### Signs you need to refresh

- Bot logs show `All doc_id candidates failed`
- Logs show `doc_id was not found` or `missing_required_variable_value (1675012)`
- The bot runs without errors but returns zero listings every cycle

### What you need to capture

There are two queries to capture: one for **search** (the main listing feed) and one for **detail** (individual listing pages). Each one needs its own `doc_id` and optionally a `variables` blob.

You only need to capture them once (or whenever they stop working).

### Step 1 — Prepare your secondary Facebook account

1. Open a **regular browser** (not incognito — you need cookies to persist).
2. Log into your secondary Facebook account.
3. Navigate to `https://www.facebook.com/marketplace/`.
4. Open **DevTools** (F12 on Windows/Linux, Cmd+Option+I on Mac).
5. Click the **Network** tab.
6. Click the **Clear** button (🚫 icon) to remove existing requests.

### Step 2 — Capture the Search doc_id and variables

You may need to navigate through multiple search pages before Facebook fires the right query. Do not refresh the page — navigate using links.

1. In the same browser, go to a fresh Marketplace search URL. Example:
   ```
   https://www.facebook.com/marketplace/search/?query=iphone
   ```
2. Back in DevTools → Network, type `graphql` in the filter box.
3. Look for a POST request whose **Name** column shows `graphql` and whose payload contains `CometMarketplaceSearchContentContainerQuery`. To check: click the request → **Payload** tab → search for `CometMarketplaceSearchContentContainerQuery` in the `fb4a_req`, `x-fb-friendly-name`, or `doc_id` fields.

   > **Important:** There are multiple search-related queries. You specifically want `CometMarketplaceSearchContentContainerQuery`, **not** `CometMarketplaceSearchContentPaginationQuery`. The Pagination variant uses a different variable shape and will fail with error `1675012`.

4. If you do not see it yet, click another search result or click into a category on Marketplace and check again. Sometimes it fires on the second navigation, not the first.

5. Once you find the right request:
   - Click it → **Payload** tab → **view source** (or "view URL-encoded").
   - Copy everything (Ctrl+A → Ctrl+C).

6. Paste the entire copied blob into the **Facebook Search Variables** field in Settings. The app strips everything else and pulls out the `doc_id` and `variables` for you — you do not need to clean it up.

   Alternatively, if you only want the `doc_id` value:
   - In the same Payload view, find `doc_id` (it will be a 16–18 digit number like `26533620642955534`).
   - Copy just the number and paste it into the **Facebook Search doc_id** field.

### Step 3 — Capture the Detail doc_id and variables

1. While still on Marketplace, click any individual listing (do not open a new tab — click from within Marketplace so the page transition fires a GraphQL request).
2. In DevTools Network, look for a POST whose payload contains `MarketplacePDPContainerQuery`.
3. Once you find it, copy the Payload source and paste it into **Facebook Detail Variables** in Settings.
   Or copy just the `doc_id` number into **Facebook Detail doc_id**.

### Step 4 — Save and restart

1. In the app, open the **Settings** tab.
2. Scroll to the **Facebook** section.
3. Paste your captured values into the matching fields:
   - **Facebook Search doc_id** — the 16–18 digit number for the search query
   - **Facebook Search Variables** — the full POST body or just the JSON `variables` blob
   - **Facebook Detail doc_id** — the 16–18 digit number for the detail query
   - **Facebook Detail Variables** — the full POST body or just the JSON `variables` blob
4. Click **Save Shared Settings**.
5. Fully quit and relaunch the app (Cmd+Q on Mac, close from taskbar on Windows) to ensure the new config is loaded.
6. Start the Facebook bot. Logs should now show the configured doc_id being used.

### Paste formats that work

The fields accept any of the following — you do not need to clean up what you paste:

- Just the doc_id number: `26533620642955534`
- With prefix: `doc_id=26533620642955534`
- JSON style: `"doc_id":"26533620642955534"`
- Full URL-encoded POST body (everything from the Payload "view source" tab)
- Decoded JSON: `{"buyLocation":{...},"params":{...},...}`

### How often to refresh

When Facebook rotates their query IDs (usually every few weeks), the bot will start logging `All doc_id candidates failed` again. Repeat the steps above and paste the new values. The whole process takes about 5 minutes.

## Proxies

Marketplace sites rate-limit aggressively. If you see repeated `429`, `403`, Facebook `1675004`, or straight request failures, add proxies.

Recommended provider: [Oxylabs Residential Proxies](https://oxylabs.go2cloud.org/aff_c?offer_id=7&aff_id=2140&url_id=7). I really recommend this one because they are extremely good, and in my testing I do not get rate limited nearly as much when using them.

This is an affiliate link, but it helps keep this project free, which was the original plan for the community version.

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
| Facebook logs `All doc_id candidates failed` or `1675012` | Facebook rotated its GraphQL query IDs. Capture fresh tokens from a secondary FB account (see **Facebook GraphQL Token Setup** above) and paste them into Settings. |
| Facebook bot runs but returns zero listings | Same as above — stale doc_id. Also check that your targets have `facebook` enabled in the Watchlist. |
| Facebook fails or rate-limits | Log into Facebook again if prompted, then add a proxy if errors continue. I recommend [Oxylabs Residential Proxies](https://oxylabs.go2cloud.org/aff_c?offer_id=7&aff_id=2140&url_id=7) for longer runs. |
| Wallapop returns repeated errors | Check target price/radius settings, then add a proxy or increase the poll interval. |
| Vinted returns 403/429 | Refresh the Vinted cookie and User-Agent, slow the poll interval, and consider [Oxylabs Residential Proxies](https://oxylabs.go2cloud.org/aff_c?offer_id=7&aff_id=2140&url_id=7) if you keep getting rate-limited. |
| Discord does not post | Verify webhook URLs, make sure the grade matches the route, and confirm Discord alerts are not blocked by network settings. |
| Save does nothing | Watch for the green side notification. If it does not appear, check Logs or reload Settings. |
| Amber location banner will not clear | You have not saved a valid latitude and longitude yet. Fill both fields in Settings and click **Save Shared Settings**. |
| Vinted refuses to start | Confirm you picked a country in **Settings → Vinted Country**. The Log tab will say `No Vinted country selected` until you do. |
| App will not open on macOS ("could not verify") | Drag the app into `/Applications` first, then run `xattr -cr "/Applications/FBM Sniper Community.app"`. If it still blocks, approve it in **System Settings → Privacy & Security → Open Anyway**. |
| App will not open on Windows (double-click does nothing) | Open `%APPDATA%\FBM Sniper Community\startup-error.log` and share the stack trace in `#questions`. The log is written whenever the app fails to boot. |

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

1. Open Settings and paste your latitude/longitude (required), pick your Vinted country (required if you want Vinted), then set proxies, Discord webhooks, and poll intervals. If you need proxies, I recommend [Oxylabs Residential Proxies](https://oxylabs.go2cloud.org/aff_c?offer_id=7&aff_id=2140&url_id=7) because they have been the most reliable in my testing.
2. Open Watchlist and confirm each shared target is enabled on the right platforms.
3. Start one bot first, not all four.
4. Watch logs for a full cycle.
5. Open Found Listings and review hits.
6. Tighten `mustAvoid`, aliases, and price bands.
7. Add more platforms once the first one is stable.

Read the guide, start small, tune one variable at a time, and post good flips in Discord.
