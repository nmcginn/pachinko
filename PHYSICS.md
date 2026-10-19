# Physics

Parameter derivations, assumptions, and the tuning log. PLAN.md holds the model; this file holds the reasoning and the history behind each number.

All sim units are SI (m, s, kg). Conversion to pixels happens only in `src/render/`.

## Parameters

| Parameter      | Value    | Where              | Source                                                                  |
| -------------- | -------- | ------------------ | ----------------------------------------------------------------------- |
| Sim timestep   | 1/2000 s | `src/sim/world.ts` | PLAN.md. Checked against max launch speed in M1 (see below).            |
| Max frame time | 0.1 s    | `src/main.ts`      | Frame-loop safety cap, not physics. Longer frames drop the excess time. |

Ball, nail, gravity, drag, and restitution values arrive with M1.

## Derivations

### Timestep vs. tunneling (M1)

PLAN.md requires that a ball at max launch speed never moves more than its radius (5.5 mm) in one step. At 1/2000 s that allows up to 11 m/s. M1 must confirm the max launch speed sits under that, or add substeps.

## Assumptions

- The frame loop discards wall time beyond 0.1 s per frame instead of catching up. Sim time is therefore not wall time after a stall. Nothing depends on wall time yet; if anything ever does (the 30 s jackpot round timeout in M4 should use sim time, not wall time), it should count sim steps.

## Tuning log

Record every deliberate change to a physics constant or board geometry: date, what changed, why, and Monte Carlo spins per ¥1000 before and after (same seed).

_No entries yet._
