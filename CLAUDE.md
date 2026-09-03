# CLAUDE.md — working rules for this repo

Source of truth for how we work on this take-home. The brief in README.md is authoritative
for *what*; this file is authoritative for *how*.

## How we work

- **Plan before build.** For anything non-trivial, give options with trade-offs and wait for
  a decision. The user owns the decisions; Claude owns the mechanics.
- **Push back when the user is wrong, and say so plainly.** Don't agree to keep them happy.
- **Explain before acceptance on money paths.** For budget, generation triggers, and
  approvals: walk through the failure modes and races before writing the code.
- **Small commits, reasoned messages.** One branch per plan task (`task/<n>-<slug>`).
  After the evaluator passes, push the branch and open a PR to `main`, then **stop and wait
  for the user's review**. Never start the next task or merge without their go. Merge is
  fast-forward after approval. The pre-commit hook runs
  `npm run check` (typecheck, lint, format, tests); never bypass it with `--no-verify`.
  CI runs the same check on push.
- **Prefer simple, explainable, production-credible over clever.** Six-person customer,
  about 300 products, 40-product drops. Build for that scale, name the ceiling.

## Invariants

- **Never read, print, modify, or commit `.env.local`.** Never echo API keys into chat or
  logs. Code loads secrets from the environment; humans never see them in this session.
- **Keep `DECISIONS.md` current.** After any material choice append an entry:
  Decision / Alternatives / Why (tied to a requirement) / Cost accepted / Revisit trigger.
- **Keep `ASSUMPTIONS.md` current.** Every assumption made because the brief was silent, and
  what it changed about the build.
- **`APPROACH.md` is the final record**, written from what shipped, not from what was planned.
- **No generation without a visible cost and a cap.** Every path that calls Luma shows the
  estimated spend before the trigger and is bounded per run.

## Resuming in a fresh session

Read `docs/STATE.md` first. It holds the task board, the last commit per task, environment
facts (credits, hosts, keys present), and the next action. Update it at the end of every
task and after every decision. The plan with checkboxes is
`docs/superpowers/plans/2026-09-03-styled-shots.md`.

## Execution harness (D8)

One implementer subagent and one evaluator subagent per plan task. The evaluator MUST
invoke the project skill `evaluating-task` (`.claude/skills/evaluating-task/SKILL.md`):
mutation testing, interface and invariant checks, the nine anti-patterns, structured
verdict. Two rounds maximum per task. Codex reviews the full diff after Task 8.

## Files

- `README.md` — the brief (authoritative).
- `data/catalog.csv` — the customer's export. Treat as data, quirks included.
- `ASSUMPTIONS.md`, `DECISIONS.md`, `APPROACH.md`, `video.md` — deliverables.
- `docs/STATE.md` — resumable progress. `docs/superpowers/plans/` — the task plan.
- `submit.sh` — packages AI session history and submits. Do not edit.
