# Pirate Battle

A 2D top-down naval shooter built with **React**, **TypeScript (strict)** and **PixiJS**. Sail between islands, sink enemy ships and score as many points as you can before time runs out.

Ranking and match history use a REST API mocked with **MSW** (in development, tests **and** the deployed build), consumed through **Axios** and **TanStack Query**. End-to-end and visual tests use **Playwright**.

**Play it: https://game-developer-challenge-rouge.vercel.app/** (Vercel; the mocked ranking/history API runs in the deployed build)

- Challenge statement: [docs/CHALLENGE.md](docs/CHALLENGE.md)
- Architecture and decisions: [ARCHITECTURE.md](ARCHITECTURE.md)
- Performance report: [reports/PERFORMANCE.md](reports/PERFORMANCE.md)

## Setup

Requirements: Node.js 20+ (developed on Node 24) and npm.

```bash
npm ci
npx playwright install chromium   # only needed for the E2E tests
npm run dev                       # http://localhost:5173
```

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with mocks |
| `npm run build` | Type-check (`tsc -b`) and production build into `dist/` |
| `npm run preview` | Serve the production build on http://localhost:4173 |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript project check |
| `npm run test:e2e` | Playwright suite (desktop + mobile Chromium) against the production build |
| `npm run test:e2e:update` | Re-generate visual baselines |
| `npm run test:e2e:report` | Open the HTML report (`playwright-report/`) |
| `npm run perf` | 3-minute real-time profiling run + memory check (writes `reports/perf-report.json`) |

### Environment variables

None are required. Optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `''` (same origin) | Base URL for the ranking/history API. The MSW handlers match any origin ending in `/api/...`. |
| `CI` | unset | Playwright: forbids `test.only`, enables 1 retry and 2 workers. |

### Deploy

The app is a static SPA with hash routing, so any static host works without rewrites (Vercel, Netlify, Cloudflare Pages). Build command `npm run build`, output directory `dist`. `public/mockServiceWorker.js` is shipped with the build so the mocks run in production too.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Sail forward | `W` / `↑` | ⬆ button |
| Turn left / right | `A` `D` / `←` `→` | ↶ ↷ buttons |
| Bow cannon (1 ball) | `Space` / `J` | centre fire button |
| Port broadside (3 balls, left) | `Q` / `K` | left fire button |
| Starboard broadside (3 balls, right) | `E` / `L` | right fire button |
| Pause / resume | `P` / `Esc` | pause button (top right) |

Pressing **Play** opens a *How to Play* dialog with all controls; **OK** starts the match. Movement and firing can be combined. The on-screen touch buttons appear only on touch devices (primary pointer coarse); with a mouse and keyboard they are hidden. Game keys are only captured while a match is running (not in menus, forms or the pause dialog). On phones the game is played in **landscape**; in portrait a "rotate your device" hint is shown.

The game pauses automatically when the window loses focus or the tab is hidden. Resuming always requires a player action (Resume button or `Esc`), and nothing pressed during the pause carries over.

## Gameplay configuration

All balance values live in one typed object: [`src/game/config.ts`](src/game/config.ts) (`DEFAULT_CONFIG`). Systems only read from a frozen per-match snapshot, so changing balance never requires touching game logic.

| Group | Values |
| --- | --- |
| Match | `sessionSeconds` |
| Spawns | `interval`, `weights` (chaser/shooter), `openingSequence` (guarantees both types), `minDistanceFromPlayer`, `maxAlive` |
| Player | `maxHealth`, `speed`, `acceleration`, `turnSpeed`, `radius`, `frontWeapon`, `sideWeapon` (`projectiles`, `spacing`) |
| Weapons | `cooldown`, `damage`, `projectileSpeed`, `range`, `lifetime` |
| Chaser | ship values + `ramDamage` |
| Shooter | ship values + `weapon`, `attackRange`, `preferredDistance`, `aimTolerance` |

Options screen (persisted in `localStorage`, validated, applied to the **next** match):

| Option | Range | Default |
| --- | --- | --- |
| Game session time | 60–180 s (whole seconds) | 120 s |
| Enemy spawn time | 0.5–10 s, steps of 0.5 s | 3 s |
| Captain name | 2–16 characters | `Captain` |
| Sound effects | on / off | on |

Scoring: 1 point per enemy sunk by the player's cannons. A Chaser ramming the player explodes and does **not** score. The match ends when time runs out or the player's ship is destroyed.

## Network scenarios (mock API)

Open **Options → Network lab** to pick a scenario or press **Reset mock server** (restores fixtures and the `normal` scenario). The selection is stored in `localStorage` and survives refresh.

| Scenario | Behaviour |
| --- | --- |
| `normal` | Success, 250 ms latency |
| `empty` | Empty lists |
| `slow` | 2.5 s latency |
| `variable-latency` | Seeded random 0.1–2.5 s |
| `out-of-order` | Alternating 1.8 s / 0.15 s answers: older requests resolve after newer ones |
| `timeout` | Requests hang 9 s (client timeout is 5 s) |
| `network-error` | Connection failure |
| `server-error` | HTTP 500 everywhere |
| `client-error` | HTTP 404 on reads, 400 on writes (not retried) |
| `ranking-failure` / `history-failure` | Only that endpoint fails with 500 |
| `write-timeout` | The match **is stored**, but the answer times out → retry must not duplicate |
| `write-unavailable` | Saving returns 503 until the scenario changes → record stays pending, sent after recovery |

Other ways to select scenarios:

- URL: `?scenario=write-timeout`, `?mockSeed=123` (random latency seed), `?mockReset` (restore fixtures).
- Console / tests: `window.__mock.setScenario('slow')`, `__mock.setSeed(1)`, `__mock.setLatency(0)`, `__mock.reset()`, `__mock.info()`.

### Reproducing failures by hand

1. **Pending record after refresh**: select `write-unavailable`, play a match (set session to 60 s and spawn to 0.5 s for a quick one). The result shows *Could not save this match*. Refresh: the main menu shows *1 match waiting to sync*. Select `normal` and refresh → it is sent automatically and appears once in Match History.
2. **Timeout without duplicates**: select `write-timeout`, finish a match, wait for *Could not save* (~16 s, three attempts), select `normal`, press **Retry save** (even twice) → one record.
3. **Late responses**: select `out-of-order`, open Ranking and page quickly → the shown page always matches the last selection.
4. **Asset failure**: in DevTools → Network, block `ship_3*.png` and press Play → error + **Retry**.

## Testing

`npm run test:e2e` builds the app, serves the production build and runs every spec in Chromium desktop (1280×800) and the main flows (`@smoke`, `@mobile`) on Pixel 7 landscape. Each test runs in a fresh browser context (isolated storage, service worker). Results: HTML report in `playwright-report/`, traces/videos for failures in `test-results/`. Visual baselines are versioned in [`e2e/__screenshots__`](e2e/__screenshots__) (generated on Windows; regenerate with `npm run test:e2e:update` on another OS).

Determinism: tests open the game with `?testClock=1&seed=N`. The match then uses a seeded RNG and a **manual clock**: `window.__pirate.advance(ms)` steps the real simulation with the real input state (keys pressed through Playwright's keyboard, touch buttons through pointer events) and renders it. `window.__pirate.snapshot()` exposes read-only state. Nothing else is bypassed.

| # | Requirement | Spec |
| --- | --- | --- |
| 1 | Options navigation, validation, persistence | `options.spec.ts` |
| 2 | Asset loading, failure, retry, texture reuse | `assets.spec.ts` |
| 3 | Movement, rotation, arena limits, islands | `gameplay.spec.ts › Movement` |
| 4 | Front/side fire, damage, cooldowns, no duplicate score | `gameplay.spec.ts › Combat` |
| 5 | Chaser/Shooter behaviour, spawn interval | `gameplay.spec.ts › Enemies` |
| 6 | End by time/death, frozen simulation, clean restart | `gameplay.spec.ts › Match end` |
| 7 | Pause, blur/hidden, resume without timer drift | `gameplay.spec.ts › Pause` |
| 8 | Result display + persistence after refresh | `screens.spec.ts` |
| 9 | Abandon, repeated navigation, touch controls | `screens.spec.ts` |
| 10 | Ranking/History pagination, loading, empty, error | `api.spec.ts` |
| 11 | Recording, both tabs refreshed, pending recovery after refresh | `api.spec.ts` |
| 12 | Timeout retry without duplication, late responses | `api.spec.ts` |
| — | Visual regression: menu, arena, result | `visual.spec.ts` |

## Project layout

```
src/
  game/        simulation (rules), renderer (Pixi), input, assets, audio, controller, config
  api/         contracts, Axios client, TanStack Query hooks, pending-submission outbox
  mocks/       MSW handlers, mock DB (localStorage), fixtures, network scenarios
  state/       localStorage persistence, tiny external store
  ui/          React screens and components
e2e/           Playwright specs, helpers and visual baselines
assets/        provided art and sounds (used directly by the build)
reports/       performance evidence
```

## Possible improvements

Not implemented yet, grouped by area.

### Gameplay

- **Balance from playtests**: an idle ship dies fast while a moving one survives comfortably; tune Shooter damage/cooldown and spawn weights with real players.
- **Difficulty curve**: shorter spawn interval, faster enemies and better Shooter aim as the match progresses.
- **Smarter AI**: path-finding around islands (grid A* or flow field) to stop ships hugging island corners; Shooters that turn broadside and lead their shots.
- **More enemy types** with existing art: fast dinghies (`dinghy_small_*`), a heavy broadside ship, a fixed cannon on an island (`cannon.png`).
- **Pickups** dropped by sunk ships: repair, rapid fire, shield.
- **Ship physics**: momentum and drift, reverse, damage when ships collide (not only the Chaser ram).
- **Larger or multiple maps** with a scrolling camera and minimap, using the full tile sheet (forts, bridges).
- **Combo / streak scoring** and simple achievements.

### Feedback and presentation

- **Arena edge**: on screens wider/taller than 5:3 the sea now fills the screen but the ship stops at an invisible line; show it (foam line, buoys or a soft darkening).
- **Small screens**: on phones the arena is scaled down a lot; add a mild zoom that follows the player on small viewports.
- **Living world that reacts**: fish scatter when a ship passes, birds flee from cannon fire, ship wakes and cannon smoke particles, crew thrown overboard on hits (`ship_parts/crew_*`).
- Floating "+1" on kills, damage numbers, off-screen arrows for enemies near the edges.
- Cooldown rings on the HUD and touch buttons.
- Music and separate volume sliders (effects, ambience).
- Gamepad support and rebindable keys.

### Accessibility

- Respect `prefers-reduced-motion` in the canvas too (screen shake, flashes, birds), not only in CSS.
- Health-bar colours plus a pattern or text for colour-blind players; a high-contrast HUD option.
- Option to slow the game down (game speed) for players who need more time to react.

### Technical

- **Real backend** with the same contracts (`src/api/contracts.ts`), server-side score plausibility checks (score vs. duration and spawn interval) and rate limiting.
- **Player identity** across devices (sign-in or a recoverable code) instead of a per-browser `playerId`.
- **Unit tests** (Vitest) for the simulation, collisions and the outbox, so rules are tested without a browser.
- **Rendering**: one atlas for ships and effects (`ships_miscellaneous_sheet`) to cut texture switches, pooling for effects, a spatial grid for collisions if entity counts grow.
- **Offline / PWA**: cache assets so the game opens without a connection (the outbox already copes with offline submissions).
- **Internationalization**: move UI strings to a dictionary.

## Assets and licences

All art and sound come from the challenge asset pack in [`assets/`](assets/) and are used as provided (PNG at 1× and 2×, the UI atlas JSON, WAV sounds). No third-party assets or fonts were added; the UI uses system fonts.
