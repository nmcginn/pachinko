# CLAUDE.md

Working rules for agent sessions on this repo. Read this and PLAN.md before doing anything.

Work lands as one pull request per night, reviewed by the maintainer in the morning. The full nightly procedure is in `.claude/commands/nightly.md`: run `/nightly`. The workflow below is the short version.

## Session workflow

1. Read the **Status** section of PLAN.md and any open PRs.
2. If a previous PR is open and unmerged, don't stack new work on it. Pick work that's independent, or stop and say so in the Status section.
3. Pick the next unfinished acceptance criterion in the current milestone. Keep the session scoped to one milestone.
4. Branch from `master`: `nightly/YYYY-MM-DD-<short-slug>`.
5. Implement with tests. Commit in small, logical steps with clear messages.
6. Run `npm run check` and `npm run test:e2e`. Both must pass before opening a PR.
7. Open a PR against `master`, using `.github/pull_request_template.md`, describing what changed, what was verified, and anything skipped or uncertain.
8. Update the Status section of PLAN.md in the same PR.

## Commands

- `npm run dev`: local dev server
- `npm run build`: production build to `dist/`
- `npm run check`: typecheck, lint, and unit tests
- `npm run test:e2e`: Playwright smoke tests
- `npx tsx tools/montecarlo.ts --help`: headless simulation runner

## Guardrails

- Never push to `master`. Never merge your own PR. Never force-push a branch with an open PR.
- `src/sim/` and `src/game/` never touch the DOM, `window`, `Date`, or `Math.random`. All randomness goes through `sim/rng.ts`.
- Never change a physics constant or board geometry just to make a test pass. If tuning is needed, make the change deliberately, explain it in the PR, and log it in PHYSICS.md with the before and after Monte Carlo numbers.
- Don't weaken or delete an invariant test. If one seems wrong, open a `[BLOCKED]` PR explaining why.
- No new runtime dependencies without a one-line justification in the PR. Dev dependencies are fine.
- No game engines, physics libraries, or UI frameworks. Hand-written physics is the point.
- Don't edit `boards/classic.json` nail positions outside of a milestone that calls for it.

## When blocked

If a decision needs the maintainer (game rules, feel, ambiguous spec), don't guess. Open a PR titled `[BLOCKED] <question>` with the question, the options you see, and your recommendation. Add it to "Open questions for the maintainer" in PLAN.md. Then move to other independent work if there is any.

## Style

- TypeScript strict. No `any` without a comment explaining why.
- SI units in sim code. Name variables with units when ambiguous (`speedMps`, `radiusM`).
- UI font: Jost, with a system sans-serif fallback.
- Prefer small pure functions in `sim/` and `game/`. Rendering code can be more pragmatic.
