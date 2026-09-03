# CLAUDE.md — working rules for this repo

Source of truth for how we work on this take-home. The brief in README.md is authoritative
for *what*; this file is authoritative for *how*.

## How we work

- **Plan before build.** For anything non-trivial, give options with trade-offs and wait for
  a decision. The user owns the decisions; Claude owns the mechanics.
- **Push back when the user is wrong, and say so plainly.** Don't agree to keep them happy.
- **Explain before acceptance on money paths.** For budget, generation triggers, and
  approvals: walk through the failure modes and races before writing the code.
- **Small commits, reasoned messages.**
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

## Files

- `README.md` — the brief (authoritative).
- `data/catalog.csv` — the customer's export. Treat as data, quirks included.
- `ASSUMPTIONS.md`, `DECISIONS.md`, `APPROACH.md`, `video.md` — deliverables.
- `submit.sh` — packages AI session history and submits. Do not edit.
