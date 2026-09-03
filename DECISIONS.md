# DECISIONS.md — running decision log

Append-only. One entry per material choice. Format: Decision / Alternatives / Why (tied to a
requirement) / Cost accepted / Revisit trigger. Assumptions made because the brief was silent
live in `ASSUMPTIONS.md`, not here.

---

## D1 — Product shape: the sheet is the product, approval is a lightweight web page (2026-09-03)

- **Decision:** Shape A. CSV in, generation staged with a visible cost, one Slack message per
  batch via incoming webhook, approval on a phone-first web page reached from that message,
  status on the same page plus an updated CSV export.
- **Alternatives:** (B) Slack-native bot with approve/reject buttons and a `/status`
  command. (C) Email digest with reply-to-approve.
- **Why:** Ellie's constraints ("from my phone", "don't install anything") and the rejected
  dashboard. A page that arrives as a link with one job is not a destination to remember.
  B fails on small previews, unscannable channels at 40 × 2 candidates, notification
  fatigue, and needing an installed app plus a workspace invite for anyone to try it. C is
  the easiest to miss and the worst UX.
- **Cost accepted:** One screen outside Slack. Approvals are not in-thread. The status view
  is a cousin of the dashboard they abandoned; it is kept to one screen with no login.
- **Revisit trigger:** Ellie stops opening links within a day of the Slack message, or the
  team asks for in-Slack buttons. Then B's bot becomes an addition on top of A's page.

## D2 — Suggested shot ideas are in v1 scope (2026-09-03)

- **Decision:** Rows with no Shot Idea get a suggested one, labelled and editable, at no
  generation cost until someone taps generate.
- **Alternatives:** Only generate for rows with a human-written idea. Leave blanks blank.
- **Why:** 24 of 40 rows are blank today and the 40-product drop will arrive mostly blank.
  Maya's goal is the whole drop launching with styled shots. Without suggestions the
  turnaround is "wait for Ellie to think of 40 ideas".
- **Cost accepted:** A dependency on an LLM call at import time. Suggested ideas will be
  generic sometimes; that is what "edit" is for.
- **Revisit trigger:** Suggested ideas get rejected at a much higher rate than sheet ideas.

## D3 — Delivery is a zip download plus updated CSV, not a Drive push (2026-09-03)

- **Decision:** "Download approved" returns a zip of approved images with deterministic
  SKU-based filenames. "Download CSV" returns the export with status and image URL columns.
  No Google Drive API integration in v1.
- **Alternatives:** Push approved files into the shared Drive folder via a service account.
- **Why:** The brief's "done" includes the Drive folder, but a Drive push needs a Google
  service account the team must create and share a folder with. The pain the brief
  describes (wrong `IMG_43xx.jpg` shipped) is a naming and provenance problem, which the
  zip solves. The extra step (drop the zip in Drive) is one the team already does today.
- **Cost accepted:** One manual step remains. Two copies of the truth (our storage, Drive)
  can drift if someone renames in Drive.
- **Revisit trigger:** The web person asks "which file is final" again, or the team wants
  the folder to fill itself. Then add Drive linking.

## D4 — Claude Haiku generates suggested shot ideas (2026-09-03)

- **Decision:** One batched Claude Haiku call per import proposes shot ideas for blank rows,
  from product name, category, color, material, and notes. User supplies their own key for
  testing; a category-template fallback runs when no key is configured.
- **Alternatives:** Static per-category templates only. A Luma text model, if one existed.
- **Why:** Templates read as generic across 300 products. Ideas that reference the actual
  product ("terracotta vase" vs "ceramics") get accepted more and edited less, which is the
  turnaround Maya cares about. Haiku is cheap enough that the cost is noise next to images.
- **Cost accepted:** A second external API and key. A fallback path to maintain.
- **Revisit trigger:** Suggestions need editing more often than not.

## D5 — One real generation before any UI (2026-09-03)

- **Decision:** First build step is a smoke script that runs one real `image_edit` on HG-002
  and downloads the result. About five cents.
- **Alternatives:** Build the UI first and discover fidelity or fetch problems on day two.
- **Why:** Two unverified risks sit under the whole design: the photo host's 403 to script
  clients, and whether `image_edit` keeps a glazed ceramic recognisable. Both are cheaper to
  learn now.
- **Cost accepted:** A few cents and twenty minutes.
- **Revisit trigger:** n/a.

## D6 — One long-running Node service on Railway, SQLite + volume for images (2026-09-03)

- **Decision:** Next.js in a single always-on Node process on Railway. SQLite (better-sqlite3,
  WAL mode) and images both live on one mounted volume. An in-process loop polls Luma.
  Scheduled daily Railway volume backups. Luma output requested as JPEG to keep candidates
  around half a megabyte. All disk access goes through one small storage module.
- **Alternatives:** (A) Vercel + Supabase: serverless functions, managed Postgres and
  Storage, pg_cron calling a tick endpoint. (C) Cloudflare Workers + D1 + R2 with cron
  triggers. (B2) Hybrid: SQLite on the volume, images in R2 from day one.
- **Why:** The Luma Agents API has no callbacks, so something must poll; a long-lived
  process makes that one `setInterval` instead of three triggers across two vendors. The
  customer is six people and about 300 products and will never need a second instance. One
  vendor, one process, one env file is the right operational surface for a team with no
  engineer on staff. Files on a disk match their mental model of "a folder", and the zip
  export is a directory walk.
- **Cost accepted:** Single instance by construction (Railway volumes cannot attach to
  replicas). Images served by the app, not a CDN. 5 GB on Hobby (50 GB Pro, live resize).
  Restore is a few clicks, not automatic failover; worst case with daily backups is one day
  of approvals, and approved files also exist in Drive after each export. About $5/month.
- **Scaling plan, in order:** (1) volume past 60 percent: prune rejected candidates older
  than 30 days, then resize or move to Pro. (2) Site wants to hotlink images, or a second
  instance is needed: move images to R2 or S3 with a one-off copy job and swap the storage
  module. (3) Only if concurrent writers ever matter: SQLite to Postgres. Nothing in the
  schema or routes assumes a single machine except the storage module.
- **Revisit trigger:** Volume past 60 percent, a request to serve images straight to the
  storefront, or headcount that makes a second instance plausible.
