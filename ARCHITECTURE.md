# Architecture

## Layers

```
React UI (src/ui)            menus, forms, HUD, dialogs, touch buttons
   │  props / callbacks            ▲ coarse HudState (external store)
   ▼                               │
GameController (src/game)    owns one match: Pixi Application, loop, pause, input, audio
   │ step(dt, input)               │ events + state (read-only)
   ▼                               ▼
Simulation (rules)  ─────────►  GameRenderer (Pixi view)
 pure TS, no DOM                reads state, never mutates it
```

| Concern | Module | Notes |
| --- | --- | --- |
| Rules | `game/simulation.ts` | Movement, weapons, projectiles, collisions, AI, spawns, scoring, end conditions. No DOM, no timers, no Pixi. Seeded RNG. |
| Arena | `game/arena.ts` | Fixed 1600×960 world built from 64 px tiles; islands with rounded-rect colliders. |
| Rendering | `game/renderer.ts` | Pixi scene graph, health bars, damage states, effects. |
| Input | `game/input.ts` | Keyboard + touch merged into a plain `InputState`; bindings are data shown in the UI. |
| Loop / lifecycle | `game/GameController.ts` | Fixed-step loop on the Pixi ticker, pause, resize, cleanup, test hooks. |
| Assets | `game/assets.ts` | Texture loading with progress, failure, retry; module-level cache reused by every match. |
| Audio | `game/audio.ts` | WebAudio, lazy decode, optional (never blocks). |
| UI state | `ui/*`, `state/*` | Hash router, options, last result, HUD store. |
| Remote state | `api/*` | Contracts, Axios client, TanStack Query hooks, submission outbox. |
| Mocks | `mocks/*` | MSW handlers, mock DB, fixtures, scenarios. |

## React ↔ PixiJS integration

- `GameScreen` loads textures first (progress bar, error, **Retry**). Only then `GameView` mounts and creates a `GameController` in an effect; the cleanup calls `destroy()`.
- **Strict Mode**: React mounts, unmounts and mounts again. `init()` is async (Pixi `Application.init`), so `destroy()` can run first: it sets a `destroyed` flag, and `init()` checks it after awaiting, then destroys the half-made app and does not attach the canvas. The second mount creates a fresh controller. Test hooks (`window.__pirate`) are only exposed by the controller that is still current.
- **No React render per frame**. The controller pushes a coarse `HudState` (`hp`, `score`, whole `secondsLeft`, `paused`, `phase`) into a tiny external store (`useSyncExternalStore`) **only when one of those values changes**, i.e. a few times per second at most. Continuous state (positions, velocities, cooldowns, projectiles) stays inside the simulation.
- Match end: the controller calls `onEnd` once (React builds the record, saves it, submits it) and, after 1.2 s of game clock for the explosion to play, `onShowResult`.

## Simulation loop

- Pixi's ticker drives rendering at display rate. Frame time is clamped to 100 ms and added to an accumulator; the simulation steps with a **fixed `dt` of 1/120 s**. Movement, cooldowns, projectile lifetimes, timer and spawns all use this `dt`, so results do not depend on frame rate.
- Pause stops accumulation and **zeroes the accumulator** on pause and resume, so no paused time is caught up. Input is inactive while paused and cleared on resume, so keys held during the pause do not produce movement or shots.
- Auto pause: `visibilitychange` (hidden) and `window.blur`. Resume always needs an explicit action (Resume button / `Esc`).
- After the end, `step()` is a no-op: no movement, damage, spawns or score.
- **Manual clock** (`?testClock=1`): the ticker only renders; the simulation advances exclusively through `advance(ms)`, using the same fixed steps and the live input. Visual-only animation also follows that clock, which keeps screenshots stable.

## Gameplay rules

- Heading 0 = up, clockwise positive. The player accelerates forward, decelerates when released, turns at `turnSpeed`.
- Weapons: bow cannon (1 ball) and port/starboard broadsides (3 parallel balls spaced along the hull), each with its own cooldown.
- Projectiles have speed, damage, range and lifetime. Each one hits at most once: it is flagged dead on the first hit, island, expiry or exit, and removed in the same step.
- **Chaser**: steers to the player at full speed; on contact it deals `ramDamage`, explodes and is removed (no point).
- **Shooter**: approaches, slows near `preferredDistance`, fires its bow cannon when in `attackRange` and aimed within `aimTolerance`.
- Steering avoids islands and walls with a forward "whisker" probe: if blocked, it tries increasing angles left/right and picks the free side closest to the current heading.
- Spawns: every `interval` seconds (first after min(1.5 s, interval)). The first two spawns are a Chaser then a Shooter, so both always appear; after that a weighted draw. Spawn points are sampled along the arena edges and must be ≥ `minDistanceFromPlayer` from the player, clear of islands and other ships. `maxAlive` caps the fleet.
- Destroyed enemies are removed from the simulation immediately (no more damage, shots or collisions); the renderer shows the explosion and a sinking wreck as pure visuals.

## Collisions

- Ships are circles. Islands are rounded rectangles (a core rect + radius), slightly inset from the tile art.
- Ship vs island: closest point on the core rect; if the distance is below `radius + r`, the ship is pushed out along the normal (and slowed). Ship vs arena: clamp inside the bounds.
- Ship vs ship: circle overlap resolved symmetrically, then island/wall correction runs again.
- Projectile vs island: point inside the rounded rect. Projectile vs ship: distance to centre ≤ radius. Player shots only test enemies; enemy shots only test the player.
- With at most ~10 enemies and a few dozen projectiles, brute-force checks are far below 1 ms per step; a spatial grid was not needed.

## Rendering and resources

- The world is a fixed 1600×960 container scaled with `min(viewW/1600, viewH/960)` and centred, so proportions, arena bounds and coordinates never change with screen size. The sea is a screen-space tiling sprite behind the world, scaled and offset to stay seamless with it, so water fills the whole screen (no letterbox bars). When the screen is wider or taller than 5:3, the extra strip is open water outside the arena: ships stop at the arena edge. The renderer is resized from a `ResizeObserver`; `resolution = min(devicePixelRatio, 2)` with `autoDensity`.
- Textures: 1× or 2× (retina) PNGs picked by `devicePixelRatio`; the UI atlas (`ui_sheet.json`) is parsed into a Pixi `Spritesheet`. They are loaded once and cached at module level; restarting or starting a new match does not fetch them again.
- Static scenery (sea colour variation: shallow water around islands, deep patches, sandbars; island tiles; extra vegetation placed with a fixed seed) is baked once per match with `renderer.generateTexture` into a single arena-sized texture: one quad per frame. Projectile sprites are pooled.
- Ambient life (`game/ambience.ts`) is purely visual and never touches the simulation: schools of fish swim under the baked scenery (so they look submerged) and turn away from islands; seagulls with ground shadows fly across and re-enter from the edges. Their shapes are drawn once into textures so they render as batched sprites. Their motion follows the render clock, so under the manual test clock screenshots stay deterministic.
- With `?testClock=1` the Pixi ticker is stopped and the scene is drawn only after `advance()` or a resize, which keeps the parallel test run light.
- Damage states use the art variants: hull colour `n`, damaged `n+6`, heavily damaged `n+12`, wreck `n+18`, plus fire sprites; hits flash the hull, the camera shakes when the player is hit.
- `destroy()` removes window/document listeners, disconnects the `ResizeObserver`, removes the ticker callback, destroys the scene graph and the Pixi application (keeping shared textures), and stops the ambience loop.

## Local persistence

| Key | Content |
| --- | --- |
| `pb.options.v1` | Options (validated on load; invalid values fall back to defaults) |
| `pb.lastResult.v1` | Last completed match (shown on `#/result` after refresh) |
| `pb.player.v1` | Generated `playerId` |
| `pb.pendingMatches.v1` | Outbox of unconfirmed submissions |
| `pb.mock.*` | Mock server DB, scenario, seed, latency |

Navigation uses the URL hash. Reloading on `#/play` has no session to resume, so it returns to the menu: the match is abandoned and nothing is recorded. Leaving the game screen (menu, back button) also discards the match.

## Ranking and history

### Contracts (`api/contracts.ts`)

```
GET  /api/ranking?configKey=t120-s3&page=1&pageSize=8   → Page<RankingEntry>
GET  /api/players/:playerId/matches?page=1&pageSize=8    → Page<MatchRecord>
POST /api/matches  (MatchRecord, Idempotency-Key: matchId) → 201 { record, created: true }
                                                           | 200 { record, created: false }
errors → { error: { code, message } }
```

`MatchRecord` = `matchId`, `playerId`, `playerName`, `playedAt`, `score`, `durationSeconds` (active time), `endReason`, `config` (`sessionSeconds`, `spawnIntervalSeconds`, `configKey`).

- The ranking only compares matches with the same `configKey` (session time + spawn interval). Order: score ↓, duration ↓ (survived longer), `playedAt` ↑, `matchId` ↑ — fully deterministic.
- Other players come from deterministic fixtures (`mocks/fixtures.ts`).

### Queries and cache

- Axios: 5 s timeout; errors are normalised into `ApiError` (`timeout`, `network`, `client`, `server`).
- TanStack Query: keys `['ranking', configKey, page]` and `['history', playerId, page]`; `staleTime` 15 s; `refetchOnMount: 'always'` so a tab refetches every time it is shown; refetch on window focus; `keepPreviousData` while paging (with an *Updating…* indicator).
- Retries: up to 2 for timeouts, connection errors and 5xx, exponential delay; 4xx are not retried.
- Late responses: every query passes TanStack's `AbortSignal` to Axios, so superseded requests are cancelled; data is stored per key, so a slow answer for page 2 can never replace page 3.
- Errors keep the last good data visible (*Refresh failed… Showing the last loaded data*) with **Try again**.

### Submitting a match exactly once

1. On match end, the record (with a client-side UUID `matchId`) is written to the **outbox** in `localStorage`, then sent.
2. `sendOnce` keeps one in-flight promise per `matchId`: double clicks, the result screen and the recovery job all share it. It retries transient errors twice (0.5 s, 1 s).
3. The server inserts idempotently by `matchId`; a replay returns the existing record with `created: false`.
4. On success the entry is marked saved (and dropped from storage) and both `ranking` and `history` queries are invalidated.
5. On failure it stays in the outbox as `failed` with the error message; the result screen offers **Retry save** and the menu shows *N matches waiting to sync*. On app start and on the browser `online` event, every unsent entry is resent. A new match can be played meanwhile.

The `write-timeout` scenario exercises the worst case: the write is committed but the client sees a timeout. The retry hits the same `matchId` and gets the existing record — one history row, one ranking entry.

## Mock server (MSW)

- `mocks/handlers.ts` is the single set of handlers used by `npm run dev`, the production build (deployed) and Playwright, all through the same Service Worker (`public/mockServiceWorker.js`). The app starts the worker before rendering; if that fails (no Service Worker support), the game still works and the tabs show their error state.
- Mock data lives in `localStorage`, so confirmed records survive refresh and both tabs read the same store (consistent state).
- Scenarios, seed and base latency are in `localStorage` too (selectable from the Network lab, URL or `window.__mock`). Latency for `variable-latency` comes from a seeded PRNG; tests set latency to 0.

## Accessibility and responsiveness

- All menus are real buttons/inputs with labels; visible focus ring; the Play button is focused on the menu.
- Forms: `aria-invalid`, hint + error linked through `aria-describedby`, errors announced (`role="alert"`), focus moves to the first invalid field.
- Pause dialog: `role="dialog"`, `aria-modal`, focus trap, `Esc` resumes, focus returns to the arena.
- The Captain's Log uses the ARIA tabs pattern (arrow keys switch tabs). Tables have headers and captions.
- HUD values are also in a visually hidden semantic list; a polite live region announces only meaningful changes (score, pause, low health, 30-second marks, end), never per frame.
- Touch buttons render only when `(pointer: coarse)` matches. Mobile: landscape is the supported orientation (portrait shows a rotate hint). The HUD and touch controls are DOM overlays that respect safe areas; the canvas fits inside without clipping.

## Balance decisions

- Player 100 HP; bow cannon 25 dmg / 0.45 s; broadside 3×20 dmg / 1.4 s per side but shorter range (360 vs 520) — strong up close, needs positioning.
- Chaser 40 HP (two bow shots), fast and agile; ram 20 dmg. Shooter 60 HP, slower, 8 dmg every 2 s at up to 380 px — its shots are slow enough (380 px/s) to dodge.
- First spawn after 1.5 s so the arena is never empty for long; spawns are at least 420 px away to avoid unavoidable damage; at most 10 enemies alive.
- An idle ship dies within a standard match; a moving, firing ship survives the default 120 s with ~3 s spawns most of the time.

## Limitations

- Enemy steering is local (whiskers), not path-finding: a ship can occasionally hug an island corner for a moment before sliding off.
- The arena is a single fixed map; there is no camera scroll.
- Visual baselines are platform-specific (generated on Windows).
- Audio starts after the first user gesture (browser autoplay policy).
- The "server" is a mock in the browser: data is per browser profile.
