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
| macOS (Apple Silicon) | `FBM Sniper Community-2.0.0-arm64.dmg` |
| macOS (Intel) | `FBM Sniper Community-2.0.0.dmg` |
| Windows (x64) | `FBM Sniper Community Setup 2.0.0.exe` |

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
2. Log into Facebook in the browser window if you plan to use the `Cars` or `Facebook` bot.
3. Open the `Settings` tab and review the shared watchlist, bot toggles, and polling intervals.
4. Add Discord webhook URLs only if you want alerts. They are optional.
5. Start the bot you want from its tab.

## Discord webhooks

Discord notifications are controlled from the `Settings` tab:

- `All Webhook`: every graded deal
- `Buy Now Webhook`: grades `A` and `B`
- `Maybe Webhook`: grades `C` and `D`

Leaving all three blank disables Discord delivery without affecting the snipers.

## Vinted cookie setup

The Vinted bot can use a manual cookie from either the `Settings` tab or the `VINTED_COOKIE` environment variable. The manual value should include `access_token_web=...`.

Quick way to get it:

1. Log in to [vinted.es](https://www.vinted.es).
2. Open your browser devtools.
3. Find the request cookies for `vinted.es`, or inspect the site cookies under Application/Storage.
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
