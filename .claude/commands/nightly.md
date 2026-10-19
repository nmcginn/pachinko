---
description: Pick the next milestone criterion from PLAN.md and land it as one reviewable pull request
---

You are doing tonight's increment of work on Pachinko. Nobody is watching this
session: the reviewer looks at the result in the morning, so the deliverable is
**one pull request they can review over coffee**, plus an up-to-date Status
section in `PLAN.md` so the next night can pick up where you stopped.

Read `CLAUDE.md` and `PLAN.md` in full first. `CLAUDE.md` holds the guardrails;
`PLAN.md` holds the architecture, physics model, game rules, and milestones.
Where this file and `CLAUDE.md` disagree, `CLAUDE.md` wins.

Nobody will answer a question tonight. Don't stop and ask; if a decision is
the maintainer's to make, follow "When blocked" below and move on.

## 1. Get your bearings

1. Read the **Status** section of `PLAN.md`: the current milestone, what is
   already done in it, what the last session left, and the open questions.
2. Check open pull requests on the repository.
   - A previous nightly PR that's still open and unmerged: **don't stack on
     it.** If it has review comments, addressing them on that PR is tonight's
     work. Otherwise pick work that doesn't depend on it or touch the same
     files. If nothing independent is left, record that in Status and stop.
   - A `[BLOCKED]` PR with an answer from the maintainer: act on the answer, then
     close out the question in "Open questions for the maintainer".
3. Glance at recent history on `master` (`git log --oneline -20`) so you know
   what landed since the Status section was written.

## 2. Choose the task

Take the **next unfinished acceptance criterion in the current milestone**, and
keep the session to that one milestone. A milestone is done only when every
criterion passes in CI. When that happens, advance "Current milestone" in
Status.

Size by completeness, not by line count. The question is "is this finished?"
first and only then "is this small?". Tests here will often be longer than the
code they cover, and that's never a reason to split. If several criteria in the
milestone belong to one thought (for example `vec`, `collide`, and the
invariant tests that exercise them), land them together.

If the next criterion is really too big for one night, take the smallest
**complete** slice: one that works end to end and is tested, not a staging
post. Record what's left in Status. Slice at a seam (another module, another
milestone criterion, a decision that's the maintainer's), never through the middle of
one behaviour.

The failure mode to watch for is taking *too little*, not too much.

### Before M0 has landed

The repository starts with only `CLAUDE.md`, `PLAN.md`, and this command.
`npm run check`, `npm run test:e2e`, and CI don't exist until M0 creates them.
The session that does M0 is responsible for making those commands exist and
pass, and the rest of this procedure applies as written from then on.

## 3. Build it

```sh
git fetch origin master
git checkout -b nightly/$(date +%Y-%m-%d)-<short-slug> origin/master
```

If this session's own instructions assign a different branch, use that one.

Work to the criterion's acceptance criteria. Commit in small, logical steps.
These come from `CLAUDE.md` and PLAN.md and are not negotiable:

- **Tests come with the change.** They cover the acceptance criterion plus the
  awkward cases: zero balls, a ball at max launch speed, a ball at rest, an
  empty or invalid board, the same seed run twice.
- **`src/sim/` and `src/game/` stay pure.** No DOM, `window`, `Date`, or
  `Math.random`. Randomness goes through `sim/rng.ts` with an explicit seed.
- **Rendering reads sim state and never advances it.**
- **SI units in sim code**, with units in names where ambiguous (`speedMps`).
- **Never change a physics constant or board geometry to make a test pass.**
  Deliberate tuning is fine: explain it in the PR and log it in `PHYSICS.md`
  with before and after Monte Carlo numbers.
- **Never weaken or delete an invariant test.** If one looks wrong, that's a
  `[BLOCKED]` PR, not an edit.
- **No game engines, physics libraries, or UI frameworks.** A new runtime
  dependency needs a one-line justification in the PR. Dev dependencies are
  fine.
- **Don't touch `boards/classic.json` nail positions** unless the milestone
  calls for it.

## 4. Validate

```sh
npm run check      # typecheck, lint, unit tests
npm run test:e2e   # Playwright smoke tests
```

Both must pass. If something fails, fix the cause. Never skip, weaken, or
delete a test to get green.

Then check what the tests can't:

- **Anything visible in the browser:** run `npm run dev`, load the page with
  Playwright, and take a screenshot. Look at it. Describe what you saw in the
  PR. (In cloud sessions Chromium is preinstalled and Playwright finds it on
  its own; don't run `playwright install`.)
- **Anything that touches physics, the board, or pockets (from M3 on):** run
  the Monte Carlo tool on `master` and on your branch with the same seed, and
  put both numbers in the PR:

  ```sh
  npx tsx tools/montecarlo.ts --board classic --balls 100000 --power 0.62 --seed 1
  ```

  If spins per ¥1000 moved and you didn't mean it to, that's a bug.

## 5. Audit your own follow-ups

Before writing the PR, read everything you're about to record as "left for
later" and ask one question of each item: **would the reviewer expect this to
be in the PR already?**

- *"M5 ball–ball collisions should use this spatial hash too"*: a real
  follow-up. That milestone isn't started; there's nothing here to finish.
- *"The board validator should also say which nail is out of bounds"*: not a
  follow-up. It's the validator you wrote tonight, short of done. Finish it.

An item that fails the question goes back into tonight's work, however large
that makes the PR. Whether the extra work is small isn't the test; whether it
completes a thought this PR started is. For each item that survives, write one
sentence in the PR saying why it's separate. If you can't write that sentence,
it wasn't a follow-up.

## 6. Ship it

In the same PR:

- Update the **Status** section of `PLAN.md`: current milestone, what's done
  in it, what's next, today's date and a one-line summary under "Last session",
  and any open questions.
- Log any deliberate physics change in `PHYSICS.md` (what changed, why, before
  and after numbers).

Push the branch and open a PR against `master` using
`.github/pull_request_template.md`. The PR description is the handover:
the reviewer has no other context. Say what changed, how you verified it, what
deserves the closest look, and anything you skipped or weren't sure about. A
flagged uncertainty is worth far more than a confident-sounding guess.

Never merge your own PR. Never push to `master`. Never force-push a branch
with an open PR.

## When blocked

If the next step needs the maintainer (game rules, feel, an ambiguous spec, an
invariant test that looks wrong), don't guess:

1. Open a PR titled `[BLOCKED] <question>` with the question, the options you
   see, and your recommendation. If it carries no code, the only change is the
   `PLAN.md` entry below.
2. Add the question to "Open questions for the maintainer" in `PLAN.md`.
3. Move on to other independent work in the same milestone if there is any.
   If there isn't, say so in Status and stop.

## If you finish early

Don't start an unrelated task or the next milestone. In order:

1. **Finish this one.** Run the audit in step 5 again and fold in anything
   that fails it. This is the best use of the time, every time.
2. **Improve what you built:** a test for a case you didn't cover, a clearer
   validation error, a comment explaining a non-obvious derivation, a
   `PHYSICS.md` note on an assumption you made.

Steady, well-reviewed progress is the goal, not volume. Neither is a PR that
stops at the first defensible boundary.
