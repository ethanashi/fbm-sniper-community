# FBM Sniper Community User Guide (v2.0.4)

FBM Sniper Community is a local desktop app for finding marketplace flips across Facebook Marketplace, Wallapop, Vinted, Mercari, and the built-in Cars scanner.

Version 2.0.4 is focused on easier setup:

- Facebook no longer needs pasted cookies, `doc_id` values, or GraphQL variables.
- Cars use the same improved Facebook Marketplace fallback path as the normal Facebook bot.
- Facebook and Cars photos now attach to the individual listing instead of reusing one bootstrap photo.
- Mercari works without user cookies.
- Blank target prices are treated as wide open ranges instead of silently blocking a category.
- Shared display currency controls how prices show in the dashboard.

The app runs on your computer. It stores settings, watchlists, seen IDs, and found listings locally. Discord alerts are optional.

## Join The Discord

For setup help, target examples, and release notes, join:

**[discord.gg/BkpQSnth4C](https://discord.gg/BkpQSnth4C)**

Useful channels:

- `#how-to-use-bot` for walkthroughs.
- `#questions` for setup help.
- `#best-flips` for wins and examples.

## Pro Beta Access

Pro is the next major release after v2.0.4.

To get Pro Beta access when it launches, invite **3 people** to the Discord server. The invite tracker bot counts valid invites automatically, so there is no application form and no need to DM anyone asking for access.

Pro Beta members will get early access to the next version before the full public release. Pro is planned to include more sites, stronger deal review tools, and extra automation built for faster sniping.

Important:

- Invite 3 people to qualify for Pro Beta access.
- Make sure your invites are real server joins, because the tracker uses valid invites.
- Pro is up next after this v2.0.4 community release.
- The v2.0.4 Windows installer is compiled separately and may appear shortly after the Mac DMGs.

## Download And Install

Download the latest release from GitHub:

**[github.com/ethanashi/fbm-sniper-community/releases](https://github.com/ethanashi/fbm-sniper-community/releases)**

Use the file that matches your computer:

| Platform | Release file |
| --- | --- |
| Apple Silicon Mac (M1/M2/M3/M4) | `FBM.Sniper.Community-2.0.4-arm64.dmg` |
| Intel Mac | `FBM.Sniper.Community-2.0.4.dmg` |
| Windows x64 | `FBM.Sniper.Community.Setup.2.0.4.exe` |

The Windows `.exe` is built separately on a Windows PC. If the GitHub release does not show it yet, use the Mac builds or wait for the Windows upload.

### macOS Install Steps

1. Download the correct `.dmg`.
2. Open the `.dmg`.
3. Drag **FBM Sniper Community** into **Applications**.
4. Eject the `.dmg`.
5. Open the app from `/Applications`.

Do not run the app from inside the DMG. Dragging it into Applications first avoids a lot of repeated macOS security warnings.

Because the app is unsigned, macOS may say it cannot verify the app.

Recommended fix:

```bash
xattr -cr "/Applications/FBM Sniper Community.app"
```

Then open the app again.

Alternative macOS approval flow:

1. Double-click the app.
2. Let the warning appear.
3. Click **Done**.
4. Open **System Settings -> Privacy & Security**.
5. Scroll to Security.
6. Click **Open Anyway** for FBM Sniper Community.
7. Confirm with your password.

### Windows Install Steps

1. Download `FBM.Sniper.Community.Setup.2.0.4.exe`.
2. Double-click it.
3. If SmartScreen appears, click **More info**.
4. Click **Run anyway**.
5. Choose the install folder and finish setup.

If the app fails to launch on Windows, check:

```text
%APPDATA%\FBM Sniper Community\startup-error.log
```

Share that log in Discord if you need help.

## First Launch

On first launch, the app may download a bundled browser for Puppeteer. This is a one-time download used by Facebook, Cars, and Mercari. Leave the app open until it finishes.

You do not need:

- Facebook cookies.
- Facebook `doc_id` values.
- Facebook GraphQL variables.
- Mercari cookies.
- A cloud account.

You may still choose to add proxies and Discord webhooks.

## Quick Start

1. Open **Settings**.
2. Enter your latitude and longitude.
3. Click **Save Shared Settings**.
4. Open **Watchlist** and enable the targets you care about.
5. Make sure the target has the platform checkbox enabled, such as Facebook, Wallapop, Vinted, or Mercari.
6. Open one platform tab.
7. Click **Start**.
8. Watch the log and found listing cards.
9. After one stable cycle, start another platform if you want.

Start small. One platform and a few targets are easier to tune than everything at once.

## Location Setup

Facebook, Cars, Wallapop, and Vinted need coordinates. Mercari is national and does not need coordinates.

The app uses latitude and longitude, not city names. A city label does nothing by itself.

Examples:

| City | Latitude | Longitude |
| --- | ---: | ---: |
| Dallas, TX | `32.7767` | `-96.7970` |
| Phoenix, AZ | `33.4484` | `-112.0740` |
| San Francisco, CA | `37.7749` | `-122.4194` |
| Madrid, Spain | `40.4168` | `-3.7038` |

To find coordinates:

1. Open Google Maps.
2. Search your city or neighborhood.
3. Right-click the map pin.
4. Copy the first line, which is the latitude and longitude.
5. Paste the two numbers into Settings.
6. Click **Save Shared Settings**.

The amber location banner disappears after a valid location is saved.

### Facebook Marketplace Location URL

Latitude and longitude alone are not enough for Facebook Marketplace — Facebook ignores raw coordinates in the rendered fallback path and serves listings based on the account's session location instead. Symptoms include US users seeing Stockton California, or international users seeing US results.

To fix this, paste your **Facebook Marketplace Location URL** into Settings.

How to get it:

1. Open `https://www.facebook.com/marketplace/` in your normal browser while logged in.
2. Let Facebook pick a city for you, or click the location pin and choose a city manually.
3. Once you are on a city-specific page, copy the URL from the address bar. It will look like:
   ```
   https://www.facebook.com/marketplace/113132795367102/
   ```
   The long number (`113132795367102`) is Facebook's internal ID for that city. Each city has its own.
4. Paste the full URL into the **Facebook Marketplace Location URL** field in Settings.
5. Click **Save Shared Settings**.

Examples of city IDs you can use directly if you do not want to look yours up:

| City | Marketplace URL |
| --- | --- |
| Des Moines, IA | `https://www.facebook.com/marketplace/113132795367102/` |
| Lagos, Nigeria | `https://www.facebook.com/marketplace/106265246077413/` |

The bot uses this URL to scope its searches to your city. Without it, Facebook will route the rendered fallback to whatever city it picks for your account.

You only need to do this once per location. If you move, repeat the steps with a new URL.

## Dashboard Tabs

### Cars

Cars is the vehicle scanner built on Facebook Marketplace.

Use it for:

- Vehicle targets like Toyota Camry, Honda Civic, Ford F-150, Mazda CX-5, and similar searches.
- Buy Now and Maybe underwriting.
- Rejected listing review.
- Car-specific watchlist and config JSON.

Cars are capped at 10 active targets. If you enable more than 10, only the first 10 active targets run.

Cars now use the improved Facebook Marketplace path:

- It discovers Facebook metadata automatically.
- It falls back to rendered Marketplace pages when GraphQL is blocked or returns no usable feed.
- It fetches detail photos per listing.
- It parses car prices like `$7,500` correctly.

### Facebook

Facebook is the shared marketplace bot for general targets and electronics.

Use it for:

- iPhones.
- PlayStations.
- Electronics.
- Any custom item you add to the shared Watchlist.

Facebook does not require manual cookies or manual `doc_id` setup. Save your location, enable Facebook on a target, and start the bot.

If Facebook blocks a GraphQL request, the bot tries the rendered Marketplace page fallback. This is normal in v2.0.4.

### Wallapop

Wallapop is for supported Wallapop countries and regions.

Use it for:

- Local electronics.
- Phones.
- Consoles.
- Custom product targets.

Wallapop uses your shared location and target price bands. If Wallapop returns errors, slow down the poll interval or add a proxy.

### Vinted

Vinted uses country-specific sites, so you must choose a Vinted country before starting it.

Supported country examples include:

- United States
- Spain
- France
- Germany
- United Kingdom
- Italy
- Netherlands
- Belgium
- Poland
- Portugal
- Sweden
- Denmark
- Ireland

Vinted can try its automatic flow without a cookie. If Vinted blocks you, add a cookie and matching User-Agent from the same Vinted country domain.

### Mercari

Mercari works without user cookies.

The bot opens public Mercari search in the bundled browser, watches Mercari's own search API response, and parses item data from that response.

Use it for:

- Phones.
- Consoles.
- Clothing.
- Tables.
- Electronics.
- Any custom item you put in the Watchlist.

If Mercari returns no results for a target, check that:

- Mercari is checked on the target.
- The target query is not too narrow.
- The price band is not too tight.
- The Mercari log does not show a temporary block.

### Found Listings

Found Listings combines hits from:

- Cars
- Facebook
- Wallapop
- Vinted
- Mercari

Cards show platform, title, price, grade, target, group, notes, and photos when available.

Use the filters to narrow by platform, group, and deal quality.

### Watchlist

The shared Watchlist controls Facebook, Wallapop, Vinted, and Mercari targets.

Each target can run on one or more platforms. A target has:

- Label
- Query
- Group
- Enabled toggle
- Platform checkboxes
- Price range
- Aliases
- Must-include terms
- Must-avoid terms
- Optional per-platform overrides

If a category has no price set, v2.0.4 opens it wide instead of blocking it. You can still set min and max prices when you want tighter filters.

### Settings

Settings controls the shared marketplace workspace.

Important fields:

- Latitude and longitude
- Display currency
- Proxy URL
- Proxy pool
- Discord webhooks
- Include photos in Discord alerts
- Per-bot poll intervals
- Vinted country
- Optional Vinted cookie and User-Agent
- Optional Mercari User-Agent override
- Raw shared watchlist JSON

Click **Save Shared Settings** after editing.

### Logs

Logs show output from:

- Cars
- Facebook
- Wallapop
- Vinted
- Mercari

When a bot does not start or finds nothing, check Logs first.

## Shared Target JSON

Shared targets power Facebook, Wallapop, Vinted, and Mercari.

Basic example:

```json
{
  "id": "iphone-15-pro",
  "label": "iPhone 15 Pro",
  "group": "Phones",
  "enabled": true,
  "product": "iphone",
  "targetType": "electronics",
  "platforms": ["facebook", "wallapop", "vinted", "mercari"],
  "query": "iPhone 15 Pro",
  "aliases": ["iPhone 15 Pro", "15 Pro"],
  "mustInclude": [],
  "mustAvoid": ["icloud", "locked", "parts", "not working"],
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
| `id` | Stable unique ID. |
| `label` | Name shown in the dashboard. |
| `group` | UI bucket for filters. |
| `enabled` | Set to `false` to skip the target. |
| `product` | Helps scoring. Examples: `iphone`, `playstation`, `console`, `general`. |
| `targetType` | Usually `electronics` for shared bots. |
| `platforms` | Any mix of `facebook`, `wallapop`, `vinted`, and `mercari`. |
| `query` | Search text sent to the platform. |
| `aliases` | Extra text used to match listings to the target. |
| `mustInclude` | Required keywords. Leave empty for broad searches. |
| `mustAvoid` | Skip listings containing these words. |
| `radiusKM` | Optional per-target radius. `null` uses defaults. |
| `minPrice` / `maxPrice` | Price band. Leave blank for a wide-open category. |
| `allowShipping` | Allows shippable listings where supported. |
| `platformOverrides` | Per-platform price overrides. |

## Car Target JSON

Car targets are separate from shared marketplace targets.

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

Car fields control underwriting:

- `retailBase` estimates resale value.
- `maxPrice` controls the search ceiling.
- `maxMileage` filters high-mile listings.
- `feesReserve`, `reconBase`, and `marginFloor` control deal quality.
- `mustAvoid` removes salvage, flood, parts, and similar listings.

## Deal Grades

Shared marketplace grades:

| Grade | Meaning |
| --- | --- |
| `A` | Strong deal. |
| `B` | Good deal. |
| `C` | Fair, worth checking. |
| `D` | Lowball only. |
| `F` | Skip. |
| `?` | Not enough pricing context. |

Car verdicts:

| Verdict | Meaning |
| --- | --- |
| `Buy Now` | Strong enough spread and acceptable risk. |
| `Maybe` | Review manually or send a lower offer. |
| `Pass` | Rejected by rules or underwriting. |

## Discord Alerts

Discord is optional. Leave webhooks blank if you do not want alerts.

You can set:

- All deals webhook.
- Buy Now webhook.
- Maybe webhook.
- Include photos toggle.
- Max photos per alert.

If alerts do not send, verify the webhook URL and check the Logs tab.

## Proxies

Marketplace sites rate-limit. Proxies help longer sessions.

Recommended provider:

**[Oxylabs Residential Proxies](https://oxylabs.go2cloud.org/aff_c?offer_id=7&aff_id=2140&url_id=7)**

Proxy format:

```text
http://user:pass@host:port
```

You can use:

- **Proxy URL** for one proxy.
- **Proxy Pool** for multiple proxies, one per line.

If a proxy causes browser errors, try a different proxy or run direct for a test cycle.

## Reset Memory

Cars has a Reset Memory button. It wipes:

- Car found listings.
- Car rejected listings.
- Car seen IDs.

It does not wipe shared Facebook, Wallapop, Vinted, or Mercari found files.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| App will not open on macOS | Move it to Applications, then run `xattr -cr "/Applications/FBM Sniper Community.app"`. |
| Windows SmartScreen blocks install | Click **More info** then **Run anyway**. |
| Amber location banner stays visible | Save valid latitude and longitude in Settings. |
| Facebook returns no GraphQL listings | This can be normal. v2.0.4 falls back to rendered Marketplace pages. |
| Facebook or Cars photos look wrong | Restart the bot so detail sessions refresh. v2.0.4 fetches photos per listing. |
| Cars finds nothing | Check price range. Car prices like `$7,500` are supported in v2.0.4. |
| Mercari finds nothing | Check that Mercari is checked on the target and price range is not too tight. |
| Vinted will not start | Pick a Vinted country in Settings. |
| Wallapop errors repeatedly | Slow the poll interval or use a proxy. |
| Discord does not post | Check webhook URLs and grade routing. |
| Found Listings looks empty | Clear filters and make sure platform chips are enabled. |

## Developer Commands

Most users do not need this section.

Run from source:

```bash
npm install
npm run desktop
```

Useful commands:

```bash
npm run check
npm run scan:test
npm run build:mac
npm run build:win
```

Build outputs go to `dist/`.

## Release Files For v2.0.4

Mac files to upload to GitHub Releases:

```text
dist/FBM Sniper Community-2.0.4-arm64.dmg
dist/FBM Sniper Community-2.0.4-arm64.dmg.blockmap
dist/FBM Sniper Community-2.0.4.dmg
dist/FBM Sniper Community-2.0.4.dmg.blockmap
```

GitHub release downloads normalize those Mac filenames to:

```text
FBM.Sniper.Community-2.0.4-arm64.dmg
FBM.Sniper.Community-2.0.4-arm64.dmg.blockmap
FBM.Sniper.Community-2.0.4.dmg
FBM.Sniper.Community-2.0.4.dmg.blockmap
```

Windows file placeholder until it is built on a Windows PC:

```text
dist/FBM Sniper Community Setup 2.0.4.exe.PLACEHOLDER.txt
```

## Best Workflow

1. Set location.
2. Choose Vinted country if using Vinted.
3. Enable one target on one platform.
4. Start the bot.
5. Watch one full cycle in Logs.
6. Review Found Listings.
7. Tighten price range and avoid keywords.
8. Add more targets and platforms slowly.

The less you run at once in the beginning, the easier it is to see what is working.
