## What changed

<!-- The change in a couple of sentences. What can a player (or the Monte Carlo tool) do now that it couldn't before? -->

## Why

<!-- The PLAN.md milestone and acceptance criterion this completes, or the issue it fixes. -->

Milestone / criterion:

## How it was verified

<!-- Tests added, and anything checked by hand. Include a screenshot for anything visible, and Monte Carlo numbers (master vs. this branch, same seed) for anything touching physics or the board. -->

- [ ] `npm run check` passes
- [ ] `npm run test:e2e` passes
- [ ] Tests cover the acceptance criterion and the awkward cases
- [ ] `src/sim/` and `src/game/` still have no DOM, `window`, `Date`, or `Math.random`
- [ ] No physics constant or board geometry changed, or the change is explained below and logged in `PHYSICS.md` with before and after numbers
- [ ] No new runtime dependencies, or each is justified below
- [ ] `PLAN.md` Status updated

## Review notes

<!-- What deserves the closest look? Anything you were unsure about, skipped, or left out on purpose? -->

<!-- Left something for a later night? One sentence each on why it's separate. If it finishes something this PR started, it isn't a follow-up. -->
