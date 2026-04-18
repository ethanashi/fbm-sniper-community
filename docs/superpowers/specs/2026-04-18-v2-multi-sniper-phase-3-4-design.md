# V2 Multi-Sniper Phase 3-4 Design

## Summary

This spec covers the next two slices of `feature/v2-multi-sniper`:

1. Phase 3: implement Discord notifications for the shared marketplace bots.
2. Phase 4: replace the current car-centric UI shell with a six-tab multi-platform shell.

The work must preserve these constraints:

- `server.cjs` remains CommonJS.
- `lib/**` remains ESM.
- `lib/scanner.js` and the underlying Cars sniper behavior stay untouched.
- No AI or LLM calls are introduced anywhere.
- Discord configuration is optional. The snipers must continue to run normally when no webhook URLs are configured.

## Goals

- Deliver a real notifier in `lib/shared-marketplace/notifier.js` that can post Discord embeds for Facebook, Wallapop, and Vinted finds.
- Keep notifier behavior safe by default: if no webhook URLs are configured, `notify(record)` exits quietly.
- Replace the top-level UI navigation with `Cars | Facebook | Wallapop | Vinted | Settings | Logs`.
- Add platform-specific found-deal API reads and websocket refreshes so each marketplace tab can show recent hits.
- Expand shared settings so users can manage Discord settings and per-bot controls from one place.

## Non-Goals

- Reworking the Cars sniper pipeline or its existing backend data model.
- Introducing shared car/found/rejected pages inside the new UI.
- Refactoring `ui/app.js` into separate modules as part of this phase.
- Adding AI-based scoring, analysis, negotiation text, or private-repo moat features.

## Current State

### Backend

- `server.cjs` already starts four processes: `car-sniper`, `facebook-sniper`, `wallapop-sniper`, and `vinted-sniper`.
- Shared workspace config and watchlist CRUD already live behind `/api/shared/*`.
- Shared marketplace bots already write records to:
  - `data/facebook/found.ndjson`
  - `data/wallapop/found.ndjson`
  - `data/vinted/found.ndjson`
- `lib/shared-marketplace/notifier.js` is currently a no-op stub.

### Frontend

- The current UI is still the older car-centric shell with dashboard/watchlist/found/rejected/settings/logs.
- `ui/app.js` already supports websocket status/log updates and the old Cars routes.
- The shared marketplace routes exist server-side, but the UI is not yet wired to them.

## Architecture

### 1. Notifier Architecture

`lib/shared-marketplace/notifier.js` becomes a small ESM utility with four responsibilities:

1. Normalize notification config from `loadWorkspaceConfig()`.
2. Decide which Discord webhooks should receive a record based on `grade`.
3. Build Discord embeds from the marketplace record without any AI or car-only fields.
4. Optionally open the listing URL in the system browser when `autoOpenBrowser` allows it.

The notifier will use `axios` for webhook delivery and `child_process.spawn` for browser launch behavior. It will not own persistence and will not mutate records.

### 2. Routing Rules

Records are routed as follows:

- `allWebhookUrl`: send every `go=true` record that reached `notify(record)`.
- `buyNowWebhookUrl`: send only grades `A` and `B`.
- `maybeWebhookUrl`: send only grades `C` and `D`.
- If every webhook URL is blank, return without logging noise or throwing.

Webhook delivery should deduplicate identical URLs so the same endpoint does not receive duplicate posts when reused across multiple config fields.

### 3. Embed Design

All embeds should be programmatic and marketplace-native:

- Green (`0x3fb950`) for grades `A` and `B`.
- Yellow (`0xd4a72c`) for grades `C` and `D`.
- Neutral fallback only if the grade is unknown.

The main embed should include:

- Title
- Platform
- Grade
- Listed price
- Max-buy value when present
- Savings when present
- Score
- Query
- Target label/group
- Listing URL button
- Reasons summary in the footer or description

Platform-specific additions:

- Facebook and Wallapop:
  - product
  - model
  - storage when present
- Vinted:
  - all-in max (`max_buy_all_in`)
  - ceiling
  - fee breakdown
  - condition
  - battery health
  - photo count
  - seller name/rating/item count

Photo handling:

- Use `config.notifications.includePhotos` and `maxPhotos`.
- Include up to `maxPhotos` images when photo URLs are available in the record payload.
- Vinted should support multiple image embeds similar to the private reference, but only from marketplace data already present in the record.

Explicitly excluded from the embed layer:

- `gemma_analysis`
- `aiReview`
- `negotiation_leverage`
- car-only fields like VIN, mileage, year, recall references
- any Gemini/Gemma naming or footer text

### 4. Server Additions

`server.cjs` will gain shared-marketplace read helpers that are parallel to the existing Cars helpers, not replacements for them.

Required additions:

- A shared `readNdjsonTail(file, limit)` style helper to safely read recent entries.
- `GET /api/shared/found/:platform`
  - Allowed platforms: `facebook`, `wallapop`, `vinted`
  - Reads the corresponding `found.ndjson`
  - Returns newest-first records
  - Supports a simple limit, defaulting to a reasonable recent count
- File watchers for the three shared found files that broadcast websocket messages when file mtimes change

Websocket event design:

- Keep existing Cars events unchanged.
- Add a new shared event family for marketplace finds, for example:
  - `type: "shared-found-updated"`
  - `platform: "facebook" | "wallapop" | "vinted"`
  - `ts`

This is preferred over stdout parsing because the bots already persist canonical deal records to per-platform files. Watching those files keeps the server logic simple and avoids log-format coupling.

### 5. UI Shell Replacement

The top nav in `ui/index.html` will be replaced with:

- `Cars`
- `Facebook`
- `Wallapop`
- `Vinted`
- `Settings`
- `Logs`

This is a full replacement of the old multi-page car UI shell. The old `Dashboard`, `Watchlist`, `Found Listings`, and `Rejected` tabs will be removed from the top-level navigation.

### 6. Tab Responsibilities

#### Cars

The Cars tab is a compact compatibility tab, not the old workspace.

It should show:

- Cars bot status
- Start/Stop actions for `car-sniper`
- A short explanation that Cars remains the original community sniper
- Optional quick link to Logs for deeper inspection

It should not recreate the old dashboard/watchlist/found/rejected experience.

#### Facebook / Wallapop / Vinted

Each marketplace tab should have the same structural pattern:

- Bot title and short description
- Running/stopped badge
- Start button
- Stop button
- Small config summary where useful
- Recent found deals list sourced from `/api/shared/found/:platform`

The found-deals list should emphasize:

- Title/model
- Grade badge
- Listed price
- Max-buy or ceiling context
- Savings
- Reason snippets
- Open button

Vinted cards should also surface seller and fee details where available.

The UI can reuse card patterns across platforms, with conditional fields instead of platform-specific page files.

#### Settings

The Settings tab becomes the main shared marketplace control panel.

It must expose these persisted fields from `config.notifications`:

- `discord.allWebhookUrl`
- `discord.buyNowWebhookUrl`
- `discord.maybeWebhookUrl`
- `includePhotos`
- `maxPhotos`
- `autoOpenBrowser`

It must also expose these bot controls from `config.bots`:

- `bots.facebook.enabled`
- `bots.facebook.pollIntervalSec`
- `bots.wallapop.enabled`
- `bots.wallapop.pollIntervalSec`
- `bots.vinted.enabled`
- `bots.vinted.pollIntervalSec`
- `bots.vinted.cookie`

Existing shared watchlist editing should remain available in this tab, backed by the current `/api/shared/settings` endpoint. The UI can present this as a raw JSON editor, a managed panel, or both, but shared settings save must continue to write both config and watchlist together.

Messaging in Settings must clearly state:

- Discord alerts are optional.
- Bots can run without any webhook configured.
- Webhooks are recommended for real-time alerts.

#### Logs

The Logs tab remains the shared process log viewer.

It must support selecting all four process names:

- `car-sniper`
- `facebook-sniper`
- `wallapop-sniper`
- `vinted-sniper`

Existing websocket-driven log streaming should be preserved.

## Data Flow

### Found Deals

1. Bot finds a deal.
2. Bot appends JSON to `data/{platform}/found.ndjson`.
3. Bot calls `notify(record)`.
4. Server-side file watcher sees the ndjson file update.
5. Server broadcasts `shared-found-updated` with the relevant platform.
6. The active marketplace tab reloads recent deals from `/api/shared/found/:platform`.

This keeps Discord delivery and UI refresh decoupled. A webhook failure does not block the UI from seeing a deal that was already written to disk.

### Settings

1. UI loads `/api/shared/settings`.
2. User edits notification and bot fields.
3. UI posts updated `config` and `watchlist` to `/api/shared/settings`.
4. Server persists via `workspace.js`.
5. Server broadcasts `shared-config-updated` and `shared-watchlist-updated`.
6. UI refreshes local state from the shared settings response or a follow-up fetch.

## Error Handling

### Notifier

- Invalid or missing webhook URLs should behave like absent configuration unless a URL is present but the request fails.
- Failed Discord posts should not crash the sniper loop.
- A failed post to one webhook should not block attempts to other configured webhooks.
- Browser auto-open should be best-effort and skipped on unsupported platforms.

### Server

- Unsupported platform values for `/api/shared/found/:platform` should return `400`.
- Missing ndjson files should return an empty array instead of `500`.
- Watchers should tolerate files that do not exist yet.

### UI

- A failed platform fetch should render an empty-state or inline error without breaking the rest of the page.
- Start/Stop buttons should use optimistic state only when safe, then reconcile with `/api/status`.
- Shared settings save failures should show a clear inline status message.

## Testing Strategy

### Notifier

Add focused tests or verification around:

- Config normalization with blank webhook fields
- Grade-to-webhook routing
- Embed field generation for standard and Vinted records
- Optional photo inclusion limits
- Silent no-op behavior when Discord is unconfigured

### Server

Verify:

- `/api/shared/found/facebook`
- `/api/shared/found/wallapop`
- `/api/shared/found/vinted`
- newest-first ordering
- invalid platform rejection
- shared websocket broadcasts on file changes

### UI

Verify:

- New nav switches tabs correctly
- Each marketplace tab can start/stop the correct process
- Settings load/save round-trips shared config fields
- Log selector includes all four bots
- The page still loads without Discord settings configured

At minimum, finish with fresh syntax/runtime verification for every changed JS file and the repo’s check command once the check script is updated later in Phase 5.

## Implementation Sequence

1. Implement notifier helpers and Discord routing in `lib/shared-marketplace/notifier.js`.
2. Add shared found-file readers, API route, and watcher broadcasts in `server.cjs`.
3. Replace the top-level HTML tab structure in `ui/index.html`.
4. Rework `ui/app.js` around the new six-tab shell while preserving Cars log/process support.
5. Verify that shared settings saves still round-trip watchlist and config safely.
6. Run syntax and app-level verification on the changed files.

## Risks

- `ui/app.js` is already large, so replacing the shell without leaking old car assumptions will require disciplined boundaries inside the file.
- Shared record shapes differ by platform, especially for Vinted; card rendering should be resilient to missing optional fields.
- Browser auto-open behavior is OS-dependent and must stay best-effort.

## Acceptance Criteria

- `notify(record)` sends Discord alerts when webhook URLs are configured and silently no-ops when they are not.
- Grade `A/B` deals route to buy-now and all channels; grade `C/D` deals route to maybe and all channels.
- The app launches with top-level tabs `Cars | Facebook | Wallapop | Vinted | Settings | Logs`.
- Each marketplace tab can control its process and display recent found deals from shared ndjson data.
- Shared settings include Discord fields, bot toggles, intervals, and Vinted cookie input.
- Existing Cars backend behavior remains intact.
- No AI-related fields or private-repo moat behavior appears in the community code.
