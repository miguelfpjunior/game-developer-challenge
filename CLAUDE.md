# CLAUDE.md

Guidance for Claude Code in this repo.

## Project

**Pirate Battle** — 2D top-down naval shooter. Hiring challenge (Jungle Gaming). Full spec in [docs/CHALLENGE.md](docs/CHALLENGE.md) (Portuguese) — the source of truth; re-read the relevant section before changing a feature. [README.md](README.md) is the solution README; [ARCHITECTURE.md](ARCHITECTURE.md) explains design decisions — keep both in sync with code.

## Commands

- `npm run dev` (5173) · `npm run build` · `npm run preview` (4173) · `npm run lint` · `npm run typecheck`
- `npm run test:e2e` — builds + previews, runs desktop and mobile Chromium. `npm run test:e2e:update` refreshes visual baselines (`e2e/__screenshots__`).
- `npm run perf` — 3-min real-time profile, writes `reports/perf-report.json`.
- Tests drive the game via `?testClock=1&seed=N` and `window.__pirate.{snapshot,advance,perf}`; mocks via `window.__mock`.
- Asset tests block the service worker (`test.use({ serviceWorkers: 'block' })`) because `page.route` cannot see requests that pass through MSW's worker.

## Code map

`src/game` (simulation = rules, renderer = Pixi, input, assets, audio, GameController = loop/lifecycle, config = all balance) · `src/api` (contracts, axios client, TanStack hooks, outbox) · `src/mocks` (MSW handlers, localStorage DB, fixtures, scenarios) · `src/state` · `src/ui` (screens). Balance changes go in `src/game/config.ts` only; changing balance changes seeded test outcomes (e.g. the time-up test uses seed 2).

## Required stack (all must be used for real)

| Concern | Tech |
| --- | --- |
| UI, menus, forms, dialogs | React |
| Language | TypeScript, `strict: true` |
| Game rendering (arena, ships, projectiles, FX, health bars) | PixiJS |
| Ranking + match history remote state | TanStack Query |
| HTTP client | Axios |
| API mocks (dev, tests, **and production build**) | MSW |
| E2E + visual regression | Playwright |

Build tool / styling free (default choice: Vite). Must deploy publicly (Vercel preferred) with MSW working in the deployed build.

## Hard rules

- **English only**: UI text, identifiers, docs (`README.md`, `ARCHITECTURE.md`).
- **Separation**: game rules / rendering / input / UI state are separate layers. Combat state lives in the simulation, not React.
- **No React re-render per frame.** Sync HUD via throttled events/store subscriptions.
- **Time-based sim** (delta time / fixed step). Movement, damage, cooldowns, spawns independent of FPS.
- **Typed central gameplay config** (durations, spawn interval/distribution, HP, speeds, rotation, damage, projectile range/speed/lifetime, cooldowns, Shooter range). Balance changes = config only. Each match uses a snapshot of config at start.
- **Lifecycle**: clean up listeners, ticker, timers, entities, textures on exit/restart. Must work under React Strict Mode (double mount).
- **Canvas** fits screen + devicePixelRatio, keeps aspect, input coords, arena bounds.
- **Textures** loaded once, reused; load failure handled with retry before combat; visible loading progress.
- Game keys captured only while gameplay is active.
- Console must have no unhandled errors.

## Gameplay summary

- Player: move forward, rotate L/R, front shot (1 ball), side broadside (3 parallel balls, left and right commands). Limited HP. Bounded to arena, blocked by islands. Keyboard + touch controls; move and shoot at same time; controls shown in UI.
- Enemies: **Chaser** (chases, explodes on contact, damages player, no point) and **Shooter** (approaches, fires in range). Both collide with islands, take damage, show HP. Spawn on interval at free points far from player. Both types appear in a standard match.
- Projectiles: direction, speed, damage, range/lifetime; damage once; removed on hit/obstacle/expire/out of arena. Per-weapon cooldown. Islands block ships and projectiles.
- Match: 60–180 s active time. 1 point per enemy killed by player. Ends on timeout or player death; end freezes everything. Restart resets all.
- Pause: manual + auto on blur / tab hidden. Freeze timer, cooldowns, sim. Resume needs player action; no accumulated input.
- FX: shot effect, explosion, ship damage states by HP (ships have `_1/_2/_3`-style damage variants).

## Screens

Main menu (Play, Options, control help, Ranking + Match History tabs) · Options (session time, spawn time; validated, persisted) · Match (Pixi arena, HUD, controls, pause) · Result (score, time played, end reason, record status, Play Again, Main Menu).

Reload or leaving combat abandons the match (not recorded). Persist locally: options, last completed result.

## Ranking & history API (MSW-mocked)

- Typed contracts. Ranking: paginated, sorted by score, compares same-config matches, deterministic tie-break. History: create record + paginated query.
- Record fields: match id, player id, date, score, effective duration, end reason, config used.
- **Idempotent submit**: one record per match (client-generated match id). Retries/double clicks return existing record. Pending submits persist across refresh and can be retried. Player can start new match while one is pending.
- TanStack Query: loading, empty, error, background refresh, cache, invalidation, retries. Invalidate both tabs after submit and on tab re-show. Stale/late responses must not overwrite newer data.
- API failures never block game, options, or combat.
- MSW scenarios (selectable + reset): success, empty, multi-page, slow, variable latency, out-of-order, timeout, network error, 4xx/5xx, query failure, timeout-after-write (no dupes), unavailable at match end then recover. Seeded randomness/latency in tests. Mock data persisted locally.

## Accessibility & responsive

Desktop + mobile, defined mobile orientation, usable touch controls, no clipping. Keyboard menu nav, visible focus, dialog focus trap, labels, contrast, accessible errors. Score/time/state also in semantic DOM (aria-live, not per frame).

## Tests (Playwright)

Cover the 12 flows listed in README §8. Chromium desktop + mobile. Visual baselines (menu, stable arena, result) committed. Seeded scenarios + controllable sim clock via test hooks — but real rules/input/collisions/rendering run. Combat tests drive real controls. Isolated state per test. HTML report + traces on failure.

## Performance

Optimized build, 60 FPS target. Record FPS, p95 frame time, entity count over a 3‑min match. Memory check after 5 start/play/exit cycles. Ship profiling evidence (hardware, browser, resolution, config, limits).

## Assets

- `assets/png/default/` (1×) and `assets/png/retina/` (2×): `effects/`, `ships/`, `ship_parts/`, `tiles/`, `ui/{controls,hud,menu}`.
- `assets/spritesheet/`: `ui_sheet(.json|_retina.json)` UI atlas (extra `ui` metadata in logical 1× units, origin top-left); `ships_miscellaneous_sheet*.xml` (Starling/TexturePacker XML — may need conversion for Pixi).
- `assets/tilesheet/`, `assets/vector/`: tiles and source vectors.
- `assets/sounds/*.wav`: cannon, hits, explosions, UI, ambience loops, game state cues.
- Atlas conversion / optimization allowed; document sources + licenses.

## Deliverables checklist

- Source, lockfile, assets, mocks, fixtures, tests.
- `README.md` (solution): setup, env vars, controls, gameplay config, network scenario select/reset, how to reproduce failures. Scripts for dev, build, preview, lint, typecheck, Playwright.
- `ARCHITECTURE.md`: React/Pixi integration, sim loop, collisions, resource mgmt, local persistence, ranking/history contracts, cache, pending-record recovery, limits, balance choices.
- Test reports + profiling reports.
- Public deploy URL matching delivered code. Works from clean checkout, no private services.

## Scoring weights

Gameplay 35 · Pixi/architecture/lifecycle 20 · UI/a11y/responsive 15 · Query/Axios/consistency 10 · MSW 5 · Playwright 10 · Perf + docs 5.
