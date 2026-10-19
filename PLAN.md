# Pachinko

A playable browser pachinko game with a hand-written 2D physics sim in real units. Steel balls, brass nails, a start pocket that spins a digital reel, tulips, and an attacker gate that opens on a jackpot. The long-term hook is a nail-adjust mode: bend nails, watch the payout rate change.

Stack: Vite + TypeScript (strict), Canvas 2D, Vitest for unit tests, Playwright for smoke tests, `tsx` for headless tools, deployed to Cloudflare Pages. No game engine, no physics library, no UI framework.

---

## Status

Agents: update this section at the end of every session.

- Current milestone: M5, tulips and ball–ball. M4 landed on master as 67ecc54 with CI green.
- Done in this milestone: ball–ball collisions (second acceptance criterion). Balls that could meet within a step are found with a per-step spatial hash and moved together, earliest event first, with swept ball–ball contacts (restitution 0.9, frictionless, inelastic below the resting threshold); a ball that meets no other ball moves bit-for-bit as before. On in board worlds, off in a bare `createWorld`. Invariant tests with 30 balls: total energy never rises (every step, no tolerance), no ball enters a nail, rail or another ball at max launch speed, a heap of six rests exactly still, same seed gives identical runs (`tests/sim/invariants.test.ts`, new blocks after the M1 ones, which are unchanged). A shot waits while a ball sits at the launch point. The Monte Carlo now fires at the auto-fire rate into a shared world (PHYSICS.md "Monte Carlo method"); spins per ¥1000 unchanged within one standard error (21.28 → 21.22 at power 0), since only 0.2–0.3% of balls ever touch another at 100 a minute.
- Next up: tulips, M5's first criterion ("Monte Carlo shows tulip entry rate increases while open"). It needs the open question on tulip rules below answered first, or a decision recorded. Things to know: (1) gates (`GateOptions` in `sim/world.ts`) switch a set of rail segments off; a tulip needs an open shape as well as a closed one, so gates will need segments that switch on as well as off. Switching geometry on must not land on a ball (the attacker's closing lid captures a ball in its mouth; a tulip's opening wings would need the same care). (2) A gate opening or closing changes the static grid's live segments, not the grid, so the broadphase is unaffected. (3) The Monte Carlo's batch is its own world with traffic either side (`TRAFFIC_BALLS`); a tulip's open state carries from ball to ball within a batch, which is what "rate while open" needs. (4) The e2e hold-lamp test now uses seed 58 (seed 8's second entry collides since M5); a seed-dependent e2e test can break whenever the physics changes, so search for a new seed with a headless table rather than changing the test.
- Last session: 2026-10-19: M5 ball–ball collisions: swept pair contacts via a spatial hash, sliding-surface fix for balls lying on balls, many-ball invariants, shared-world Monte Carlo, launches wait for the lane.
- Open questions for the maintainer:
  - **M4 timings and the attacker's size: keep them?** (2026-10-19, not blocking.) PLAN.md doesn't set these, so M4 picked values and they are one constant each: the reel spins 5 s (`SPIN_S`); the gate stays shut 2 s before each round, including the first (`ROUND_INTERVAL_S`, the fanfare); the classic attacker is 90 mm wide and takes 29% of balls at power 0, so a well-aimed round fills its 10 balls in about 21 s, and a badly aimed one (power 0.1 and up, 4–18%) times out at 30 s with about 2–9 balls. Also decided without a rule: start entries during a jackpot are held (up to 4) and spin afterwards; a ball the closing lid sweeps in pays 15 but doesn't count toward any round; the J key forces a jackpot in every build, not only a debug one. Recommendation: keep all of these for now and revisit with M6's game feel and M8's settings. Real machines shorten spins when holds are full (保留短縮); not modelled.
  - **Where should the sweet spot sit on the handle?** (2026-10-19, not blocking.) The classic board's best power is 0, the bottom of the handle: only shots just strong enough to leave the lane drop into the middle of the field. From about 0.15 up, shots ride the rim to the return bumper and mostly go down the right side, so the default handle position (0.5) gets about 4 spins per ¥1000 against 21 at power 0. Options: (a) leave it; the player finds the spot. (b) Remap the handle so its range runs from a foul at the bottom to an overshoot at the top with the sweet spot mid-way, as on real machines: lower `launcher.minSpeedMps` below the foul threshold (about 3.0 m/s) and/or lower `MAX_LAUNCH_SPEED_MPS`. (c) Change the upper field (return bumper, the nail-free channel down the right rim) so mid-power shots also feed the centre. Recommendation: (b), the smallest change and the most like the real thing; it needs a re-tune afterwards, since the best power's rate would change. It is a feel decision, so this PR doesn't make it.
  - **Tulips: what do they pay, and how long do they stay open?** (2026-10-19, blocks the tulip half of M5.) PLAN.md says a tulip opens briefly when a ball enters, making the next entry more likely, but not what an entry pays or when it closes. Options: (a) the classic tulip: an entry into a closed tulip opens it, and the next entry closes it, with no timer; (b) timed: an entry opens it for a fixed time (say 3 s), and entries while open don't extend it; (c) both: open until the next entry or a timeout, whichever first. Payout options: the start pocket's 3, or more (old machines paid 10–15 per tulip entry). Recommendation: (c) with a 3 s timeout, paying 3. The timeout keeps a tulip from staying open for the rest of a session on a board where nothing reaches it, and paying 3 keeps the economy near today's calibration, so spins per ¥1000 stays the main number. Where the tulips go on the classic board (two, either side of the field, about level with the start pocket, is what real boards do) also moves nails, which needs this milestone's licence; the next session would log it in PHYSICS.md.
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
│   │   └── montecarlo.ts   # Headless batch runner, shared by tools/ and M7's Web Worker
│   ├── render/             # Canvas drawing only. Reads sim/game state, never mutates it
│   │   ├── canvas.ts       # Backing store sized to CSS size × devicePixelRatio
│   │   ├── debug.ts        # Debug overlay (FPS, steps/frame); fps.ts holds the pure meter
│   │   ├── board.ts
│   │   ├── balls.ts
│   │   ├── reel.ts
│   │   └── hud.ts
│   ├── input/              # Launch handle (mouse, touch, keyboard)
│   └── audio/              # WebAudio, added in M6
├── tools/
│   └── montecarlo.ts       # CLI over game/montecarlo.ts: worker threads, sweep, print stats
└── tests/
    ├── sim/                # Vitest
    ├── game/               # Vitest
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
- **Tulips (M5):** side pockets that open briefly when a ball enters, making the next entry more likely.
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

- Tulip pockets with timed open state that changes their geometry.
- Ball–ball collisions via spatial hash.
- **Accept:** Monte Carlo shows tulip entry rate increases while open; energy and determinism invariants still pass with many balls.

### M6: Game feel

- WebAudio: ball rattle (rate-limited), pocket chime, reel spin, jackpot fanfare. Mute toggle.
- Visual: specular highlight on balls, nail glints, screen flash and reel celebration on jackpot.
- Haptics on mobile where supported.
- **Accept:** no audio until first user interaction; frame time stays under 8 ms on a mid-range laptop with 30 balls in play.

### M7: Nail-adjust mode

- Toggle into edit mode: select and nudge nails (±0.1 mm steps), or bend them (angle).
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
