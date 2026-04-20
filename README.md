# FBM Sniper Community

An open-source desktop marketplace sniper that now ships with:

- Cars on Facebook Marketplace
- Facebook electronics sniper
- Wallapop electronics sniper
- Vinted electronics sniper
- Optional Discord deal routing

Everything runs locally on your machine.

## Join the Discord

If you want setup help, examples, and a place to share flips, jump into the community Discord:

**→ [discord.gg/BkpQSnth4C](https://discord.gg/BkpQSnth4C)**

## What v2 adds

- New shared multi-platform watchlist for Facebook, Wallapop, and Vinted
- Dedicated tabs for `Facebook`, `Wallapop`, and `Vinted`
- Shared settings for Discord webhooks, bot toggles, poll intervals, and Vinted cookie input
- **Worldwide Vinted support** — pick your country (US, UK, FR, DE, IT, NL, PL, PT, etc.) and the bot hits the right domain
- **Location is now user-configurable** — no more Spain-only defaults; set your own city + coordinates in Settings
- Discord alerts routed to `All`, `Buy Now`, and `Maybe` webhooks
- Discord alerts are optional; the app still runs normally without any webhook configured

## Supported bots

| Bot | Purpose |
| --- | --- |
| Cars | Original Facebook Marketplace car scanner |
| Facebook | Electronics sniper driven by the shared watchlist |
| Wallapop | Electronics sniper with shared watchlist + rate-limit backoff |
| Vinted | Electronics sniper with fee-aware ceilings and cookie refresh |

## Download & install

Grab the latest release from the [Releases page](https://github.com/ethanashi/fbm-sniper-community/releases):

| Platform | File |
| --- | --- |
| macOS (Apple Silicon) | `FBM.Sniper.Community-2.0.1-arm64.dmg` |
| macOS (Intel) | `FBM.Sniper.Community-2.0.1.dmg` |
| Windows (x64) | `FBM.Sniper.Community.Setup.2.0.1.exe` |

### macOS "app is damaged" warning

The app is unsigned, so Gatekeeper may block it the first time. If that happens, run:

```bash
xattr -cr "/Applications/FBM Sniper Community.app"
```

Then open it again.

### Windows SmartScreen warning

The Windows build is unsigned, so SmartScreen may show a warning. Click **More info** and then **Run anyway**.

## First launch

1. Open the app.
2. **Set your location** in the `Settings` tab (city label + latitude/longitude). None of the snipers will run until you fill this in — the banner at the top of the app reminds you.
3. If you plan to use the `Vinted` bot, pick your country from the **Vinted Country** dropdown in Settings (or in the Vinted tab's inline settings strip).
4. Log into Facebook in the browser window if you plan to use the `Cars` or `Facebook` bot.
5. Review the shared watchlist, bot toggles, and polling intervals.
6. Add Discord webhook URLs only if you want alerts. They are optional.
7. Start the bot you want from its tab.

## Discord webhooks

Discord notifications are controlled from the `Settings` tab:

- `All Webhook`: every graded deal
- `Buy Now Webhook`: grades `A` and `B`
- `Maybe Webhook`: grades `C` and `D`

Leaving all three blank disables Discord delivery without affecting the snipers.

## Vinted country + cookie setup

Vinted runs a separate site per country (`www.vinted.es`, `.fr`, `.de`, `.co.uk`, `.com`, etc.). The Vinted bot won't start until you pick your country from the dropdown in `Settings → Vinted`. Supported countries: United States, Spain, France, Germany, United Kingdom, Italy, Netherlands, Belgium, Poland, Czechia, Slovakia, Austria, Portugal, Luxembourg, Lithuania, Finland, Sweden, Denmark, Hungary, Croatia, Greece, Romania, Ireland.

A manual cookie is optional — the bot auto-fetches one from whatever country you pick. If you want to supply your own (stronger bypass), the value must include `access_token_web=...` **from the same Vinted country domain you selected**.

Quick way to get it:

1. Log in to your country's Vinted site (e.g. `www.vinted.fr`).
2. Open your browser devtools.
3. Find the request cookies for that domain, or inspect the site cookies under Application/Storage.
4. Copy the cookie string that contains `access_token_web=...`.
5. Paste it into the Vinted cookie field in `Settings`, or export it as `VINTED_COOKIE`.

If you do nothing, the bot still attempts automatic cookie refresh on its own.

## Environment variables

Reference values live in [.env.example](.env.example).

Most users can configure everything from the UI. The environment variables are mainly useful for CLI runs, custom launchers, and packaging environments:

- `VINTED_COOKIE`
- `VINTED_PROXY`
- `PROXY_ENABLED`
- `PROXY_HOST`
- `PROXY_PORT`
- `PROXY_USER`
- `PROXY_PASS`

## Developer setup

Requires Node.js 18+ and git.

```bash
git clone https://github.com/ethanashi/fbm-sniper-community fbm-sniper
cd fbm-sniper
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
```

Build desktop installers:

```bash
npm run build:all
```

On Apple Silicon Macs, install `makensis` first if you want the local Windows build:

```bash
brew install makensis
```

## Data layout

Runtime files are written under `data/`:

- `data/config.json`, `data/watchlist.json`, `data/found_listings.ndjson`, `data/rejected_listings.csv`, and `data/seen_ids.json` for the original Cars bot
- `data/shared-marketplace/config.json` and `data/shared-marketplace/watchlist.json` for the shared electronics bots
- `data/facebook/found.ndjson`, `data/wallapop/found.ndjson`, and `data/vinted/found.ndjson` for discovered deals

## Project layout

```text
lib/          scanner + marketplace snipers (ESM)
server.cjs    Express + WebSocket backend for the UI
electron.cjs  Electron shell
ui/           Static dashboard (HTML/CSS/JS)
data/         Runtime data
build/        electron-builder hooks and local packaging helpers
docs/         Specs, plans, and guides
```

## License

MIT — see [LICENSE](LICENSE).
