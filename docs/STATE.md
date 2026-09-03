# STATE.md — where we are, so a fresh session can continue

> Updated at the end of every task and at every decision. Read this first when resuming.
> Facts only. Reasoning lives in DECISIONS.md and ASSUMPTIONS.md.

## Phase

**Building, paused between tasks.** Tasks 1 and 2 merged to `main` (PR #1 approved by the
user). Next action: on the user's go, `git checkout -b task/3-import` and run Task 3
(import, suggestions, read model, status page) through the implementer/evaluator pair, then
open a PR and stop. Task 3's manual check will use the Haiku key from `.env.local`
via the dev server.

## Task board

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1 Scaffold, env, db, storage | merged | 08002ed | evaluator PASS, 8 mutants / 3 killed; NaN-cap fix + 3 tests added before merge |
| 2 Pure domain functions | merged | PR #1 | evaluator PASS, 16 mutants / 12 killed; 4 test tightenings + cast fix applied |
| 3 Import, suggestions, read model, status page | not started | | |
| 4 Luma client, photo fetch | not started | | |
| 5 Admission control, worker, notify, analytics | not started | | money paths accepted 2026-09-03 |
| 6 Review page, image route | not started | | |
| 7 Exports | not started | | |
| 8 Access gate, Docker, Railway | not started | | |
| 9 Final docs, video, submit | not started | | |

## How a task runs (D8)

0. Main session creates `task/<n>-<slug>` from `main`.
1. Implementer subagent: gets CLAUDE.md, the task text, Global Constraints, money-path
   table, and the Interfaces of tasks it consumes. Writes code and tests. Does not commit.
2. Evaluator subagent: invokes the `evaluating-task` skill (`.claude/skills/evaluating-task`),
   runs tests, mutation-tests, checks interfaces and invariants, reports in the contract.
3. Loop cap two rounds. A third means the plan is wrong; fix the plan with the user first.
4. Main session commits with the plan's message (the pre-commit hook runs `npm run check`),
   pushes the branch, opens a PR to `main` with both agents' summaries, updates this file
   and the plan checkboxes on the branch, appends to DECISIONS.md if a material choice was
   made, and **stops for the user's review**.
5. After the user approves: fast-forward merge into `main`, delete the branch, push (CI
   re-runs the check). Only then does the next task start, on the user's go.
6. After Task 8: Codex review over the full diff, findings to the user, then deploy.

## Environment facts

- Luma Agents API key is in `.env.local` (never read it). Account had **zero credits** on
  2026-09-03 (402 `RATE_LIMIT.BUDGET.EXCEEDED`). User is emailing the recruiter for credits.
  Until then, the worker's 402 pause path is what gets exercised.
- Photo host returns 403 to plain clients, 200 with a browser User-Agent (verified).
- Codex CLI 0.144.4 installed and logged in (checked 2026-09-03).
- `ANTHROPIC_API_KEY` is in `.env.local` as of 2026-09-03 (never read it). The user renamed `.env.example` to `.env` (gitignored, placeholder only); Task 8 recreates `.env.example` with the real variable list. `next dev` and `next start` load it; `node --test` does not, so tests run on the template fallback.
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
