# Physics

Parameter derivations, assumptions, and the tuning log. PLAN.md holds the model; this file holds the reasoning and the history behind each number.

All sim units are SI (m, s, kg). Conversion to pixels happens only in `src/render/`.

## Coordinates

Board plane, metres. x to the right, y up; gravity pulls toward -y. `render/` flips y when it draws.

## Parameters

| Parameter                  | Value                   | Where                  | Source                                                                         |
| -------------------------- | ----------------------- | ---------------------- | ------------------------------------------------------------------------------ |
| Sim timestep               | 1/2000 s                | `src/sim/world.ts`     | PLAN.md. Checked against max launch speed below.                               |
| Max frame time             | 0.1 s                   | `src/main.ts`          | Frame-loop safety cap, not physics. Longer frames drop the excess time.        |
| Ball radius                | 5.5 mm                  | `BALL_RADIUS_M`        | PLAN.md: 11 mm steel ball.                                                     |
| Ball mass                  | 5.5 g                   | `BALL_MASS_KG`         | PLAN.md. Only scales energy; the sim never divides by it.                      |
| Nail radius                | 1 mm                    | `NAIL_RADIUS_M`        | PLAN.md: about 2 mm brass nail.                                                |
| Gravity                    | 9.80665 m/s²            | `GRAVITY_MPS2`         | Standard gravity.                                                              |
| Board tilt                 | 3°                      | `BOARD_TILT_RAD`       | PLAN.md: "a few degrees". In-plane gravity g·cos 3° = 9.7932 m/s².             |
| Backboard drag             | 0.1 /s                  | `BACKBOARD_DRAG_PER_S` | Tuning knob. See "Backboard drag".                                             |
| Ball–nail restitution      | 0.6                     | `NAIL_MATERIAL`        | PLAN.md starting value. Tuning knob.                                           |
| Ball–nail friction         | 0.1                     | `NAIL_MATERIAL`        | Tuning knob. See "Friction".                                                   |
| Ball–rail restitution      | 0.4                     | `RAIL_MATERIAL`        | PLAN.md starting value. Tuning knob.                                           |
| Ball–rail friction         | 0.05                    | `RAIL_MATERIAL`        | Tuning knob. See "Friction".                                                   |
| Ball–ball restitution      | 0.9                     | `BALL_RESTITUTION`     | Hardened steel on steel. Tuning knob. See "Ball against ball".                 |
| Ball–ball friction         | none                    | `resolveBallContact`   | Assumption, M5. See "Ball against ball".                                       |
| Max friction loss          | 2/7 of tangential speed | `MAX_FRICTION_LOSS`    | Solid sphere spinning up to rolling. See "Friction".                           |
| Max launch speed           | 5 m/s                   | `MAX_LAUNCH_SPEED_MPS` | Confirmed on `boards/classic.json` in M2. See "Max launch speed".              |
| Min launch speed (classic) | 2.7 m/s                 | `boards/classic.json`  | Power 0, a foul (handle remap, M5). See "Launch speed range".                  |
| Launch spread              | 1% (one s.d.)           | `LAUNCH_SPEED_SPREAD`  | Assumption, M3. Results insensitive from 0.2% to 2%. See "Launch spread".      |
| Auto-fire interval         | 0.6 s (1200 steps)      | `FIRE_INTERVAL_STEPS`  | PLAN.md: 100 balls/min. Game timing, counted in sim steps.                     |
| Broadphase cell            | 20 mm                   | `GRID_CELL_M`          | Numerical. Changes speed only, never results. See "Broadphase".                |
| Contact slop               | 1 nm                    | `CONTACT_SLOP_M`       | Numerical, not physical: floating-point error after placing a ball at contact. |
| Impacts per step, per ball | 8                       | `MAX_IMPACTS_PER_STEP` | Numerical. Only a wedged ball uses them all.                                   |

## Derivations

### Timestep vs. tunneling (M1)

PLAN.md requires that a ball at max launch speed never moves more than its radius (5.5 mm) in one step. At 1/2000 s that allows up to 11 m/s. Max launch speed is 5 m/s, which moves 2.5 mm per step, so the rule holds with a 2.2× margin. A ball falling the full height of a board (about 0.6 m) reaches about 3.4 m/s, also inside it.

The rule is a backstop, not the defence. Collisions are swept (see "Collision model"), so no speed tunnels: the invariant test fires balls at 10× max launch speed at a single nail and a zero-thickness rail and none get through.

### Max launch speed

On a typical machine the ball climbs about 0.45 m up the guide rail to the top of the playfield. Reaching the top takes at least √(2·g·h) ≈ 3.0 m/s with no losses. The handle has to reach comfortably past that, so a full-power shot overshoots to the far side of the board, as on real machines. 5 m/s leaves room for rail contact and drag losses.

M2 checked it on `boards/classic.json`, where the lane climbs 0.41 m from the launch point to the top of the outer rail: a 5 m/s shot runs over the top and round to the return bumper at about 2 o'clock, the far side of the board, and lands in the field from there (`tests/sim/classic.test.ts`). No change.

### Launch speed range (M2)

The handle maps power linearly from the board's `launcher.minSpeedMps` (power 0) to `MAX_LAUNCH_SPEED_MPS` (power 1). The minimum is board data because it depends on the lane.

On the classic board a shot needs about 3.0 m/s to get past the end of the inner rail; slower ones roll back down the lane into the foul pocket. Measured by sweeping the launch speed: 2.9 m/s fouls, 3.0 m/s reaches the field. Power 0 is set at 3.2 m/s, about 7% clear, so no handle setting fouls (tested: 5% below power 0 still clears). Real handles do have a weak range that fouls. A foul goes back to the tray (PLAN.md game rules), so a weak range would cost the player nothing; it was left out because it would only be dead travel on the handle.

The handle remap (M5) changed this. The maintainer chose to map the handle as on real machines: a foul at the bottom, an overshoot at the top, and the sweet spot part-way up. Power 0 is now 2.7 m/s. Shots below about power 0.1 (2.93 m/s) always foul; at 0.1 about 4 in 10 do, with the launch spread; from 0.15 none do. The sweet spot is power 0.2 (3.16 m/s, about the old power 0's 3.2 m/s), and the top of the handle is unchanged at 5 m/s (`MAX_LAUNCH_SPEED_MPS`, which the tunnelling invariants fire at, so it stays). See the tuning log for how 2.7 was chosen and the numbers.

Where shots land, at the M2 geometry: power 0 to about 0.1 peels off the outer rail near the top and drops into the top of the field, first touching a nail between x = 0.29 m (power 0, just right of the 0.25 m centre line) and 0.39 m (power 0.1). The ball holds to the curved rail while v²/R > g·sin φ, so the peel-off point moves right with speed. From about 0.15 up, the ball stays on the rail to the return bumper and drops into the field's right side. Nothing lands left of centre. That narrow band is how the speeds work out, not a choice; it is the first thing M3 will look at when tuning for 18–24 spins per ¥1000.

### Launch spread (M3)

Without variation, every shot at one power follows exactly the same path: the sim is deterministic, and nothing differs between launches. Real shots differ. The hammer spring never strikes twice alike, and balls vary slightly in mass and wear. So each launch multiplies the nominal speed by 1 + 0.01·z, with z drawn from `rng.normal()`, capped at `MAX_LAUNCH_SPEED_MPS`. The game draws from its table's seeded rng; the Monte Carlo gives every ball its own stream (see "Monte Carlo method").

The 1% is an assumption, not a measurement. It barely matters: the nail field is chaotic, so any spread large enough to decorrelate paths gives the same rates. Measured on the M2 board at power 0, 1000 balls each with a uniform spread: ±0.2% gave 9.25 spins per ¥1000, ±0.5% 10.25, ±2% 8.5, all within the ±1.5 statistical error of each other. Angle spread is not modelled; the lane fixes the direction.

`rng.normal()` is the sum of 12 uniforms minus 6: mean 0, variance 1, within 0.2% of a true normal inside ±3σ, and hard-bounded at ±6σ, so no shot is ever more than 6% off. It is built from additions only, so it is bit-for-bit the same on every JavaScript engine; Box–Muller would need `Math.log` and `Math.cos`, whose last bits are not specified. At power 1 the cap holds about half of all shots to exactly 5 m/s, so full power is slightly less varied than other powers. That only affects shots that overshoot the field anyway.

### Monte Carlo method (M3, M5)

M3 launched balls one at a time and stepped each alone until a pocket took it. With no ball–ball collisions, balls in flight never interacted, so that gave exactly the outcome every ball would have had if fired at the auto-fire rate. M5 made balls collide, and that no longer holds, so `runBatch` in `src/game/montecarlo.ts` now fires as the game does: at the auto-fire rate (one every 0.6 s, through the same `stepFire`) into one shared world, each shot waiting if a ball still sits at the launch point. Ball i still draws its launch spread from `createRng(streamSeed(seed, i))`.

A run is cut into batches of 1000 balls, each its own world, so `tools/montecarlo.ts` can spread them over worker threads. A fresh world is empty, which would give each batch's first few balls an empty board; so each batch first fires up to 10 uncounted balls (the 10 before its first, 6 s of auto-fire, longer than any flight), and after its last counted ball it keeps firing, uncounted, until that ball is done. Every counted ball meets the traffic it would in a long session. A batch's tally depends only on its options, and the tool always cuts a run into the same batches, so the result is identical for any worker count (tested). It does depend on the batch size: a different cut is a different, equally valid, sample.

A ball still in play 30 s after its launch is counted stuck and removed. No real flight takes more than about 5 s. Stuck balls are a board defect to fix, and the CI run fails if there are any.

How much it matters: at the auto-fire rate there are about 3 balls in flight at power 0 and 2 at power 0.62, and only 0.2% (power 0) to 0.3% (power 0.62) of balls ever touch another (3000 balls each, seed 1). So the rates barely move; see the tuning log.

Speed: about 3.4 k sim steps per ball on the classic board at power 0 (1.7 s of flight). On the dev container a 1000-ball batch takes about 1.4 times as long on one thread as M3's one-at-a-time method (measured twice: 1.41 s against 1.00 s, and 2.10 s against 1.49 s on a busier machine); the shared world takes 1200 steps per ball whatever is in flight. On CI, M3's two 100k runs took 56 s together, about 1.45 times the dev container, so this method should take about 42 s per run there. 100k balls at power 0 take about 29 s on 4 workers (M3: 19 s), against CI's 60 s limit.

### Rails as polylines

Curved rails are polylines with a vertex every 2.5°. A ball riding the inside of one meets a slight corner at every vertex and takes a small impact each time, with friction. Summed over an arc, the normal impulse is m·v·Δθ either way: corners or a true curve, it is what turns the ball. So total friction loss is about μ(1 + e)·v·Δθ in both cases, and finer segments would cost speed without changing the result much. On the classic lane, μ = 0.05 and e = 0.4 take roughly 20% off the speed over the half-turn to the top. Real balls roll along the rail and lose less, which is another reason the rail friction is a tuning knob for M3.

### Collision model

Balls are points swept against inflated shapes. A nail of radius r becomes a disc of radius R + r around the nail centre, and a rail segment becomes the capsule of radius R around it. Each step:

1. Velocity gets in-plane gravity, then backboard drag.
2. The step's displacement is swept against every shape. The ball moves to the earliest time of impact, the contact impulse is applied, and the rest of the step is swept again with the new velocity.
3. A ball that needs more than 8 impacts in one step is wedged between surfaces; it stops for the rest of that step.

Because the ball is stopped at the surface rather than allowed to overlap and then pushed out, it never ends a step inside geometry, at any speed. Pushing out would also add potential energy from nowhere whenever the push had an upward component. A ball touching a surface (within the 1 nm slop) and moving into it gets an impact at t = 0; one moving along it or away does not.

### Broadphase (M2)

Each ball used to test every shape. On the classic board (217 nails, 175 rail segments) that ran at about 40k ball-steps per second on the dev container: a few balls in flight at 2000 steps/s would take most of a core in the browser. `src/sim/broadphase.ts` now indexes the static shapes in a 20 mm grid. A step only sweeps against the shapes listed in the cells its move overlaps; each shape is listed in every cell from which a ball centre could touch it (inflated bounding box, ball radius plus 1 µm).

Candidate lists are in ascending shape index, the order the brute-force pass used, and the earliest-hit search keeps the first of equal times, so results are bit-for-bit the same as testing every shape. `tests/sim/broadphase.test.ts` checks that on the classic board and the closed grid, with `broadphase: false` as the reference. Measured on the classic board: about 274k ball-steps per second, 6.8× faster.

Balls (M5) move, so they get their own hash, rebuilt every step; see "Ball against ball".

### Ball against ball (M5)

Balls collide in board worlds (`ballCollisions: true`); a bare `createWorld` keeps them off, so the M1 test scenes test exactly what they did.

The contact. Two equal masses, normal impulse only: the relative normal speed reverses and shrinks by the restitution, each ball taking half the change. Momentum is conserved and kinetic energy falls by (1 − e²)·vn²/4 per unit mass. Below the resting threshold on the approach speed (`restingSpeedMps`, as for nails and rails: 0.098 m/s at e = 0.9) the contact is perfectly inelastic, so a ball lying on another one sits still instead of bouncing every step. e = 0.9 is a textbook figure for hardened steel balls at these speeds (about 1 m/s); real balls lose a little more to wear and dirt, so it is a tuning knob. The contact is frictionless: with no spin state, friction between two spinning-free balls would have to invent where the spin goes, and over the short contact between two rolling balls it is small. A frictionless pair can slide past each other freely, which the nails then randomise anyway.

Moving them together. The step can't move balls one after another any more: a ball that has already moved could be hit by one that moves later, at a place it no longer is. So, at the start of each step, after gravity and drag:

1. Find every pair of balls that could meet. Contacts never add kinetic energy and nothing else speeds a ball up mid-step, so no ball can move faster during the step than the root-sum-square of every ball's speed, v̂. Two balls further apart than 2R + 2·v̂·dt can't meet. Pairs within that are found with a spatial hash of the ball centres (cells that wide, so a pair always shares or neighbours a cell); under 8 balls, testing every pair's distance is cheaper and gives the same pairs.
2. Balls in no pair move alone, exactly as before M5.
3. Balls in pairs move together, earliest event first. Each ball keeps its position at its own time, the time of its last event, and every event is either one ball meeting a nail, rail or pocket (found and resolved with exactly the same arithmetic as when it moves alone) or two balls meeting: one centre swept against a disc of radius 2R around the other, in the frame moving with it. The earliest event is applied, the events of the balls it changed are found again, and so on until the step is used up. Ties go to the lowest ball index, and nail, rail and pocket events before ball contacts. A ball still counts at most 8 impacts per step; out of impacts, it is wedged and held still for the rest of the step, as before.

So a ball that meets no other ball takes the same path, to the bit, as with ball collisions off (tested, including near misses inside the reach). And the hash only decides who moves together, never what happens: results with it are identical to testing every pair (tested on 40 balls).

One numerical catch. After a resting contact two balls move on as one, and rounding can leave them closing at about 10⁻²⁰ m/s. The sweep sees an approach, the impulse can't remove it, and the pair would burn all 8 impacts and stop dead every step: a train of balls rolling down the out-hole floor froze into a heap on the first version. A touching pair whose approach stays within the contact slop (1 nm) for the rest of the step is therefore not an impact. It can't creep inside that slop: the check is on where the step would end.

The second catch was worse. A ball lying on a ball that lies on a rail has two contacts that fight: the rail stops the lower ball sinking, the upper ball pushes it back down, and resolved one at a time each undoes part of the other. That converges, but not within 8 impacts, so both balls ran out every step and were held still: a ball landing on another on the 15° out-hole floor stopped both for good, and every later ball piled up behind them (about 0.3% of balls counted stuck in a 100k run). So a ball whose last contact with a nail or rail this step was a resting one, and which is still touching it, is treated as sliding along it: if a ball contact pushes it into that surface, it moves only along the surface and the surface takes the rest, in the same impulse (`resolveBallContact`'s surface normals). One event then does what the alternation could not. A ball wedged against two surfaces at once still falls back to the 8-impact limit; that is a ball meant to stop anyway.

The energy guard (see "Contacts never add energy") compared each ball with itself. A collision hands energy from one ball to another, so with balls touching it applies to each group of balls joined by contacts this step, as a whole: if the group's energy rose, the excess comes out of the group's kinetic energy; if that can't cover it, the group goes back to where it started the step, at rest. A ball that touched no other ball is a group of one and is guarded exactly as before. A ball sent back must not land on one that has since moved into the space it left (one that never touched it, or they'd be one group), so that ball's group goes back too, until nothing overlaps; balls outside the moving set started too far away to reach. A ball a pocket takes counts in its group's energy at the moment it was taken.

Measured with 30 balls launched at up to max launch speed into the closed 10×10 grid, three sets of materials, 3 s each: total energy never rose on any step, and the deepest any two balls came into each other was 2×10⁻¹⁰ m, inside the 1 nm contact slop (both now invariant tests). A heap of six balls in a V settles and then stays exactly still.

Launching. A ball can't appear on top of another, so a shot due while a ball sits at the launch point waits until it has gone (`stepFire`'s `laneClear`), as a real ball feed does. On the classic board this never happens in play: even a shot that fouls is past the launch point well within the 0.6 s between shots.

### Pockets (sensors)

Pockets are polygons with no physical response; their walls, where they have them, are ordinary rails. A ball is captured when its centre enters one, tested against each straight piece of its path through the step (between impacts), so a fast ball can't skip a thin pocket. A pocket reached before the next impact wins over the impact. The ball is stopped at the point of entry and removed.

### Gates: the attacker's lid (M4)

The attacker is a pocket whose mouth a lid closes over. The lid is a polyline of ordinary rail segments (rail material) that the world can switch off: while the gate is open, the step skips those segments, so balls fall through into the pocket; while it is closed, they are rails like any other. The broadphase indexes them either way, and skipping is a per-segment flag, so results stay identical with and without it (tested). Opening and closing are input to the sim, like a launch: only `setGateOpen` does it, and the game calls it on the step a round opens or ends.

Closing can't push a ball out of the way: nothing in the sim ever pushes a ball out of geometry (see "Collision model"). A ball the closing lid would overlap is one already in the mouth, falling in, so it is taken by the pocket, as if it had dropped in a moment sooner. The game pays it like any attacker entry but doesn't count it toward the round (an over-entry, オーバー入賞, which real machines pay too). A ball resting on the closed lid, or touching it within the contact slop, is not in the mouth and stays put.

The closed lid on the classic board is a shallow roof, 6 mm high over its 90 mm span (about 7.6°), not a flat plate: a flat lid is a ledge a ball can come to rest on for ever (the sim rests a ball exactly on a flat surface; see "Friction"), and every ball stranded there would count as stuck. On the roof, gravity along the slope is about 1.3 m/s², so a ball always rolls off. A ball dropped exactly on the apex with no sideways speed would balance there, the same knife-edge as the nail crest under the start cup (M3 tuning); the Monte Carlo found none in 410 000 balls with the lid shut (the 21-power sweep and the two 100k runs in the tuning log), and CI fails on any stuck ball.

### Gates: tulips (M5)

A tulip (チューリップ) is a pocket with wings. Its wings are a gate too, with two shapes: one polyline set solid while it is closed and another solid while it is open, each skipped in the other state. The game opens a closed tulip on an entry and closes an open one on the next (PLAN.md game rules), on the step the ball is taken, by `setGateOpen` as for the attacker.

Switching a shape on can land on a ball, which the attacker's lid only did when closing. The same rule covers both: a ball a newly solid segment overlaps is taken by the pocket, never pushed out (nothing in the sim pushes a ball out of geometry). For a tulip that means a ball beside the hinge as the wings swing open, or between the closed wing tips as they swing shut, both a ball the moving wing would have scooped or knocked in. A taken ball is an entry like any other, so it toggles the tulip again (and could, in principle, sweep in another; each pass removes a ball, so it ends). Switching never adds energy: geometry appears or disappears, no ball moves, and a taken ball leaves (invariant tests: 30 balls round a tulip switched every 20 ms, energy never rises, no ball is ever left inside a wing, a nail, a rail or another ball, same seed same run).

The launch point must be clear of every gate in both states (`parseBoard`), since opening a tulip adds geometry.

The classic board has two (M5; see the tuning log), as real boards do: one either side of the field, about level with the start pocket, mirror images about the centre line. Each sits at x = 0.15 m or 0.35 m, its mouth (the top of its cup, where the wings are hinged) at y = 0.17 m, 2 mm above the start cup's rim. Its cup is the start cup's, 17 mm inside and 18 mm deep, with a sensor inside below the rim. Closed, the wing tips lean in to a 12.5 mm gap (the ヘソ nails' gap) 12 mm above the hinges; open, they splay out to tips 38 mm apart, 10.5 mm up (about 45°). Six nails round each were taken out to make room. Each pays 3 balls (`TULIP_PAYOUT`, the maintainer's choice).

Measured with `tools/montecarlo.ts --board classic --balls 20000 --power 0.2 --seed 1`, each tulip:

| `--tulips`      | Left: entries | Left: open / closed | Right: entries | Right: open / closed | Open, share of time (L / R) | Spins per ¥1000 |
| --------------- | ------------- | ------------------- | -------------- | -------------------- | --------------------------- | --------------- |
| `play`          | 2.45% (490)   | 9.94% / 1.40%       | 2.47% (494)    | 11.10% / 1.39%       | 12.3% / 11.1%               | 22.59 ± 0.51    |
| `open` (held)   | 10.56% (2112) | 10.56% / —          | 10.57% (2114)  | 10.57% / —           | 100%                        | 22.59 ± 0.51    |
| `closed` (held) | 1.42% (283)   | — / 1.42%           | 1.39% (277)    | — / 1.39%            | 0%                          | 22.59 ± 0.51    |

Open, a tulip takes about 7.5 times as many balls as closed. The tulips sit beside the start pocket's approach, not on it, so its entries are identical in all three runs. In play each is open about an eighth of the time, and both together take about 4.9% of balls, paying back about 0.15 balls per ball launched (the start pocket: about 0.27). The power sweep in the tuning log left no ball stuck at any power.

How the Monte Carlo measures "while open" in play: each entry is filed under the tulip's state at that moment, and each step's counted balls in play add to that state's ball-time. The rate in a state is entries per ball-step in that state, times the mean ball-steps per launched ball: the share of launched balls it would take if it stayed in that state. It is a hazard-rate estimate, and it can read low for a state whose spells are short against a flight: just after the tulip opens, many balls in play are already below it or not yet near it, so an open spell's first second or two takes few entries. (On a one-tulip test board at the old best power it read 7.6% against 9.0% held open; on the classic board at power 0.2, 9.9–11.1% against 10.6%.) Holding the tulip open or closed for a whole run (`--tulips open|closed`) measures each shape without that, and is the cleaner comparison of the shapes; the in-play figures are what a player sees.

### Energy and the resting threshold

The step is semi-implicit Euler: v' = v − g·dt, then y' = y + v'·dt. In free flight this loses exactly ½g²dt² per unit mass each step, so with drag on top, energy strictly decreases (checked by test).

An impact part-way through the step, at fraction s, changes the path for the remaining (1 − s)·dt, and with it the work gravity does over the step. For a ball approaching a floor at speed w with restitution e, the energy change over the step is

ΔE = −½g²dt² − ½(1 − e²)·w² + g·dt·(1 − s)·(1 + e)·w (per unit mass)

The last term is the extra height the bounce buys during the rest of the step. When w ≥ 2·g·dt / (1 − e), the bounce's loss covers it and ΔE ≤ 0. Below that, a bounce can gain energy, and repeated every step it is exactly the jitter of a ball "resting" on a ledge. So below that speed the impact is perfectly inelastic: e = 0. With e = 0 the bracket peaks at ½g²dt²(1 − s)² ≤ ½g²dt², so ΔE ≤ 0 there too. That threshold is `restingSpeedMps`: 0.016 m/s for rails (e = 0.4), 0.024 m/s for nails (e = 0.6) at the default timestep.

e = 1 is rejected by validation: the threshold goes to infinity, and a perfectly elastic bounce under discrete gravity always gains a little energy. Real steel on brass is nowhere near 1.

### Contacts never add energy: the guard

The derivation above covers one contact against one flat surface. Two contacts in one step don't fit it. A ball wedged in a V pocket can have a small downward drift turned by one side's impulse into a climb up the other side, and gravity's work over that redirected path comes out slightly positive. Measured on an earlier version of this branch without the guard: up to 2×10⁻⁸ J gained in a step, and the ball never settled (it rocked at a few mm/s).

Contacts physically only dissipate energy, so the gain is integration error, not physics. On any step where the ball touched something, `stepWorld` compares the ball's energy with the start of the step. If it rose, the excess comes out of kinetic energy (velocity scaled down). If kinetic energy can't cover it, the ball was all but resting, and it is put back where the step began, at rest.

How often it acts, measured over 2.4 million ball-steps in a closed 10×10 grid with balls launched at up to max speed and left to settle in a V floor:

- It never touches a ball in flight. In 200 single-ball drops through the open grid it did not fire once.
- About 40% of ball-steps in the closed scene trigger it, almost all of them balls already lying in the V floor, which it holds still. Under 0.1% of firings scale a moving ball down, all below 12 mm/s, removing at most 1×10⁻⁵ J/kg.

That is the cost: the very last millimetres per second of a ball settling are damped a little harder than restitution alone would. The energy invariant test checks every ball on every step with no tolerance.

### Friction

There is no spin state; the ball is a point. Friction is applied only on impacts (approach speed at or above the resting threshold): Coulomb, removing up to μ × normal impulse of tangential speed. It is capped at 2/7 of the tangential speed: a solid sphere (I = 2/5·mR²) with no spin, gripped by the surface, spins up until it rolls at 5/7 of its sliding speed and then feels no more sliding friction.

Resting contacts (slower approach) get no friction. A ball in resting contact is rolling along the surface, and a rolling ball feels only rolling resistance, which for steel on steel or brass is tiny and folded into the backboard drag. The first version applied Coulomb friction to resting contacts too, and balls perched on the crest of a nail, held 1° off-centre by friction they would not have, and would have stalled on any rail flatter than about 3°. A ball on a perfectly flat ledge still rests exactly, because there is nothing to roll it.

The friction coefficients are effective values for an impact, not handbook sliding coefficients (steel on brass is about 0.3 sliding): an impact on a ball that already spins with the motion loses less. They are tuning knobs for M3.

### Backboard drag

The ball rolls on the backboard under the normal component of gravity, g·sin 3° ≈ 0.51 m/s². PLAN.md models this as a small velocity-proportional drag, dv/dt = −k·v, integrated implicitly (v ← v / (1 + k·dt)) so it can never overshoot. k = 0.1 /s takes 1% off a ball's speed in 0.1 s, the time a ball spends crossing a nail field: noticeable over a long roll, negligible within one bounce. It is a tuning knob for M3.

## Assumptions

- The frame loop discards wall time beyond 0.1 s per frame instead of catching up. Sim time is therefore not wall time after a stall. Nothing depends on wall time: the reel's spin, the jackpot rounds' 30 s timeout, and the pause between rounds (M4) all count sim steps (`src/game/machine.ts`), so a stall pauses them along with the balls.
- Ball spin is not modelled. Friction's effect on spin is approximated by the 2/7 cap and by frictionless rolling contact (see "Friction"). If ball behaviour on rails looks wrong in M2, spin is the first suspect.
- A ball is never placed inside geometry: `addBall` refuses it, since nothing ever pushes a ball out of a shape.
- Collision response treats nails and rails as fixed (infinite mass). Nails don't flex.
- A launched ball appears at the bottom of the lane already at launch speed. The hammer stroke isn't modelled.
- Ball–ball contacts are frictionless, and balls have no spin (see "Ball against ball").
- Launch speed varies by 1% from shot to shot; launch direction does not vary (see "Launch spread").
- Where real handles foul is a range, not one speed; here a shot fouls if it is too slow to get past the end of the inner rail (about 2.93 m/s on the classic board), and the 1% launch spread blurs the edge.
- A tulip's wings switch shape instantly, in one step; their swing isn't modelled, so a ball can't be batted by a moving wing (see "Gates: tulips").

## Tuning log

Record every deliberate change to a physics constant or board geometry: date, what changed, why, and Monte Carlo spins per ¥1000 before and after (same seed).

### 2026-10-19: initial values (M1)

First values for every constant in the table above, set with M1. Not a change, so there are no before and after numbers; the Monte Carlo tool arrives in M3, and M3's tuning starts from these.

### 2026-10-19: classic board and launch range (M2)

New, not changed: `boards/classic.json` (generated once by `tools/gen-classic-board.ts`, which documents the design parameters) and its `launcher.minSpeedMps` of 3.2 m/s. `MAX_LAUNCH_SPEED_MPS` was checked against the board and stays at 5 m/s. No physics constant changed. No Monte Carlo numbers yet: the tool arrives in M3, which tunes from here.

### 2026-10-19: launch spread and M3 tuning of the start pocket's nails (M3)

New constant, not a change: `LAUNCH_SPEED_SPREAD` = 1% (see "Launch spread"). The "before" numbers below already include it; without it, a Monte Carlo would just repeat one path.

Six nails in `boards/classic.json` changed. No physics constant changed, the start pocket (cup, sensor, and the 12.5 mm gap between the two ヘソ nails) is untouched, and no other geometry moved.

| Nail                          | Before                         | After                            | Why                                                                                                                     |
| ----------------------------- | ------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 寄り釘 (guide nails), added   | none                           | (0.2305, 0.186), (0.2695, 0.186) | Turn balls falling beside the ヘソ in toward its gap.                                                                   |
| Row y = 0.198 beside the ヘソ | (0.236, 0.198), (0.264, 0.198) | (0.2265, 0.2), (0.2735, 0.2)     | Moved out 9.5 mm and up 2 mm to keep a ball's width clear of the new guide nails.                                       |
| Row y = 0.122 under the cup   | (0.236, 0.122), (0.264, 0.122) | (0.235, 0.122), (0.265, 0.122)   | Moved out 1 mm. A ball sliding down the cup's outer wall landed dead centre on them and balanced there forever (below). |

Why there. On the M2 board the start pocket caught 3% of balls at its best power (7.85 spins per ¥1000, against the 18–24 target). Widening the ヘソ gap alone was weak: 15.5 mm, 3 mm wider, only reached about 12. The limit was supply, not the gap: balls came down beside the ヘソ through the open area around it and fell past. Real boards put 寄り釘 there, so that is what this adds: one on each side, just outside and above each ヘソ nail. Tight funnels (nails closer than a ball's width) reached the target too, but wedged balls between nails by the hundred, so every gap here is at least 12.5 mm: nothing new can trap a ball. The guide nails' position is sensitive, as on real machines: at the same height, x = 0.230 gives 19.7 spins, 0.2305 gives 21.4, and 0.231 gives 22.6 (24k balls each at power 0, about ±0.45). 0.2305 sits mid-range.

The stuck ball. The M2 board kept about 1 ball in 10 000 in play forever. A ball sliding down the outside of a start-cup wall (vertical, so vx is exactly 0) fell straight onto the nail below, whose centre was exactly one ball radius out from the wall, at x = 0.264. It landed exactly on the crest and stayed balanced, an equilibrium only exact arithmetic can hold. Moving those nails 1 mm puts the landing 1 mm off the crest, so the ball rolls off. The sim is not at fault, but the same coincidence could recur under any vertical rail; the CI Monte Carlo run fails on any stuck ball, so it would show.

Monte Carlo, `--balls 10000 --sweep 0:1:0.05 --seed 1`, spins per ¥1000:

| Power                      | Before (M2) | After  |
| -------------------------- | ----------- | ------ |
| 0                          | 7.85        | 21.60  |
| 0.05                       | 7.83        | 18.85  |
| 0.10                       | 3.82        | 8.70   |
| 0.20                       | 2.73        | 5.80   |
| 0.50                       | 1.88        | 3.80   |
| 0.62                       | 1.12 ¹      | 2.33 ¹ |
| 1                          | 0.33        | 0.78   |
| stuck balls, all 21 powers | 9           | 0      |

¹ From `--balls 100000 --power 0.62 --seed 1`.

At the best power, `--board classic --balls 100000 --power 0 --seed 1`: 21.28 ± 0.22 spins per ¥1000 (8.51% start, 91.49% out, no fouls, none stuck). Before (M2 geometry, same command): 7.85 ± 0.44 at 10k balls. The best power is 0, the bottom of the handle; see "Launch speed range" for why only the weakest shots play the middle of the field, and PLAN.md's open questions.

### 2026-10-19: the attacker (M4)

New geometry, no physics constant changed and no nail moved: M4 asks for an attacker gate in the board. `boards/classic.json` gains the `attacker-box` rail (an open-topped box 90 mm wide and 15 mm deep, x 0.205–0.295 m, top at y = 0.1 m, centred under the start cup above the out-hole) and the `attacker` pocket inside it, with a roof-shaped lid (apex 6 mm above the box top) that is closed except during a jackpot round. See "Gates: the attacker's lid".

Why there and that wide. Real attackers sit low and central, under the start pocket. Here that is the only open space under the field: between the lowest nail row (y = 0.122 m) and the floor. A ball's width is clear between the box and every nail (tested). The width sets how fast a round fills: at the auto-fire rate (100 a minute) a round of 10 balls fills before its 30 s timeout only if the attacker takes more than about 1 ball in 5. Measured with the gate held open, at power 0, 10k balls, seed 1: a 56 mm box took 16.3%, 76 mm 26.1%, 90 mm 29.0%. At 90 mm a round at power 0 fills in about 21 s, so rounds end by count when aimed well and by timeout otherwise (power 0.1 and up take 4–18%). It is as wide as the space allows without moving nails. How generous a jackpot should be is a balance question for the maintainer (PLAN.md open questions).

Monte Carlo, gate closed (normal play), same seed: identical to the ball. The attacker sits below the start pocket, so no ball that reaches it can come back up to the start pocket; only flight times change.

| `--balls 100000 --seed 1`        | Before (master)            | After                      |
| -------------------------------- | -------------------------- | -------------------------- |
| `--power 0.62`                   | 2.33 ± 0.08 (933 starts)   | 2.33 ± 0.08 (933 starts)   |
| `--power 0` (best)               | 21.28 ± 0.22 (8514 starts) | 21.28 ± 0.22 (8514 starts) |
| stuck, `--sweep 0:1:0.05` at 10k | 0                          | 0                          |

With the gate held open (`--open`, new in M4), `--balls 100000 --power 0 --seed 1`: 8.51% start, 28.78% attacker, 62.71% out. 10k-ball sweep, gate open, seed 1:

| Power    | 0     | 0.1   | 0.2   | 0.3   | 0.4   | 0.5   | 0.6  | 0.7   | 0.8   | 0.9   | 1    |
| -------- | ----- | ----- | ----- | ----- | ----- | ----- | ---- | ----- | ----- | ----- | ---- |
| Attacker | 29.0% | 17.6% | 14.0% | 10.2% | 11.2% | 10.3% | 8.7% | 11.7% | 11.3% | 11.5% | 4.4% |

### 2026-10-19: ball–ball collisions (M5)

New, not changed: `BALL_RESTITUTION` = 0.9 and frictionless ball–ball contact (see "Ball against ball"). No existing constant and no board geometry changed. Board worlds now have ball collisions on, and the Monte Carlo fires balls at the auto-fire rate into a shared world instead of one at a time (see "Monte Carlo method"), so "after" is the new method and "before" the old one, same seed.

| `--balls 100000 --seed 1`                  | Before (master)            | After                      |
| ------------------------------------------ | -------------------------- | -------------------------- |
| `--power 0.62`                             | 2.33 ± 0.08 (933 starts)   | 2.35 ± 0.08 (940 starts)   |
| `--power 0` (best)                         | 21.28 ± 0.22 (8514 starts) | 21.22 ± 0.22 (8486 starts) |
| `--power 0 --open`, attacker               | 28.78%                     | 28.77%                     |
| stuck, `--sweep 0:1:0.05` at 10k per power | 0                          | 0                          |
| best power in that sweep                   | 0                          | 0                          |
| 100k at power 0, 4 workers, wall time      | 19 s                       | 29 s                       |

Every change is within one standard error, as expected with 0.2–0.3% of balls ever touching another. The first version of the contact jammed balls on the out-hole floor (310 stuck at power 0.62, 232 at power 0); see "Ball against ball" for the fix. The numbers above are after it.

### 2026-10-20: two tulips and the handle remap (M5)

Two deliberate changes, both decided by the maintainer: tulips on the classic board (pay 3, two placed as real boards place them, the shape measured on a test board) and the handle remap, done first so the tulips are tuned at the power players will use. No physics constant changed; `MAX_LAUNCH_SPEED_MPS` stays 5 m/s.

Board geometry changed in `boards/classic.json`:

| Change                                  | Before  | After                                                                                                                      |
| --------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `launcher.minSpeedMps` (power 0)        | 3.2 m/s | 2.7 m/s                                                                                                                    |
| Tulips `tulip-left`, `tulip-right`      | none    | Cups (rails `tulip-left-cup`, `tulip-right-cup`) at x = 0.15 and 0.35 m, mouths at y = 0.17 m, wings as in "Gates: tulips" |
| Nails removed round the left tulip (6)  | present | (0.138, 0.179), (0.166, 0.179), (0.124, 0.16), (0.152, 0.16), (0.138, 0.141), (0.166, 0.141)                               |
| Nails removed round the right tulip (6) | present | (0.362, 0.179), (0.334, 0.179), (0.376, 0.16), (0.348, 0.16), (0.362, 0.141), (0.334, 0.141), the mirror images            |

Choosing 2.7 m/s. Start rate against launch speed, with the tulips in, at power 0 on copies of the board with `minSpeedMps` set to each speed (3000 balls each, seed 1, ±1.2 spins):

| Speed (m/s)     | 2.90 | 2.95 | 3.00 | 3.05  | 3.10  | 3.15  | 3.20  | 3.25  | 3.30  | 3.40 |
| --------------- | ---- | ---- | ---- | ----- | ----- | ----- | ----- | ----- | ----- | ---- |
| Spins per ¥1000 | 3.83 | 13.0 | 19.1 | 20.42 | 20.92 | 22.33 | 19.92 | 19.75 | 18.17 | 6.50 |
| Fouls           | 79%  | 21%  | 0.4% | 0     | 0     | 0     | 0     | 0     | 0     | 0    |

The sweet spot is a plateau from about 3.05 to 3.30 m/s. Power 0.2 sits on both the arrow keys' 0.02 grid and the CI sweep's 0.05 grid, so 2.7 m/s puts power 0.2 at 3.16 m/s, mid-plateau. The arrow keys now step exactly on that grid (`stepPower` in `src/input/launcher.ts`), so a power set by keys gives the same shots as the same power in a test.

Monte Carlo, `--board classic --seed 1`:

| Run                                        | Before (master)        | Tulips only (old handle) | After (tulips and remap) |
| ------------------------------------------ | ---------------------- | ------------------------ | ------------------------ |
| `--balls 100000` at the best power         | 21.21 ± 0.22 (power 0) | 21.21 ± 0.22 (power 0)   | 22.29 ± 0.23 (power 0.2) |
| start entries in that run                  | 8486                   | 8486                     | 8914                     |
| tulip entries in that run, left / right    | —                      | 2.09% / 2.81%            | 2.56% / 2.44%            |
| `--balls 100000 --power 0.62`              | 2.35 ± 0.08            | —                        | 3.94 ± 0.10              |
| `--balls 10000 --open` at the best power   | 28.77% attacker (100k) | —                        | 27.75% attacker          |
| stuck, `--sweep 0:1:0.05` at 10k per power | 0                      | —                        | 0                        |
| best power in that sweep                   | 0                      | —                        | 0.2 (22.38)              |

Adding the tulips moved no start-pocket entry at all (8486 either way): they sit beside its approach. The remap moved the best power up the handle and, by landing mid-plateau rather than at its 3.2 m/s edge, raised spins a little, still inside the 18–24 target. Power 0.62 is now a different speed (4.13 m/s rather than 4.32), hence its change. The sweep, power by power (spins per ¥1000; foul and tulip shares of balls):

| Power  | 0    | 0.05 | 0.10  | 0.15  | 0.20  | 0.25  | 0.30 | 0.40 | 0.50 | 0.60 | 0.80 | 1.00 |
| ------ | ---- | ---- | ----- | ----- | ----- | ----- | ---- | ---- | ---- | ---- | ---- | ---- |
| Spins  | 0    | 0    | 7.83  | 20.42 | 22.38 | 19.22 | 8.00 | 5.77 | 4.15 | 3.95 | 2.93 | 0.78 |
| Fouls  | 100% | 100% | 43.0% | 0     | 0     | 0     | 0    | 0    | 0    | 0    | 0    | 0    |
| Tulips | 0    | 0    | 2.66% | 4.21% | 5.23% | 4.56% | 4.8% | 4.2% | 3.7% | 3.9% | 4.3% | 2.1% |
