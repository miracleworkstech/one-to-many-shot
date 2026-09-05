# STATE.md — where we are, so a fresh session can continue

> Updated at the end of every task and at every decision. Read this first when resuming.
> Facts only. Reasoning lives in DECISIONS.md and ASSUMPTIONS.md.

## Phase

**Building, paused between tasks.** Tasks 1 to 3 merged to `main` (PR #2 for Task 3,
approved by the user 2026-09-04 after the Codex pass and the Haiku re-test). Next action:
on the user's go, `git checkout -b task/4-luma` and run Task 4 (Luma client, photo fetch)
through implementer, evaluator, and Codex, then open a PR and stop. The Task 3 Codex
findings were decided 2026-09-04: sheet wins on re-import (D10 addendum).

**Update 2026-09-04 (later): Task 8 merged (PR #7, main at a877481). The user set every
Railway variable by hand and generated the domain
`one-to-many-shot-production.up.railway.app`; the first Dockerfile deploy started 13:27 UTC.
The whole-codebase Codex pass (D8 step 6) ran after the merge; its findings are in the
session recap and, if material, below. Live deploy verified 2026-09-04 after the HOSTNAME hotfix (PR #8): healthz 200, every
app route 401 without the link, no cookie on a wrong token. The user chose to fix four of the
six whole-codebase findings; that is Task 8c (`task/8c-codex-fixes`, D16), in PR, waiting for
review. Then the user chose to fix finding 3 too: Task 8d (`task/8d-idea-snapshot`, D17,
chained on 8c) snapshots the shot idea on the candidate so approved filenames stop changing
when the idea is edited. 8c and 8d merged (PRs #9, #10; main at a34cc96, deployed). Luma credits
topped up and the Slack webhook set by the user. Live end-to-end run 2026-09-04 through the
team link: HG-001, 1 product, estimate $0.09 shown before the tap, actual $0.09, both
candidates landed in review within a minute, Slack message received (user confirmed). Total
live spend $0.17 over two batches; D5's owed real generation is discharged. Next: Task 9
(final docs, video, submit) on the user's go.** Earlier note, kept for
the record: Task 7 merged as PR #6. The original next action was: read the brief at
`.superpowers/sdd/task-8-brief.md` (regenerate with the task-brief script if missing), then
run Task 8 through implementer → evaluator → Codex → PR → user review. Deltas to give the
implementer: the middleware gates every route except `_next`, `favicon.ico` and `/healthz`,
including `/img/[id]` and `/export/*`, and accepts `?k=` on any of them (Task 7's CSV links
carry it) before setting the cookie and redirecting to the clean URL; `next.config.ts`
already has `output: "standalone"`; the manual check is a local `docker build` and `docker
run` with a temp data dir and the key blanked; the first Railway deploy is expected to fail
until the Dockerfile lands and the variables are set (see Environment facts). After Task 8:
the whole-diff Codex pass (D8), then deploy with the user, then Task 9 (docs, video). Task 8's middleware must accept `?k=` on `/img/[id]` (the CSV links carry
it) as well as on `/`, and gate `/export/*`. Notes for Task 5 from the Task 4 reviewers: write the
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
| 6 Review page, image route | merged | PR #5 | evaluator FAIL→PASS (8 mutants, 5 killed by tests, 3 browser-only killed by hand; 375 px check at $0 twice); Codex: 8 findings, 7 fixed (kind validation, retry note only with an idea, length limits, decide bound to sku, keyed forms, IdeaForm pending state, updated_at restore), 1 deferred to Task 8 (img route auth = the token middleware); D13 |
| 7 Exports | merged | PR #6 | evaluator PASS (9 mutants / 8 killed, survivor fixed; full-catalog round trip 40 rows 0 diffs, $0); Codex: 8 findings, 5 fixed (formula neutralisation with a leading space, SKU slug in zip names, missing-file warning, UTF-8 BOM + charset, memory ceiling named), 3 accepted (in-process snapshots, second-resolution ties); then D14: the zip streams (user's call; evaluator PASS with a measured 26 MB peak for a 120 MB zip, Codex no findings), then D14 amended: exact Content-Length from stat sizes (user's call; evaluator FAIL→PASS on one missing test, fflate layout re-verified from source; Codex 7 findings, 3 fixed, fflate pinned exact), A16, A17 |
| 8 Access gate, Docker, Railway | merged | PR #7 | evaluator PASS twice (9 mutants / 5 killed then survivors tested; 4/4 on the fixes); Docker image verified by implementer and evaluator (healthz, 401, redirect + cookie, fail-fast exit 1, no env files in the image, $0); Codex: 6 findings, 5 fixed (APP_URL required and origin-only, whole-startup fail-fast, `.env*` ignore, trailing-slash test, README), 1 accepted (matcher test anchors the regex source); re-check 1 low finding fixed; D15, A18. Step 4 (deploy) still to do with the user |
| 8b Deploy hotfix | merged | PR #8 | `HOSTNAME=::` in the Dockerfile: Next standalone binds to HOSTNAME and Docker sets it to the container id, so Railway's proxy got connection refused |
| 8c Codex whole-codebase fixes | PR open | task/8c-codex-fixes | user's call: findings 1, 2, 5, 6 (estimate tracks N; budget_exhausted pauses; SSRF guard on photo URLs incl. redirect hops; ASSUMPTIONS row 14); 3 and 4 accepted as documented costs. Evaluator PASS x2 (6/8 then 7/7 mutants); Codex 4 findings all fixed; D16 |
| 8d Idea snapshot on candidates | PR open | task/8d-idea-snapshot | user's call on finding 3: `candidates.shot_idea` written at enqueue, additive migration + one-time backfill in one transaction, filenames from `c.shot_idea ?? p.shot_idea`; evaluator FAIL→PASS (untested write side, fixed), 6 + 3 mutants; Codex 1 finding fixed (transactional migration); D17 |
| 9 Final docs, video, submit | not started | | |
| 10 Review page layout (Impeccable) | PR #11 | task/10-review-page | init + critique (26/40) + layout, quieter, harden; Codex 4 findings fixed; D18. PRODUCT.md and .impeccable/ added |
| 13 Status page hierarchy, action row, spend disclosure | planned | | plan `docs/superpowers/plans/2026-09-05-status-hierarchy.md`; critique 25/40; built on task/11 after the cross-page consistency review |
| 11 Status page layout (Impeccable) | PR open | task/11-status-page | grouped by next action, counts in headings, generate inside Ready, spend behind a disclosure; D19 |

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
  id returns 404, not 401) had zero credits until 2026-09-04 (topped up that evening; two live batches since) (402
  `RATE_LIMIT.BUDGET.EXCEEDED` on `scripts/smoke_luma.py`, $0 spent). The user tried a
  second key on 2026-09-04; it was a different Luma product (401 on the Agents API) and was
  reverted. Decision: proceed without credits; the worker's 402 pause path is what gets
  exercised live until the account is topped up, and D5's real generation is still owed.
- Photo host returns 403 to plain clients, 200 with a browser User-Agent (verified).
- Codex CLI 0.144.4 installed and logged in (checked 2026-09-03).
- `ANTHROPIC_API_KEY` is in `.env.local` as of 2026-09-03 (never read it). The user renamed `.env.example` to `.env` (gitignored, placeholder only); Task 8 recreates `.env.example` with the real variable list. `next dev` and `next start` load it; `node --test` does not, so tests run on the template fallback.
- The user replaced the Anthropic key with a non-identity-linked one on 2026-09-04; Haiku suggestions verified working through the page (24 model ideas on the first import). `ANTHROPIC_WORKSPACE_ID` stays optional in `lib/env.ts` for identity-linked keys.
- Running a Codex review while `next dev` is up wipes `.next` (Codex's sandbox rebuilt it) and the dev server 500s until restarted. Run the manual check before or after Codex, not during.
- Deploy target: Railway, volume at `/data`, daily backups. Live at
  `https://one-to-many-shot-production.up.railway.app` (domain target port 3000, `PORT=3000`
  set by the user because Railway injects PORT=8080 otherwise). The connector's write actions
  are blocked by the session's permission classifier; reads (status, logs, domains) work. **The user created the Railway
  project from the GitHub repo on 2026-09-04 and it started building** before the Dockerfile
  existed, so that first build/deploy will fail or crash-loop (`assertProductionEnv` throws
  without `LUMA_AGENTS_API_KEY` and `ACCESS_TOKEN`); expected, not a bug. The Railway
  connector is attached to this Claude session (tools `mcp__…__list-projects`,
  `get-status`, `create-volume`, `set-variables`, `list-variables`, `get-logs`,
  `generate-domain`, `get-deployment-diagnosis`); a fresh session should load them with
  ToolSearch. Use it for the volume, domain, non-secret variables and diagnosis; the user
  pastes secret variables (Luma, Anthropic, Slack, ACCESS_TOKEN) in the dashboard, never
  through this session.
- Local Node is 26; better-sqlite3 13 ships prebuilds so no compiler needed. CI pins Node 22.
- Pre-commit hook active locally (`core.hooksPath=.githooks`). GitHub Actions `check` runs on push.
- This Windows machine has a small paging file; it has killed a pre-commit hook mid-run twice
  (no lint output, exit 1). Rerun the commit; never bypass the hook.
- Slack incoming webhook: created and set on the Railway service by the user 2026-09-04;
  one message per settled batch confirmed live.

## Open items for the user

- Railway: variables and domain set by the user 2026-09-04 (the connector's write actions are
  blocked by the session's permission classifier; reads work). Confirm the `/data` volume
  with daily backups exists in the dashboard.
- Railway account confirmed.

## Resume checklist for a fresh session

1. Read `CLAUDE.md`, this file, then the plan's next unchecked task.
2. `git log --oneline | head` to confirm the last commit matches the task board.
3. `npm test` if code exists; it must be green before starting the next task.
4. Continue at "Next action" above.
