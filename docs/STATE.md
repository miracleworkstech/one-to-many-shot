# STATE.md — where we are, so a fresh session can continue

> Updated at the end of every task and at every decision. Read this first when resuming.
> Facts only. Reasoning lives in DECISIONS.md and ASSUMPTIONS.md.

## Phase

**Building, paused between tasks.** Tasks 1 to 3 merged to `main` (PR #2 for Task 3,
approved by the user 2026-09-04 after the Codex pass and the Haiku re-test). Next action:
on the user's go, `git checkout -b task/4-luma` and run Task 4 (Luma client, photo fetch)
through implementer, evaluator, and Codex, then open a PR and stop. The Task 3 Codex
findings were decided 2026-09-04: sheet wins on re-import (D10 addendum).

**Update 2026-09-04: Task 6 passed all three checks and is on `task/6-review` with PR #5
open.** Next action: user review, ff-merge, delete the branch, then Task 7 (exports) on
`task/7-exports`; its brief is at `.superpowers/sdd/task-7-brief.md`. Notes for Task 5 from the Task 4 reviewers: write the
`GenerationState` to `CandidateState` mapping out explicitly (the vocabularies coincide so
a bare pass-through would typecheck); an unexpected-state or completed-without-url throw
from `getGeneration` fires after the $0.0434 was committed, so it must not be counted like
a transport error in the attempt budget. D11: the worker pauses (banner =
`LumaError.userMessage`) on any `LumaError` with `retryable: false` and code `budget`,
`auth` or `forbidden`; backs off `retryAfterMs` on `LumaRateLimitError`; counts
`retryable: true` errors as attempts; a `failure` with `retryable: false` fails the
candidate with no retry and shows `failure.userMessage` on the card.

## Task board

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1 Scaffold, env, db, storage | merged | 08002ed | evaluator PASS, 8 mutants / 3 killed; NaN-cap fix + 3 tests added before merge |
| 2 Pure domain functions | merged | PR #1 | evaluator PASS, 16 mutants / 12 killed; 4 test tightenings + cast fix applied |
| 3 Import, suggestions, read model, status page | merged | PR #2 | evaluator PASS round 2 (8 mutants / 5 killed, then 3/5, survivors need network or a React renderer); Codex: 4 findings, 2 fixed (2 MB upload cap, honest `suggested` count), 2 to the user; manual check with Haiku: 40 rows, 24 model ideas |
| 4 Luma client, photo fetch | merged | PR #3 | evaluator PASS round 2 (8 mutants / 7 killed; the survivor is the timeout value); Codex: 6 findings, 4 fixed (JPEG magic bytes, 15 MB photo cap, url must be a string, empty id and completed-without-url throw), then D11 (user's ask): every Luma status and failure_code maps to a typed code and plain-English message in `lib/luma-errors.ts`; evaluator PASS (16 mutants / 14 killed, survivors fixed), Codex: 3 findings fixed (key redaction, Retry-After clamp, body-read failure). 74 tests. Live: key authenticates, 402 no credits, $0 spent |
| 5 Admission control, worker, notify, analytics | merged | PR #4 | evaluator FAIL→PASS (19 then 9 mutants; live 402 pause at $0 twice); Codex: 7 findings, 6 fixed (shared worker lock across hot reloads, positive env bounds, no double-counted processing cost, bounded download retries, retryable photo errors, integer n), 1 accepted (per-settlement Slack message, D12 addendum) |
| 6 Review page, image route | PR open | task/6-review | evaluator FAIL→PASS (8 mutants, 5 killed by tests, 3 browser-only killed by hand; 375 px check at $0 twice); Codex: 8 findings, 7 fixed (kind validation, retry note only with an idea, length limits, decide bound to sku, keyed forms, IdeaForm pending state, updated_at restore), 1 deferred to Task 8 (img route auth = the token middleware); D13 |
| 7 Exports | not started | | |
| 8 Access gate, Docker, Railway | not started | | the middleware must gate `/img/[id]` and `/export/*` too (Codex on Task 6: candidate images are enumerable without it) |
| 9 Final docs, video, submit | not started | | |

## How a task runs (D8)

0. Main session creates `task/<n>-<slug>` from `main`.
1. Implementer subagent: gets CLAUDE.md, the task text, Global Constraints, money-path
   table, and the Interfaces of tasks it consumes. Writes code and tests. Does not commit.
2. Evaluator subagent: invokes the `evaluating-task` skill (`.claude/skills/evaluating-task`),
   runs tests, mutation-tests, checks interfaces and invariants, reports in the contract.
3. Loop cap two rounds. A third means the plan is wrong; fix the plan with the user first.
3b. Third check, only after the evaluator PASSes: Codex review of the task diff
   (`codex:codex-rescue` subagent, read-only). Cheap findings are fixed on the branch and
   re-checked; product-decision findings go to the user verbatim (D8, amended 2026-09-04).
   Codex is validation, so it finishes before the PR is opened; the user's review (step 5)
   is the last gate. Do not run it while `next dev` is up (it rebuilds `.next`).
4. Main session commits with the plan's message (the pre-commit hook runs `npm run check`),
   pushes the branch, opens a PR to `main` with both agents' summaries, updates this file
   and the plan checkboxes on the branch, appends to DECISIONS.md if a material choice was
   made, and **stops for the user's review**.
5. After the user approves: fast-forward merge into `main`, delete the branch, push (CI
   re-runs the check). Only then does the next task start, on the user's go.
6. After Task 8: Codex review over the full diff, findings to the user, then deploy.

## Environment facts

- Luma Agents API key is in `.env.local` (never read it). It authenticates (a GET on a bogus
  id returns 404, not 401) but the account has **zero credits** as of 2026-09-04 (402
  `RATE_LIMIT.BUDGET.EXCEEDED` on `scripts/smoke_luma.py`, $0 spent). The user tried a
  second key on 2026-09-04; it was a different Luma product (401 on the Agents API) and was
  reverted. Decision: proceed without credits; the worker's 402 pause path is what gets
  exercised live until the account is topped up, and D5's real generation is still owed.
- Photo host returns 403 to plain clients, 200 with a browser User-Agent (verified).
- Codex CLI 0.144.4 installed and logged in (checked 2026-09-03).
- `ANTHROPIC_API_KEY` is in `.env.local` as of 2026-09-03 (never read it). The user renamed `.env.example` to `.env` (gitignored, placeholder only); Task 8 recreates `.env.example` with the real variable list. `next dev` and `next start` load it; `node --test` does not, so tests run on the template fallback.
- The user replaced the Anthropic key with a non-identity-linked one on 2026-09-04; Haiku suggestions verified working through the page (24 model ideas on the first import). `ANTHROPIC_WORKSPACE_ID` stays optional in `lib/env.ts` for identity-linked keys.
- Running a Codex review while `next dev` is up wipes `.next` (Codex's sandbox rebuilt it) and the dev server 500s until restarted. Run the manual check before or after Codex, not during.
- Deploy target: Railway, volume at `/data`, daily backups. No Railway project created yet.
- Local Node is 26; better-sqlite3 13 ships prebuilds so no compiler needed. CI pins Node 22.
- Pre-commit hook active locally (`core.hooksPath=.githooks`). GitHub Actions `check` runs on push.
- This Windows machine has a small paging file; it has killed a pre-commit hook mid-run twice
  (no lint output, exit 1). Rerun the commit; never bypass the hook.
- Slack incoming webhook: not created yet. Optional; the app runs without it.

## Open items for the user

- Luma credits (email sent?).
- Railway account confirmed.
- Slack webhook URL for the demo (optional).

## Resume checklist for a fresh session

1. Read `CLAUDE.md`, this file, then the plan's next unchecked task.
2. `git log --oneline | head` to confirm the last commit matches the task board.
3. `npm test` if code exists; it must be green before starting the next task.
4. Continue at "Next action" above.
