# Performance report

Raw data: [perf-report.json](perf-report.json). Produced by `npm run perf` ([e2e/perf.spec.ts](../e2e/perf.spec.ts)) on the optimized production build (`vite build` + `vite preview`).

## Environment

| Item | Value |
| --- | --- |
| CPU | AMD Ryzen 5 5600GT (6 cores / 12 threads), integrated Radeon graphics |
| RAM | 16 GB |
| OS | Windows 11 (10.0.26300) |
| Browser | Playwright Chromium 159, **headless**, WebGL through SwiftShader (software) |
| Resolution | 1600×900 viewport, devicePixelRatio 1 |
| Match config | 180 s session, 3 s spawn interval, seed 99 |
| Input | Autopilot: sail + turn right + all cannons held for 180 s real time |

## Results (headless, software WebGL)

| Metric | Value |
| --- | --- |
| Combat time measured | 180 s (4 matches: the autopilot ship sank 3 times and the run continued with Play Again) |
| Frames | 2 656 |
| Average FPS | 15.2 (17.6 before the ambient-life update) |
| p95 frame time | 83.4 ms |
| Max entities (ships + projectiles + effects) | 28 (plus ~20 fish and 4 birds, purely visual) |
| JS heap after GC, start → 5 start/play/exit cycles (MB) | 7.9 → 8.3 → 8.5 → 8.6 → 8.8 (11.5 before the first GC'd menu) |

## Reading the numbers

- **Frame rate is not representative.** Headless Chromium renders WebGL in software (SwiftShader) and is CPU-bound (p95 ≈ 83 ms ≈ 5 vsyncs at 60 Hz). The 60 FPS target must be checked in a headed browser with a GPU. In this sandbox a headed browser could not be launched, so that run is still to do:
  ```
  npm run perf -- --headed
  ```
  (or play in Chrome with DevTools → Performance → record a 3-minute match).
- The simulation itself is cheap: fixed 1/120 s steps over ≤ 10 ships and a few dozen projectiles with brute-force collision checks. Entity count stayed below 30 for the whole run.
- **Memory:** after five start/play(30 s)/exit cycles the heap grows ~0.2 MB per cycle (7.9 → 8.8 MB), with no steady climb in Pixi objects (every exit leaves 0 canvases and the Pixi application destroyed). The small growth is consistent with TanStack Query cache entries and the mock DB/outbox in memory; a longer run (20+ cycles) is the next step to confirm a plateau.

## Optimizations in place

- Textures loaded once and reused across matches; sea variation + islands + vegetation baked into one texture per match; fish and birds drawn as batched sprites; projectile sprites pooled.
- React does not re-render per frame: HUD updates only when a displayed value changes.
- Renderer resolution capped at 2× device pixels.
