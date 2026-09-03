# APPROACH.md

> Status: **design draft, pre-build (2026-09-03).** Sections marked *(fill after build)* are
> placeholders for the required deliverable sections and will be completed from what
> actually shipped, not from what was planned.

Live URL: *(fill after deploy)*

## What we're building and why

A single small web app that turns the shot ideas in the catalog sheet into approved,
correctly named product images, for a six-person team that works from Sheets, Slack, Gmail,
and a phone.

The workflow, end to end:

1. **Import.** Maya uploads the catalog export (same columns as `data/catalog.csv`) from her
   laptop. Rows are upserted by SKU. Existing approvals are never touched by a re-import.
2. **Ideas.** Rows with a Shot Idea keep it. Rows without one get a suggested idea, labelled
   as suggested, editable, and free until someone taps generate.
3. **Generate.** From the status page, "generate next N" (or per product) creates two
   candidates per product using Luma `image_edit` with the white-background photo as the
   source. The estimated cost is shown before the tap. A hard cap per run stops a bad upload
   from draining the account. "El: do this first" products go first.
4. **Notify.** One Slack message per batch, via an incoming webhook: "12 products ready to
   review" and a link. No bot, no app install, no per-image noise.
5. **Review.** Ellie opens the link on her phone. One product per screen: the original photo,
   the shot idea, the notes, the candidates. Tap approve or reject. "Try again" with an
   optional note regenerates that product only. Approved images are copied out of Luma
   (its URLs expire in an hour) into our storage under a deterministic name:
   `HG-002-morning-kitchen-01.jpg`.
6. **Status.** The same page, top section, answers Maya's question without asking Ellie:
   how many products have no idea, are waiting on review, are done (2+ approved), and what
   has been spent. "Download updated CSV" returns the original columns plus status and
   approved image URLs. "Download approved" returns a zip of approved files, ready for the
   Drive folder and the web person.

## Architecture

- **One Node process** running **Next.js** (App Router, server actions) on **Railway**,
  always on. No serverless, no cron service.
- **SQLite** (better-sqlite3, WAL mode) for two tables and **a mounted volume** for images.
  Both on the same volume, backed up daily by Railway's scheduled volume backups.
- **An in-process poll loop** advances generation: submit queued candidates, check
  processing ones, download completed images. It starts with the process and resumes from
  the database on restart. This exists because the Luma Agents API has no callbacks.
- **Luma Agents API** (`uni-1`, `image_edit`, JPEG output) for generation. The reference
  photo is fetched by our server with a browser user agent and sent inline as base64,
  because the customer's photo host returns 403 to plain script clients.
- **Claude** (Haiku) for suggested shot ideas on blank rows, one batched call per import.
  Category-template fallback when no key is configured.
- **Slack** incoming webhook for the batch-ready message. Skipped silently if unset.
- **One storage module** owns every disk read and write, so moving images to object
  storage later is a one-file change. See D6 in `DECISIONS.md` for the scaling order.

### Data model

```
products    sku (pk), name, category, color, material, price, photo_url,
            shot_idea, shot_idea_source ('sheet' | 'suggested' | 'edited'),
            notes, priority (bool, from "do this first"), imported_at, updated_at

candidates  id, sku (fk), prompt, luma_generation_id,
            state ('queued' | 'processing' | 'completed' | 'failed'
                   | 'approved' | 'rejected'),
            storage_path, cost_usd, failure_reason, decided_by, created_at, decided_at
```

Product status is derived, never stored:
`no_idea` → `idea_ready` → `generating` → `in_review` → `done` (2+ approved) or
`needs_more` (fewer than 2 approved, nothing pending).

### The poll loop

Every few seconds: submit up to K queued candidates (K bounded by Luma's concurrency
limit, backing off on 429), poll each processing one, download completed images to the
volume, mark failures with the reason. A 402 (budget exhausted) pauses all submissions and
raises a banner on the status page rather than retrying. State lives in SQLite, so a
restart mid-batch loses nothing.

### Access

One shared link containing an unguessable token. Everyone on the team uses the same link.
This is the right trade for six people who already share a Drive folder; it is not the
right trade at sixty. Approvals record a free-text "decided by" so named approvers can be
added later without changing the schema.

### Error handling

- Photo URL unreachable (403/404): candidate fails with "photo not reachable", shown on the
  card, retry button. Import does not block on it.
- Luma `content_moderated` or `generation_failed`: candidate fails with the reason, shown.
- Luma 429: candidate stays queued, next tick retries. No exponential backoff in v1.
- Luma URL expired before download: re-poll the generation to get a fresh URL.
- CSV with unexpected headers: import rejected with the header diff shown. No partial import.

### Testing

- One unit test file: CSV parse + upsert rules, status derivation, filename generation.
- One smoke script that runs a single real generation end to end (also the first thing built,
  because it verifies the 403 risk and the fidelity of `image_edit` before anything else).

## Build order (one working day)

1. Smoke test: one real `image_edit` on HG-002. Verifies photo fetch, base64 path, quality.
2. Supabase schema, storage bucket, env.
3. CSV import + status page + suggested ideas.
4. Tick + generation.
5. Review page (phone-first).
6. Slack webhook, CSV export, zip export.
7. Deploy, docs, video.

## Key decisions and tradeoffs *(fill after build)*

## The road not taken *(fill after build)*

Slack-native approval (bot with buttons). Strongest alternative: meets "her phone" with
zero new surfaces. Not built because previews are small, forty products with two candidates
each is not scannable in a channel, notification fatigue is the failure mode, and it needs
an installed app and a workspace invite for anyone to try it.

## Scope ledger *(fill after build)*

## Unit economics *(fill after build)*

Known now: `uni-1` edit is $0.0434 per image. Two candidates per product is $0.087. Forty
products is about $3.50; the full 300 is about $26.

## What breaks first under pressure *(fill after build)*
