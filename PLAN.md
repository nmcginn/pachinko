# Pachinko

A playable browser pachinko game with a hand-written 2D physics sim in real units. Steel balls, brass nails, a start pocket that spins a digital reel, tulips, and an attacker gate that opens on a jackpot. The long-term hook is a nail-adjust mode: bend nails, watch the payout rate change.

Stack: Vite + TypeScript (strict), Canvas 2D, Vitest for unit tests, Playwright for smoke tests, `tsx` for headless tools, deployed to Cloudflare Pages. No game engine, no physics library, no UI framework.

---

## Status

Agents: update this section at the end of every session.

- Current milestone: M8, polish and mobile. M7 is done: its last PR (export/import, #18) and the follow-up (#19) are on master with CI green.
- Done in this milestone: (1) Responsive layout, the first half of M8's first bullet (PR on 2026-10-31). Every control over the canvas now sits in one CSS grid, `#ui` in index.html and style.css, at the screen's edges, and the board goes in the largest space they leave: `render/layout.ts`'s `freeArea` (pure) takes the viewport and the controls' boxes and searches every way of clearing them (moving one side of the area past each control in the way) for the biggest board; `render/board.ts`'s `fitBoardIn` centres it there. main.ts measures the controls again only when something moves them (a resize, a control resizing, showing or hiding, edit mode, the debug overlay), and publishes where it drew the board as `canvas[data-board-view]` ("scale,ox,oy"), which the e2e tests now click through (`tests/e2e/boardview.ts`) instead of recomputing the fit. `REEL_BAND_PX` is gone. Portrait: reel and ball count at the top (the reel moves left of centre when the two don't fit side by side, at 320 px); the buttons (sound, vibration on touch screens, adjust nails) stacked at the bottom left; the handle at the bottom right, under the right thumb. While editing in portrait the panel sits full width above "Done adjusting", the live stats take the top in place of the reel and ball count, and the handle, sound and vibration toggles are hidden (play is paused; M and V still work), so the board shrinks to fit between them and every nail stays visible and clickable (it was covered at 375×667). Landscape: the board at full height in the middle, the buttons (in rows) and, while editing, the panel on the left; the reel, ball count, live stats and handle on the right. Safe-area insets are respected. The debug overlay is now hidden unless the URL has `?debug` or `?inplay`, or D is pressed (`input/debug.ts`'s `bindDebugToggle`); it keeps updating while hidden. The reduced-motion half of the bullet was already in from M6 (no screen flash, a still reel celebration; `tests/e2e/visuals.spec.ts`). Tests: `tests/render/layout.test.ts` (the search, including 200 random layouts never overlapping), `tests/e2e/layout.spec.ts` (six sizes from 320×568 to 1280×800, in play and editing: no control covers the board, the board is at least a given size, buttons are 44 px tall, the handle is bottom right in portrait, a start nail can be picked while editing; rotation; the debug overlay). (2) Settings, M8's second bullet (PR on 2026-11-01). A Settings button opens a panel (`#settings-panel`, in the adjust panel's place on screen; the two never show together) with: jackpot odds, 1 in 99 (the default), 199 or 319, applied at once to later start entries (spins already drawn keep their results); starting balls, 125, 250 (the default), 500 or 1250 (¥500 to ¥5000 at ¥4 a ball), applied from the next new game, which the panel says until then; volume, 0 to 100% in tenths, scaling M6's master level and separate from mute; the vibration toggle, moved here from the button stack (touch screens only, V still works); and New game, which clears the balls in play and starts the tray and the machine again on the board as it stands (nail edits kept), asking for a second press once the current game has launched a ball. Play pauses while the panel is open, and the handle, the sound toggle and Adjust nails hide so the board can grow into their room; Escape or Done closes it, and entering edit mode closes it. The settings are saved in localStorage as `pachinko.settings` and read back field by field (`game/settings.ts` `parseSettings`: anything not on offer falls back to its default, so a stale or corrupt save never stops the game loading). The launch handle's keyboard now ignores keys aimed at a form field (`input/launcher.ts` `inFormField`), so the arrows work in the selects and the slider. Code: `game/settings.ts` (pure: the choices, defaults, parsing), `game/table.ts` `newGame`, `game/economy.ts` `resetEconomy` (and `startingBalls` on the economy), `game/machine.ts` `setJackpotProbability`/`resetMachine`, `audio/sound.ts` `setVolume`, `input/settings.ts` (storage and the panel). The Settings button is its own grid cell: under the other buttons in portrait, above the handle on the right in landscape (in the button row there it would have wrapped the buttons to a second line and shrunk the board at 900×700). Tests: `tests/game/settings.test.ts`, `tests/game/newgame.test.ts`, additions to the machine, economy, sound and launcher tests, `tests/input/settings.test.ts`, `tests/e2e/settings.spec.ts`, and `tests/e2e/layout.spec.ts` now also opens the settings at every size. (3) Lighthouse performance ≥ 90, M8's second acceptance item (PR on 2026-11-02). `tools/lighthouse.ts` (`npm run lighthouse`) serves dist/ with vite preview, runs Lighthouse's performance category several times in headless Chromium (Playwright's, or `CHROME_PATH`), and judges the median score (`tools/lighthouse-score.ts`, pure); CI's new `lighthouse` job runs it on the mobile preset (5 runs) and the desktop preset (3 runs), threshold 90. Measuring first showed the idle page re-rastering the whole canvas every frame: under Lighthouse's 4× CPU slowdown that was 70 to 120 ms frames and up to 360 ms of blocking time (one run scored 92). The canvas is now drawn only when what it shows changes, or while a ball or a glint moves on it (`render/redraw.ts`: `needsRedraw` compares a Scene of the backing store's size, the board area, the board by identity, the gates, the ball count, whether a nail glints, edit mode and the selection); main.ts forces a draw after `contextrestored` and on visibility changes. Tests: `tests/render/redraw.test.ts`, `tests/tools/lighthouse-score.test.ts`, `tests/tools/lighthouse-cli.test.ts`, `tests/e2e/redraw.spec.ts` (counts board draws: none while idle, every frame with a ball in play, one for a resize, edit mode, a selection and a nudge, and no ball left behind). (4) Selecting a nail from the keyboard, for accessibility and one-handed play (PR on 2026-11-03; it was open item (4) under "Next up"). The adjust panel's arrows have a third mode, Select (the S key or the Select button; N or Nudge goes back to nudging, and B still switches between nudging and bending, bending from Select). In it the arrow keys and the panel's arrow buttons move the selection to the nearest nail within 45° of that way (`game/adjust.ts` `nailToward`, pure; ties to the one nearer the line, then the lower index); the first press, with nothing selected, picks the nail nearest the middle of the board (`firstNail`). Past the last nail that way the panel says "No nail further left" and keeps the selection. Every nail on the classic board can be reached this way (a unit test walks the graph). With nothing selected the panel now says "Tap a nail, or use Select (S)". Layout: the panel no longer stretches the portrait grid. On master its contents sized the grid's columns, so at 320×568 it ran 24 px past the right edge and Import and Reset nail were cut off; `contain: inline-size` stops that. The mode and file buttons are narrower (44 px minimum, 6 px padding), so the five fit one row from 375 px wide. At 320 px the panel drops its title line and tightens its padding, so its buttons take three rows and the board is 187 px wide while editing (204 px on master, with the panel cut off). `tests/e2e/layout.spec.ts` now checks every panel control is on screen side to side as well as top to bottom, and 44 px tall. Tests: `tests/game/adjust.test.ts` (nailToward, firstNail, selectToward, classic reachability, no-nail board), `tests/input/adjust.test.ts` (S and N, keyboard-only selection, the buttons), `tests/render/adjust.test.ts` (labels and aria-pressed for Select), `tests/e2e/adjust.spec.ts` (Tab to Adjust nails, then select a start nail and nudge it by keyboard alone; the panel's arrows in Select mode on a touch screen). (5) One-handed touch play, checked as far as an emulated phone goes (PR on 2026-11-04; the last acceptance item itself waits for the maintainer, see "Open questions"). `tests/e2e/onehanded.spec.ts`, on a Pixel 7 and an iPhone SE viewport, drives the handle with real touch events from one finger (CDP `Input.dispatchTouchEvent`, which goes through the browser's gesture handling, unlike `page.mouse`): press at 12 o'clock, turn without lifting to power 0.2, hold and fire, slide off the handle over the board (still held, power unchanged), lift (firing stops); the page never scrolls, zooms or opens a menu; a cancelled touch lets go. Emulated Chromium found nothing broken. Defensive changes for real phones, which emulation can't show: the handle cancels `contextmenu` (Android browsers send it for a long press, and holding a finger still on the handle is how the game is played), and its CSS adds `-webkit-user-select: none` and `-webkit-touch-callout: none` (Safari's long-press selection and callout). `bindDial` had no unit tests; `tests/input/launcher.test.ts` now covers it (press, turn, slide off, the centre dead zone, a second finger ignored, pointercancel, the context menu, inactive, unbind).

- Next up: M8's last acceptance item, "playable one-handed on a phone", needs a person on a real phone; it is now an open question for the maintainer, with a checklist, and everything an emulated phone can check is in `tests/e2e/onehanded.spec.ts`. The layout test covers where the handle sits and that the settings and the adjust panel can be reached, and nails can now be picked with the panel's arrows instead of a precise tap. CI's lighthouse job is green on master. Once the maintainer confirms one-handed play, M8 is done and M9 (optional) is next. Nothing else is open in M8. Things to know: (1) the classic board's best power is 0.2, in CI's `BEST_POWER` and the tests' `BEST_POWER` constants; power 0 always fouls. (2) Nail indices are the same in `board.nails` and `world.circles`; the classic board's start nails (命釘) are nails[0] and nails[1], at (0.2428, 0.178) and (0.2573, 0.178). (3) `table.world` is replaced on an import (`replaceBoard`) and on a new game (`newGame`), so anything that keeps per-world state must take it from the table each time or be rebuilt: main.ts rebuilds the glints in `bindBoardFile`'s `replaced` callback and in the settings' `restarted` callback, which also rebuilds the cue tracker (it counts from the economy's tallies, which a new game zeroes); the cue tracker, the HUD, the debug overlay and the input layer already read `table.world` live. Edits live only in the page: a reload loses them unless exported. The live stats compare the board as it stands with the board the page loaded (`startBoard` in main.ts), across imports too, as the maintainer decided on 2026-10-30. (4) Edit mode's keys: E toggles it, Escape leaves it, and S, N and B make the arrows select, nudge or bend. A new key for edit mode must not reuse them (M, V, D and J are taken too). (5) Seed-dependent tests: e2e seeds 54 (a lone start entry; also `haptics.spec.ts`, `adjust.spec.ts`, `stats.spec.ts` and `boardfile.spec.ts`) and 187 (two quick start entries); `tests/game/table.test.ts` seed 3; `tests/audio/cues.test.ts` seeds 54, 3, 7, 187, 11; `tests/render/glints.test.ts` seeds 3, 5, 9; `tests/haptics/haptics.test.ts` seeds 3, 5. Physics changes can move their entries, so search for a new seed with a headless table rather than loosen a test. (6) The sound levels and timbres were set without listening, the visuals' colours and timings without a real display, and the haptic patterns without a phone; all want a human eye, ear and hand. Nobody has checked M6's frame time on a mid-range laptop with a GPU, which its acceptance names (`?inplay=30` and the debug overlay are there for it). (7) `tests/game/montecarlo.test.ts` pins two batches' tallies to the ball-step: a pure speed-up must leave them as they are; a deliberate physics or board change re-records them (and logs before and after numbers in PHYSICS.md). (8) The board moves: it is fitted round the controls (render/layout.ts), and shrinks while editing on small screens. Anything that clicks on the board must read where it is drawn (`canvas[data-board-view]`, `tests/e2e/boardview.ts`), not work it out. A new control goes inside `#ui` (style.css's grid) so the board is fitted round it. On a short landscape phone (844×390) the adjust panel is 260 px wide and scrolls if it runs out of height. With `?debug` on a phone the overlay sits over the reel; it is a tool, so it wasn't given a place in the grid. (9) `tests/e2e/play.spec.ts`'s M2 test now loads seed 1, which has no start or tulip entry for any hold from 1 to 4 s (it used to load unseeded and failed once when the payouts brought the counter back to 250); physics changes can move that, like the other seeds in (5). (10) Local e2e in the cloud sandbox: the preinstalled Chromium is a newer build than `@playwright/test` 1.56 expects, so run with a throwaway config that sets `launchOptions.executablePath: '/opt/pw-browsers/chromium'` (don't commit it; if it lives outside the repo, also set `webServer.cwd` to the repo). `playwright.config.ts` runs the frame-time test as its own project after every other test, since the sandbox is noisy under load. (11) The live stats run at the handle's power, which is 0.5 on load (4.4 spins per ¥1000 on the classic board, where moving the start nails barely shows); turn the handle to 0.2 before editing to see the board's best. The maintainer decided on 2026-10-30 to keep the handle's power. (12) The settings persist in localStorage (`pachinko.settings`), so a browser used for manual testing may start with other odds or another ball count than 250; each Playwright test gets a fresh context, so the e2e tests always start from the defaults. Main.ts reads the saved settings before making the table, so `?seed=N` games still start from the saved ball count and odds. (13) The canvas is drawn only when its Scene changes (render/redraw.ts). Anything new drawn on the canvas must either be in the Scene or force a draw while it changes, or it will be left stale on an idle board; DOM overlays (reel, HUD, flash, panels) are unaffected. Run Lighthouse locally in the cloud sandbox with `CHROME_PATH=/opt/pw-browsers/chromium npm run lighthouse`.
- Last session: 2026-11-04: [BLOCKED] on the maintainer trying one-handed play on a real phone; touch e2e for the handle on two phone viewports, bindDial unit tests, and no long-press menu or selection on the handle.
- Open questions for the maintainer:
  - **Is the game playable one-handed on your phone?** (asked 2026-11-04) M8's last acceptance item needs a person holding a real phone; no test can say it is comfortable. Everything an emulated phone can check passes (`tests/e2e/onehanded.spec.ts`, `tests/e2e/layout.spec.ts`). Please try, holding the phone in one hand and playing with that thumb, in portrait: (1) press the handle (bottom right) and turn it to about 20% without lifting, then hold it for 10 s or more: balls keep firing, and no menu, text selection, magnifier or page zoom appears; (2) slide the thumb off the handle while holding, then lift: firing stops; (3) tap Settings (bottom left) and Done, and Adjust nails, a nail, the panel's arrows and Done adjusting; (4) say which phone and browser, and whether anything was out of the thumb's reach or too small to hit. Options: (a) it plays fine, so M8 is done and M9 (optional) is next; (b) something is wrong, so say what and the next night fixes it (for example the handle on the left for a left hand, or a bigger handle). Recommendation: (a) if nothing in the list snags; if the bottom-left buttons are hard to reach with the right thumb, a left/right-hand setting is the likely fix.
- Resolved: **Which power should the live stats measure at?** (2026-10-30) The maintainer kept the handle's power, so the numbers are what the player would get; turn the handle to 0.2 to see the classic board's best. No change.
- Resolved: **After an import, what should the live stats compare against?** (2026-10-30) The maintainer chose the board the page loaded, not the imported board itself, so an edited board exported, reloaded and imported still shows its change. Only the stats baseline changed; the imported board is still where nudges and leans count from.
- Resolved: **What should "bend a nail (angle)" do?** (2026-10-26) The maintainer chose option (a), tilt about the root: bending leans the nail's head by an angle in one of four directions; the ball meets the nail about one ball radius (5.5 mm) above the backboard, so the sim nail moves 5.5 mm × tan(angle) that way (about 0.1 mm per 1°). The UI gets a "bend" mode where the arrows lean the nail in 0.5° steps and the panel shows its lean in degrees. A bent nail is stored as its position only, like a nudge, so the board schema and the sim stay as they are. Done in the 2026-10-27 PR.
- Resolved: **Tulips: what does an entry pay, and where do they go on the classic board?** (2026-10-20) The maintainer took the recommendation: pay 3 (`TULIP_PAYOUT`); two tulips, one either side of the field, level with the start pocket, in the test board's shape; and the handle remap first. Done in PR #8; numbers in PHYSICS.md's tuning log.
- Resolved: **When does a tulip close?** (2026-10-19) The maintainer chose the classic tulip: an entry into a closed tulip opens it, and the next entry closes it. No timer for now; one can be added later if it doesn't feel right. Now in "Game rules (v1)" and the M5 milestone.
- Resolved: **Where should the sweet spot sit on the handle?** (2026-10-19) The maintainer chose option (b): remap the handle as on real machines, so its range runs from a foul at the bottom to an overshoot at the top, with the sweet spot part-way up rather than at the very bottom (it was at power 0). Implemented in M5 (2026-10-20): the sweet spot is at power 0.2.
- Resolved: **M4 timings and the attacker's size: keep them?** (2026-10-19) The maintainer kept them all, to revisit with M6's game feel and M8's settings: the reel spins 5 s (`SPIN_S`); the gate stays shut 2 s before each round, including the first (`ROUND_INTERVAL_S`); the classic attacker is 90 mm wide (29% of balls at power 0); start entries during a jackpot are held (up to 4) and spin afterwards; a ball the closing lid sweeps in pays 15 but doesn't count toward any round; the J key forces a jackpot in every build. Real machines shorten spins when holds are full (保留短縮); not modelled.
- Resolved: **M5's ball–ball choices: keep them?** (2026-10-19) The maintainer kept both: ball–ball restitution 0.9 with frictionless contact (`BALL_RESTITUTION`, PHYSICS.md "Ball against ball"), and the Monte Carlo's 1000-ball batches, each its own world, so results depend on the batch size (but never on the worker count).
- Resolved: **What does a foul ball pay?** (2026-10-19) The maintainer decided it goes back to the tray, as on real machines. Now in "Game rules (v1)" and implemented in `src/game/economy.ts`.

---

## Architecture

```
/
├── index.html              # Game shell: canvas, HUD, controls
├── PLAN.md                 # This file
├── PHYSICS.md              # Parameter derivations, tuning log, assumptions
├── CLAUDE.md               # Agent working rules
├── boards/
│   └── classic.json        # Board definitions as data (nails, rails, pockets)
├── src/
│   ├── main.ts             # Boot: load board, start loop, wire input
│   ├── loop.ts             # Fixed-timestep frame loop, pause while hidden (host injected, unit-tested)
│   ├── sim/                # Pure TS physics. No DOM, no rendering, no Date/Math.random
│   │   ├── vec.ts
│   │   ├── world.ts        # Fixed-step integrator, ball lifecycle
│   │   ├── collide.ts      # Ball vs circle, ball vs segment, ball vs ball
│   │   ├── broadphase.ts   # Spatial hash over static geometry
│   │   ├── board.ts        # Board schema, loader, validation
│   │   └── rng.ts          # Seeded PRNG (e.g. xoshiro128**)
│   ├── game/               # Pure TS game rules. No DOM
│   │   ├── machine.ts      # State machine: normal, spinning, jackpot rounds
│   │   ├── lottery.ts      # Jackpot draw, hold queue (保留)
│   │   ├── economy.ts      # Ball counts, payouts
│   │   ├── tulip.ts        # Tulips: an entry opens a closed one, the next closes it
│   │   ├── adjust.ts       # M7: nail adjustment state (select by pointer or by arrow (M8), nudge 0.1 mm, bend 0.5°, reset, import); moves board and world together
│   │   ├── boardfile.ts    # M7: a board as file text (classic.json's layout) and back, through parseBoard
│   │   ├── livestats.ts    # M7: which Monte Carlo batch the live-stats worker runs next, and the tallies per board
│   │   ├── settings.ts     # M8: the player's settings (odds, starting balls, volume): choices, defaults, reading a save
│   │   └── montecarlo.ts   # Headless batch runner, shared by tools/ and M7's Web Worker
│   ├── render/             # Canvas drawing only. Reads sim/game state, never mutates it
│   │   ├── canvas.ts       # Backing store sized to CSS size × devicePixelRatio
│   │   ├── layout.ts       # M8: where the board fits, clear of the controls (pure)
│   │   ├── redraw.ts       # M8: whether the canvas needs drawing this frame (pure)
│   │   ├── debug.ts        # Debug overlay (FPS, steps/frame, frame time); fps.ts and frametime.ts hold the pure meters
│   │   ├── board.ts
│   │   ├── balls.ts        # Steel balls with a specular highlight, stamped from a sprite
│   │   ├── glints.ts       # M6: which nail each ball just struck (pure), for the glints
│   │   ├── celebration.ts  # M6: jackpot screen flash and reel celebration timing
│   │   ├── reel.ts
│   │   ├── adjust.ts       # M7: edit-mode marks on the canvas and the adjustment panel
│   │   ├── stats.ts        # M7: the live stats box (spins per ¥1000 now and as loaded)
│   │   └── hud.ts
│   ├── input/              # Launch handle (mouse, touch, keyboard), debug keys, mute and vibration toggles, nail adjustment (adjust.ts), board export/import (boardfile.ts), the settings panel (settings.ts)
│   ├── audio/              # M6: cues.ts (pure: table steps → sound cues), sound.ts (WebAudio synthesis, unlock on first interaction)
│   ├── haptics/            # M6: haptics.ts (the same cues → Vibration API patterns, after the first interaction)
│   └── stats/              # M7: worker.ts (the Web Worker: one Monte Carlo batch per message), driver.ts (posts them)
├── tools/
│   ├── montecarlo.ts       # CLI over game/montecarlo.ts: worker threads, sweep, print stats
│   └── lighthouse.ts       # M8: Lighthouse performance on the production build, median of N runs (lighthouse-score.ts: pure helpers)
└── tests/
    ├── sim/                # Vitest
    ├── game/               # Vitest
    ├── audio/              # Vitest: cues, and the player against a fake AudioContext
    ├── haptics/            # Vitest: the haptics player against a fake motor
    ├── stats/              # Vitest: the live-stats driver against a fake worker
    ├── tools/              # Vitest: tools/lighthouse's scoring and arguments
    ├── fixtures/           # Test helpers (tulips.ts: where a board's tulips are)
    └── e2e/                # Playwright smoke tests
```

### Hard boundaries

- `src/sim/` and `src/game/` must run under Node with no DOM. The Monte Carlo tool imports them directly.
- Rendering interpolates between sim states. It never advances the sim.
- All randomness flows through `sim/rng.ts` with an explicit seed. Same seed plus same inputs gives the same result.

---

## Physics model

All units SI internally (m, s, kg). Convert to pixels only in `render/`.

Anchors (document derivations in PHYSICS.md):

- Ball: steel, 11 mm diameter, about 5.5 g.
- Nails: brass, about 2 mm diameter. Pitch tuned so gaps near the start pocket are only slightly wider than a ball.
- Board: near-vertical. In-plane gravity is g·cos(tilt) with a tilt of a few degrees. Sliding friction against the backboard is a small velocity-proportional drag.
- Launch: handle angle maps to launch speed along the guide rail. Real machines cap at 100 balls/min; use that as the auto-fire rate.
- Collisions: impulse-based with normal restitution and tangential friction. Starting values: ball–nail e ≈ 0.6, ball–rail e ≈ 0.4. These are tuning knobs, not facts. Log every change in PHYSICS.md.
- Timestep: fixed at 1/2000 s or finer, with substeps if needed. A ball at max launch speed must never move more than its radius in one step. Add swept checks against nails if tests show tunneling.
- Ball–ball collisions: added in M5. Board traffic is light (a few balls in flight), so a simple spatial hash is enough.

### Invariants the tests must check

- With restitution ≤ 1 and no launch input, total mechanical energy never increases.
- No ball tunnels through a nail or rail at max launch speed (sweep the launch range).
- A ball resting in a pocket or on a ledge stays put and does not jitter or creep.
- Determinism: two runs with the same seed produce identical ball trajectories.

---

## Game rules (v1)

Simplified Japanese pachinko ("deji-pachi" style), playable without knowing the real thing:

- Start with 250 balls (the classic ¥1000 rental). The settings (M8) offer 125, 250, 500 or 1250 for a new game.
- Out-hole at the bottom: ball is lost.
- Foul: a shot too weak to leave the launch lane rolls back into the foul pocket at the bottom of the lane, and the ball goes back to the tray, as on real machines. It is not lost and pays nothing extra.
- **Start pocket (ヘソ):** pays 3 balls and triggers a reel spin. Up to 4 pending spins are held (保留) and shown as indicators. Extra entries beyond 4 pay out but don't add spins.
- **Reel:** 3-digit display. Jackpot when all three match. Probability is configurable; default 1/99 so a session actually sees one. The reel result is decided by the lottery at entry time; the animation is presentation.
- **Jackpot:** attacker gate opens for 10 rounds. Each round closes after 10 balls enter or 30 s, whichever comes first. Each ball entering pays 15.
- **Tulips (M5):** side pockets that open when a ball enters, making the next entry more likely. Classic behaviour: an entry into a closed tulip opens it, and the next entry closes it. No timer. Each entry pays 3 balls, open or closed.
- Key metric, shown in debug HUD and in Monte Carlo output: **spins per ¥1000** (start-pocket entries per 250 balls launched). Target range for the default board: 18–24.

Out of scope: real money, ads, accounts, leaderboards.

---

## Milestones

Each milestone has acceptance criteria. A milestone is done only when every criterion passes in CI.

### M0: Bootstrap

- Vite + TypeScript strict, ESLint, Prettier, Vitest, Playwright, `tsx`.
- `npm run check` runs typecheck, lint, and unit tests.
- GitHub Actions runs `check` and the Playwright smoke test on every PR.
- Cloudflare Pages config (build: `npm run build`, output: `dist`).
- `index.html` shows a full-height canvas with a fixed-timestep loop and a debug overlay (FPS, sim steps per frame).
- Loop pauses when the tab is hidden.
- PHYSICS.md and the directory layout above exist, with stubs where needed.
- **Accept:** `npm run check` passes; Playwright loads the page with no console errors; canvas is crisp at devicePixelRatio 2.

### M1: Physics core

- `vec`, `collide` (ball–circle, ball–segment), `world` with fixed step, `rng`.
- **Accept:** all invariants above have passing tests; a test scene of 1 ball dropped through a 10×10 nail grid completes deterministically.

### M2: Board and launcher

- Board JSON schema with validation (nails, rails as polylines, pockets as sensor regions).
- `boards/classic.json`: outer guide rail, launch lane, nail field, start pocket, out-hole.
- Launch handle: drag/touch dial plus keyboard (arrow keys adjust power, space holds fire). Auto-fire at 100/min while held.
- Ball counter in HUD.
- **Accept:** a ball launched at mid power clears the top rail and lands in the field; balls exit through the out-hole and are removed; Playwright test holds fire for 3 s and sees the counter drop.

### M3: Headless runner and start pocket

- `tools/montecarlo.ts --board classic --balls 100000 --power 0.62 --seed 1` prints start-pocket rate, out rate, and spins per ¥1000. Also supports a power sweep that prints a table.
- Start pocket pays 3 balls.
- **Accept:** runs 100k balls in under 60 s on CI; default board lands in the 18–24 spins/¥1000 range at its best power; the result is identical across two runs with the same seed.

### M4: Reel and jackpot

- `game/machine.ts` state machine with hold queue, lottery, and jackpot rounds. Pure and fully unit-tested.
- Reel display rendered as an LCD-style panel above the nail field.
- Attacker gate geometry in the board; it opens and closes per round.
- **Accept:** state-machine tests cover hold overflow, jackpot during held spins, and round end by count and by timeout; a forced-jackpot debug key plays a full 10-round sequence in the browser.

### M5: Tulips and ball–ball

- Tulip pockets whose open state (opened by an entry, closed by the next; see "Game rules (v1)") changes their geometry.
- Ball–ball collisions via spatial hash.
- **Accept:** Monte Carlo shows tulip entry rate increases while open; energy and determinism invariants still pass with many balls.

### M6: Game feel

- WebAudio: ball rattle (rate-limited), pocket chime, reel spin, jackpot fanfare. Mute toggle.
- Visual: specular highlight on balls, nail glints, screen flash and reel celebration on jackpot.
- Haptics on mobile where supported.
- **Accept:** no audio until first user interaction; frame time stays under 8 ms on a mid-range laptop with 30 balls in play.

### M7: Nail-adjust mode

- Toggle into edit mode: select and nudge nails (±0.1 mm steps), or bend them (angle: leans the nail about its root in 0.5° steps, moving it 5.5 mm × tan(angle); stored as position only).
- Live stats panel runs Monte Carlo in a Web Worker and updates spins per ¥1000 as you edit.
- Export/import boards as JSON.
- **Accept:** moving the two nails beside the start pocket outward measurably raises the start rate in the panel; edits round-trip through export/import.

### M8: Polish and mobile

- Responsive layout, portrait-first. Respects `prefers-reduced-motion` (no screen flash).
- Settings: jackpot probability, starting balls, sound.
- **Accept:** playable one-handed on a phone; Lighthouse performance ≥ 90.

### M9 (optional)

- 確変 (probability-change) mode after certain jackpots.
- Multiple boards with different nail layouts.
- Session stats graph (ball count over time).
