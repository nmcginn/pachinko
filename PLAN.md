# Pachinko

A playable browser pachinko game with a hand-written 2D physics sim in real units. Steel balls, brass nails, a start pocket that spins a digital reel, tulips, and an attacker gate that opens on a jackpot. The long-term hook is a nail-adjust mode: bend nails, watch the payout rate change.

Stack: Vite + TypeScript (strict), Canvas 2D, Vitest for unit tests, Playwright for smoke tests, `tsx` for headless tools, deployed to Cloudflare Pages. No game engine, no physics library, no UI framework.

---

## Status

Agents: update this section at the end of every session.

- Current milestone: M7, nail-adjust mode. With the 2026-10-29 PR (export/import) every M7 bullet and both halves of its acceptance are in; M7 is done once that PR is merged with CI green, and the next session should then move "Current milestone" to M8. M6 is done: its last criterion, the frame-time check, landed on master as 20fe1cc (PR #13), CI green.
- Done in this milestone: (1) Select and nudge, the first half of M7's first bullet (PR on 2026-10-26). E or the "Adjust nails" button (bottom centre) turns edit mode on and off; Escape also leaves. Play pauses while editing: main.ts doesn't step the table, the balls in play wait where they are, and the handle's keys and dial do nothing (`bindKeyboard`/`bindDial` take an `active` predicate). A click or tap selects the nearest nail within 14 CSS px (`input/adjust.ts`); the arrow keys or the panel's arrow buttons nudge it 0.1 mm (`NAIL_STEP_M`), Shift+arrow 1 mm, and "Reset nail" puts it back. `game/adjust.ts` (pure) keeps each moved nail's offset in whole steps from where the board loaded it, and places it to the nanometre, so nudging back returns it exactly. A move applies to `table.board` (now replaced on each move) and the world together, or to neither: `sim/board.ts`'s `nailMoveProblem`/`moveNail` apply the board's rules to the moved nail (on the board, clear of other nails, of rails, lids and wings, and of the launch point), and `sim/world.ts`'s `moveCircle` refuses a spot overlapping a ball in play and rebuilds the grid. The panel (`render/adjust.ts`) shows the nail, its position and offset in mm, or why a move was refused; the canvas outlines the playfield and rings moved and selected nails. The panel sits below the board in portrait and beside it in landscape. `parseBoard` now also refuses a nail cutting through a rail, lid or wing (the classic board's nails are all 10 mm or more clear). Headless check (`tests/game/adjust.test.ts`): the two start nails nudged 1 mm outward take the classic board from 21.88 to 28.88 spins per ¥1000 (2000 balls, power 0.2, seed 1). (2) Bending, the second half of the first bullet (PR on 2026-10-27), as the maintainer decided (option (a)). The panel has Nudge and Bend buttons (B switches); in bend mode the arrows lean the selected nail 0.5° (`BEND_STEP_DEG`) about its root, Shift 2.5°, and the arrow buttons are relabelled "Lean left 0.5°" and so on. `game/adjust.ts` keeps each bent nail's lean in whole steps per axis (`adjust.leans`, beside the nudges in `adjust.offsets`); a nail sits at its loaded position plus its nudges plus 5.5 mm × tan(lean) on each axis (`leanShiftM`, `BEND_HEIGHT_M` = the ball radius), to the nanometre, through the same checks as a nudge. Each axis leans at most 15° (`MAX_LEAN_STEPS`, 1.47 mm), the small-angle model's limit (PHYSICS.md "Bending a nail"). The panel says "leaning 1.5° right, 0.5° up" (and "nudged …" for nudges, which it used to call "moved"); "Reset nail" straightens and un-nudges. Headless: both start nails leant 15° outward take the classic board from 21.88 to 33.25 spins per ¥1000. (3) Live stats, M7's second bullet (PR on 2026-10-28). While editing, a Web Worker (`src/stats/worker.ts`) runs the Monte Carlo on the board as it stands and on the board as it loaded, at the handle's power and a fixed seed (`STATS_SEED` = 1), one CLI batch of 1000 balls at a time, alternating between the two, up to 20,000 balls each (`STATS_MAX_BALLS`, about 15 s of one core). `game/livestats.ts` (pure) picks each batch and keeps the tallies per board and power (up to 64, `STATS_CACHE`), so a nail nudged back shows its old numbers at once; `src/stats/driver.ts` posts one batch at a time, so an edit takes effect when the batch in flight returns (well under a second). `BATCH_BALLS` moved from tools/montecarlo.ts into game/montecarlo.ts, so the panel's tally for N balls equals the CLI's for the same board, power and seed (CLI output byte-identical to master). The stats box (`render/stats.ts`) shows spins per ¥1000 ± 1 s.e., start rate and balls for each board, and the change; it sits in the band between the reel and the board in portrait and right of the board in landscape, not in the adjust panel, so the panel stays the height it was. Play-time cost: none; the worker only runs while editing. The M7 acceptance's first half ("moving the two nails beside the start pocket outward measurably raises the start rate in the panel") is covered: headless 21.88 → 28.88 at 2000 balls each, power 0.2, and `tests/e2e/stats.spec.ts` in the browser. (4) Export/import, M7's third bullet (PR on 2026-10-29). The adjust panel's Export button saves the board as it stands (`<name>.json`, nails where they are now; a bend is its position only) and Import loads a board file in its place, through a hidden file input. `game/boardfile.ts` (pure) writes the file in boards/classic.json's own layout (`exportBoard`; the unedited classic board exports byte for byte as that file) and reads it back through `parseBoard` (`readBoard`, which also refuses non-JSON and files over 1,000,000 characters, `MAX_BOARD_FILE_CHARS`); `sim/board.ts`'s `boardData` is parseBoard's inverse, and `Launcher` now keeps `angleDeg` so the launcher exports as it loaded. `game/adjust.ts`'s `importBoard` swaps the table's board and world (`game/table.ts`'s `replaceBoard`; `Table.world` is no longer readonly), then starts the edits afresh: the imported board is the board as loaded, nothing moved or selected, and the live stats measure it against itself. Balls in play go back to the tray as if never launched (`economy.ts`'s `returnBalls`); keepInPlay's free balls just go; the tray, handle, reel and any jackpot carry on, and the next step reopens the attacker if a round is on. A bad file changes nothing and the panel says its first problem ("Can't import that board: nails[1]: … (and 2 more)"). After an export or import, the panel's selection line says what it did (`adjust.notice`) until the next action. The buttons share the Nudge/Bend row, so the portrait panel is no taller (174 px at 390×844, as before); a narrow landscape panel wraps to an extra row. The acceptance's second half ("edits round-trip through export/import") is covered headless (`tests/game/boardfile.test.ts`: an edited board exported and imported into a fresh table plays the same nails, and exports the same text) and in the browser (`tests/e2e/boardfile.spec.ts`: edit, export, reload, import, export again byte for byte, then play).
- Next up: M8 (polish and mobile), once the 2026-10-29 PR is merged with CI green. Things to know: (1) the classic board's best power is 0.2, in CI's `BEST_POWER` and the tests' `BEST_POWER` constants; power 0 always fouls. (2) Nail indices are the same in `board.nails` and `world.circles`; the classic board's start nails (命釘) are nails[0] and nails[1], at (0.2428, 0.178) and (0.2573, 0.178). (3) `table.world` is replaced on an import (`replaceBoard`), so anything that keeps per-world state must take it from the table each time or be rebuilt: main.ts rebuilds the glints in `bindBoardFile`'s `replaced` callback; the cue tracker, the HUD, the debug overlay and the input layer already read `table.world` live. Edits live only in the page: a reload loses them unless exported. The live stats compare the board as it stands with the board the page loaded (`startBoard` in main.ts), across imports too, as the maintainer decided on 2026-10-30. (4) A nail can't be selected from the keyboard alone yet; worth doing with M8's accessibility and one-handed work. (5) Seed-dependent tests: e2e seeds 54 (a lone start entry; also `haptics.spec.ts`, `adjust.spec.ts`, `stats.spec.ts` and `boardfile.spec.ts`) and 187 (two quick start entries); `tests/game/table.test.ts` seed 3; `tests/audio/cues.test.ts` seeds 54, 3, 7, 187, 11; `tests/render/glints.test.ts` seeds 3, 5, 9; `tests/haptics/haptics.test.ts` seeds 3, 5. Physics changes can move their entries, so search for a new seed with a headless table rather than loosen a test. (6) The sound levels and timbres were set without listening, the visuals' colours and timings without a real display, and the haptic patterns without a phone; all want a human eye, ear and hand. Nobody has checked M6's frame time on a mid-range laptop with a GPU, which its acceptance names (`?inplay=30` and the debug overlay are there for it). (7) `tests/game/montecarlo.test.ts` pins two batches' tallies to the ball-step: a pure speed-up must leave them as they are; a deliberate physics or board change re-records them (and logs before and after numbers in PHYSICS.md). (8) In portrait at 390×844 the adjust panel covers the attacker and out-hole below the field (the lowest nail row stays about 15 px clear); at 375×667 it covers the start pocket and the start nails too, so they can't be clicked there. Export/import didn't make it taller. In a narrow landscape window (900×700) the panel overlaps the board's left edge (the launch lane), as on master. M8's responsive layout should look at both. (9) `tests/e2e/play.spec.ts`'s M2 test now loads seed 1, which has no start or tulip entry for any hold from 1 to 4 s (it used to load unseeded and failed once when the payouts brought the counter back to 250); physics changes can move that, like the other seeds in (5). (10) Local e2e in the cloud sandbox: the preinstalled Chromium is a newer build than `@playwright/test` 1.56 expects, so run with a throwaway config that sets `launchOptions.executablePath: '/opt/pw-browsers/chromium'` (don't commit it). `playwright.config.ts` runs the frame-time test as its own project after every other test, since the sandbox is noisy under load. (11) The live stats run at the handle's power, which is 0.5 on load (4.4 spins per ¥1000 on the classic board, where moving the start nails barely shows); turn the handle to 0.2 before editing to see the board's best. The maintainer decided on 2026-10-30 to keep the handle's power.
- Last session: 2026-10-30: the maintainer's answers to the two questions left in the M7 PRs (live stats stay at the handle's power; after an import they compare against the board the page loaded), and the flaky M2 e2e test pinned to seed 1.
- Open questions for the maintainer:
  - None right now.
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
│   │   ├── adjust.ts       # M7: nail adjustment state (select, nudge 0.1 mm, bend 0.5°, reset, import); moves board and world together
│   │   ├── boardfile.ts    # M7: a board as file text (classic.json's layout) and back, through parseBoard
│   │   ├── livestats.ts    # M7: which Monte Carlo batch the live-stats worker runs next, and the tallies per board
│   │   └── montecarlo.ts   # Headless batch runner, shared by tools/ and M7's Web Worker
│   ├── render/             # Canvas drawing only. Reads sim/game state, never mutates it
│   │   ├── canvas.ts       # Backing store sized to CSS size × devicePixelRatio
│   │   ├── debug.ts        # Debug overlay (FPS, steps/frame, frame time); fps.ts and frametime.ts hold the pure meters
│   │   ├── board.ts
│   │   ├── balls.ts        # Steel balls with a specular highlight, stamped from a sprite
│   │   ├── glints.ts       # M6: which nail each ball just struck (pure), for the glints
│   │   ├── celebration.ts  # M6: jackpot screen flash and reel celebration timing
│   │   ├── reel.ts
│   │   ├── adjust.ts       # M7: edit-mode marks on the canvas and the adjustment panel
│   │   ├── stats.ts        # M7: the live stats box (spins per ¥1000 now and as loaded)
│   │   └── hud.ts
│   ├── input/              # Launch handle (mouse, touch, keyboard), debug keys, mute and vibration toggles, nail adjustment (adjust.ts), board export/import (boardfile.ts)
│   ├── audio/              # M6: cues.ts (pure: table steps → sound cues), sound.ts (WebAudio synthesis, unlock on first interaction)
│   ├── haptics/            # M6: haptics.ts (the same cues → Vibration API patterns, after the first interaction)
│   └── stats/              # M7: worker.ts (the Web Worker: one Monte Carlo batch per message), driver.ts (posts them)
├── tools/
│   └── montecarlo.ts       # CLI over game/montecarlo.ts: worker threads, sweep, print stats
└── tests/
    ├── sim/                # Vitest
    ├── game/               # Vitest
    ├── audio/              # Vitest: cues, and the player against a fake AudioContext
    ├── haptics/            # Vitest: the haptics player against a fake motor
    ├── stats/              # Vitest: the live-stats driver against a fake worker
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

- Start with 250 balls (the classic ¥1000 rental).
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
