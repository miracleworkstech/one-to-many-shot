# STATE.md — where we are, so a fresh session can continue

> Updated at the end of every task and at every decision. Read this first when resuming.
> Facts only. Reasoning lives in DECISIONS.md and ASSUMPTIONS.md.

## Phase

**Pre-build.** Plan approved in principle; harness being finalised. Next action: start Task 1
of `docs/superpowers/plans/2026-09-03-styled-shots.md` once the user gives the go.

## Task board

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1 Scaffold, env, db, storage | not started | | |
| 2 Pure domain functions | not started | | |
| 3 Import, suggestions, read model, status page | not started | | |
| 4 Luma client, photo fetch | not started | | |
| 5 Admission control, worker, notify, analytics | not started | | money paths accepted 2026-09-03 |
| 6 Review page, image route | not started | | |
| 7 Exports | not started | | |
| 8 Access gate, Docker, Railway | not started | | |
| 9 Final docs, video, submit | not started | | |

## How a task runs (D8)

1. Implementer subagent: gets CLAUDE.md, the task text, Global Constraints, money-path
   table, and the Interfaces of tasks it consumes. Writes code and tests. Does not commit.
2. Evaluator subagent: invokes the `evaluating-task` skill (`.claude/skills/evaluating-task`),
   runs tests, mutation-tests, checks interfaces and invariants, reports in the contract.
3. Loop cap two rounds. A third means the plan is wrong; fix the plan with the user first.
4. Main session commits with the plan's message, updates this file and the plan checkboxes,
   appends to DECISIONS.md if a material choice was made, summarises the pair's result.
5. After Task 8: Codex review over the full diff, findings to the user, then deploy.

## Environment facts

- Luma Agents API key is in `.env.local` (never read it). Account had **zero credits** on
  2026-09-03 (402 `RATE_LIMIT.BUDGET.EXCEEDED`). User is emailing the recruiter for credits.
  Until then, the worker's 402 pause path is what gets exercised.
- Photo host returns 403 to plain clients, 200 with a browser User-Agent (verified).
- Codex CLI 0.144.4 installed and logged in (checked 2026-09-03).
- User will supply their own Anthropic key for Haiku suggestions when testing.
- Deploy target: Railway, volume at `/data`, daily backups. No Railway project created yet.
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
