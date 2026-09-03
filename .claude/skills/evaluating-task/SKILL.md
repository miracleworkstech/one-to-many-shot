---
name: evaluating-task
description: Use when acting as the evaluator for an implemented plan task in this repo, before reporting a verdict on an implementer's diff
---

# Evaluating a Task

## Overview

The evaluator's job is to find what the implementer's tests cannot. Reading tests proves they
exist. Breaking the code and watching the tests stay green proves they are hollow.
**A verdict without mutation results is not a verdict.**

## Inputs you must have

- The task text from `docs/superpowers/plans/*.md` (Files, Interfaces, Steps).
- `CLAUDE.md`, the plan's Global Constraints, and the money-path table.
- The implementer's diff (`git diff` against the last commit) and their summary.

## Procedure, in order

1. **Run the full check.** `npm run check` (typecheck, lint, format, tests). Record counts. Any red is an immediate FAIL. Lint already rejects `any` and `@ts-` comments; jsx-a11y rejects images without `alt` and controls without names. Do not re-check what the check just proved.
2. **Interfaces, line by line.** For every line in the task's Interfaces block, find the
   exported symbol, check name, parameter types, return type. Any mismatch is a finding.
3. **Invariants.** Check each, cite file:line for any breach:
   - No `state: string`, `as unknown as`, or non-null `!` on values that can be null in
     production code (the lint-caught escapes are already excluded by step 1).
   - Every SQL state or idea-source literal goes through `st()`, `inStates()`, `src()`.
   - No `.env.local` read, no key printed or logged.
   - Every Luma call path shows cost before the trigger and is bounded by both caps.
   - One responsibility per module per the plan's file structure. A module that gained a
     second reason to change is a finding, even if it works.
4. **Money paths.** For each row in the money-path table that this task claims to cover,
   point to the exact line that implements the mitigation. Missing line = finding.
5. **Mutation testing.** For each non-trivial function the task produced, make at least one
   mutation from the table below, run `npm test`, record whether any test failed, then
   `git checkout -- <file>` to restore. A surviving mutant is a finding naming the mutant
   and the missing test. Minimum: three mutants per task, one per branch-bearing function.
6. **Anti-pattern sweep.** Check the nine patterns in the table below against the diff.
7. **Manual check.** If the task has a manual step (dev server, page at 375 px), do it and
   report what you saw, not what the step said should happen.
8. **Report.** Use the output contract exactly.

## Mutation table

| Mutation | Applies to | Survives when |
|---|---|---|
| Flip a comparison (`>=` to `>`, `===` to `!==`) | status ladders, caps, guards | boundary untested |
| Delete a guard clause (`if (x) return`) | admission control, worker, middleware | error path untested |
| Swap an enum literal (`"approved"` to `"rejected"`) | any state comparison | test asserts nothing about that branch |
| Return a constant (`return 0`, `return []`) | analytics, queries, parsers | test checks shape not values |
| Remove a transaction wrapper or a `where` predicate | enqueue, decide, import | race or over-write untested |
| Replace a thrown error with `return null` | luma, photos, catalog | error swallowing undetected |

## Nine patterns agents get wrong

| # | Pattern | What to look for | Why it fails in production |
|---|---|---|---|
| 1 | Mock-testing mocks | A mock is created, then the assertion checks the mock's own return value | Proves nothing about real code |
| 2 | Missing error paths | Happy path only; `catch {}`; errors logged and forgotten; fetch status unchecked | Silent stalls, lost money, no banner |
| 3 | Hardcoded test data | Tests only use magic strings that never resemble `data/catalog.csv` | Passes on `"x"`, fails on `"Salt + Pepper Cellar Set"` |
| 4 | Over-mocking | DB, fs, or fetch all mocked so nothing real is exercised | Integration bugs invisible; prefer the real SQLite in a temp dir |
| 5 | Type escape hatches | `as unknown as`, `!` on nullable values, `as X` on a value the code never validated | Compiler no longer owns the invariant (lint already blocks `any` and `@ts-` comments) |
| 6 | Stale imports | Importing types from `db.ts` instead of `types.ts`; old `lib/actions.ts` path | Wrong module, wrong coupling, silent drift |
| 7 | Missing cleanup | Temp dirs, open DB handles, `setInterval` in tests, worker started in test | Leaks, flaky runs, hung test process |
| 8 | Incomplete UI | No loading, error, or empty state; a list with zero rows renders nothing | Ellie sees a blank page and assumes it broke |
| 9 | Accessibility gaps | Tap targets under 44 px, contrast below 4.5:1, focus order, state conveyed by colour alone (lint already blocks missing `alt` and unnamed controls) | Unusable on a phone, the primary device |

## Output contract

```
VERDICT: PASS | FAIL

Tests: <passed>/<total>
Mutants: <killed>/<tried>  (list each: file, mutation, killed|survived)
Interfaces: <n> checked, <m> mismatched
Money paths: <rows claimed> -> <rows with a cited line>

Findings (blocking first):
1. <file:line> — <what> — <why it matters> — <fix>
...

Manual check: <what you saw, or "none required">
```

FAIL if any of: red tests, a surviving mutant on a money path, an interface mismatch, an
invariant breach, patterns 2 or 5 present. Otherwise PASS with non-blocking findings listed.

## Red flags in your own reasoning

- "The tests look thorough" without having broken anything.
- "This is a simple task, mutation testing is overkill."
- "The implementer said they tested it manually."
- "I'll note the `as unknown as` as minor." It is blocking.
- Reporting a PASS with an empty mutants line.

All of these mean: go back to step 5.
