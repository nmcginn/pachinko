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
| Max friction loss          | 2/7 of tangential speed | `MAX_FRICTION_LOSS`    | Solid sphere spinning up to rolling. See "Friction".                           |
| Max launch speed           | 5 m/s                   | `MAX_LAUNCH_SPEED_MPS` | Confirmed on `boards/classic.json` in M2. See "Max launch speed".              |
| Min launch speed (classic) | 3.2 m/s                 | `boards/classic.json`  | Power 0. Fouls start below about 3.0 m/s. See "Launch speed range".            |
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

Where shots land, at the M2 geometry: power 0 to about 0.1 peels off the outer rail near the top and drops into the top of the field, first touching a nail between x = 0.29 m (power 0, just right of the 0.25 m centre line) and 0.39 m (power 0.1). The ball holds to the curved rail while v²/R > g·sin φ, so the peel-off point moves right with speed. From about 0.15 up, the ball stays on the rail to the return bumper and drops into the field's right side. Nothing lands left of centre. That narrow band is how the speeds work out, not a choice; it is the first thing M3 will look at when tuning for 18–24 spins per ¥1000.

### Launch spread (M3)

Without variation, every shot at one power follows exactly the same path: the sim is deterministic, and nothing differs between launches. Real shots differ. The hammer spring never strikes twice alike, and balls vary slightly in mass and wear. So each launch multiplies the nominal speed by 1 + 0.01·z, with z drawn from `rng.normal()`, capped at `MAX_LAUNCH_SPEED_MPS`. The game draws from its table's seeded rng; the Monte Carlo gives every ball its own stream (see "Monte Carlo method").

The 1% is an assumption, not a measurement. It barely matters: the nail field is chaotic, so any spread large enough to decorrelate paths gives the same rates. Measured on the M2 board at power 0, 1000 balls each with a uniform spread: ±0.2% gave 9.25 spins per ¥1000, ±0.5% 10.25, ±2% 8.5, all within the ±1.5 statistical error of each other. Angle spread is not modelled; the lane fixes the direction.

`rng.normal()` is the sum of 12 uniforms minus 6: mean 0, variance 1, within 0.2% of a true normal inside ±3σ, and hard-bounded at ±6σ, so no shot is ever more than 6% off. It is built from additions only, so it is bit-for-bit the same on every JavaScript engine; Box–Muller would need `Math.log` and `Math.cos`, whose last bits are not specified. At power 1 the cap holds about half of all shots to exactly 5 m/s, so full power is slightly less varied than other powers. That only affects shots that overshoot the field anyway.

### Monte Carlo method (M3)

`src/game/montecarlo.ts` launches balls one at a time and steps each alone until a pocket takes it. With no ball–ball collisions (M5), balls in flight never interact, so this gives exactly the outcome every ball would have if fired at the auto-fire rate, and far faster. Ball i draws its launch spread from `createRng(streamSeed(seed, i))`, so its outcome depends only on the run's seed and its index. `tools/montecarlo.ts` splits a run into batches of 1000 across worker threads and sums the integer tallies, so the result is identical for any worker count (tested). Once M5 lands, balls in flight do interact, and the runner will have to fire at the auto-fire rate into a shared world instead.

A ball still in play after 30 s of sim time is counted stuck and removed. No real flight takes more than about 5 s. Stuck balls are a board defect to fix, and the CI run fails if there are any.

Speed: about 3.4 k sim steps per ball on the classic board at power 0 (1.7 s of flight), and 3–5 M ball-steps per second per thread on the dev container. 100k balls at power 0 take about 18 s on 4 workers.

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

### Pockets (sensors)

Pockets are polygons with no physical response; their walls, where they have them, are ordinary rails. A ball is captured when its centre enters one, tested against each straight piece of its path through the step (between impacts), so a fast ball can't skip a thin pocket. A pocket reached before the next impact wins over the impact. The ball is stopped at the point of entry and removed.

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

- The frame loop discards wall time beyond 0.1 s per frame instead of catching up. Sim time is therefore not wall time after a stall. Nothing depends on wall time yet; if anything ever does (the 30 s jackpot round timeout in M4 should use sim time, not wall time), it should count sim steps.
- Ball spin is not modelled. Friction's effect on spin is approximated by the 2/7 cap and by frictionless rolling contact (see "Friction"). If ball behaviour on rails looks wrong in M2, spin is the first suspect.
- A ball is never placed inside geometry: `addBall` refuses it, since nothing ever pushes a ball out of a shape.
- Collision response treats nails and rails as fixed (infinite mass). Nails don't flex.
- A launched ball appears at the bottom of the lane already at launch speed. The hammer stroke isn't modelled.
- No ball–ball collisions until M5. Two balls in the lane at once pass through each other. The Monte Carlo runner relies on this (see "Monte Carlo method").
- Launch speed varies by 1% from shot to shot; launch direction does not vary (see "Launch spread").

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
