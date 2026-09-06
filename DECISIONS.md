# DECISIONS.md — decision log

One entry per consequential choice: Decision / Alternatives / Why (tied to a requirement) /
Cost accepted / Revisit trigger. Assumptions made because the brief was silent live in
`ASSUMPTIONS.md`. Entries keep their original numbers; the gaps were implementation-process
and UI-detail decisions, pruned on 2026-09-06 and kept in git history and the session logs.
Where an entry was amended, only the latest state is shown.

---

## D1 — Product shape: the sheet is the product, approval is a web page (2026-09-03)

- **Decision:** CSV in, generation in bounded batches, one Slack message per settled batch,
  approval on a phone-first web page reached from that message, status on the same page,
  an updated CSV and a zip of approved images out.
- **Alternatives:** A Slack-native bot with approve and reject buttons. An email digest with
  reply-to-approve. A Google Sheet with Apps Script.
- **Why:** Ellie's constraints ("from my phone", "don't install anything") and the dashboard
  they abandoned. A page that arrives as a link with one job is not a destination to
  remember. The Slack bot is the strongest alternative and loses on the review moment: a
  feed of eighty small previews is not a contact sheet, and status at a glance does not
  exist in a channel. Email is the process they are escaping.
- **Cost accepted:** One screen outside Slack. Approvals are not in-thread.
- **Revisit trigger:** Ellie stops opening links within a day of the message, or the team
  asks for in-Slack buttons. The bot then sits on top of the same server.

## D2 — Suggested shot ideas are in scope (2026-09-03)

- **Decision:** Rows with no Shot Idea get a suggested one, labelled and editable, at no
  cost until someone generates.
- **Alternatives:** Generate only for human-written ideas. Leave blanks blank.
- **Why:** 24 of 40 rows are blank and the drop will arrive mostly blank. Without
  suggestions the turnaround is "wait for Ellie to think of 40 ideas".
- **Cost accepted:** An LLM call at import. Generic ideas sometimes; that is what edit is for.
- **Revisit trigger:** Suggested ideas are rejected at a much higher rate than sheet ideas.

## D3 — Delivery is a zip plus an updated CSV, not a Drive push (2026-09-03)

- **Decision:** Approved images download as a zip with deterministic SKU-based filenames;
  the CSV export carries status and image links. No Google Drive integration.
- **Alternatives:** Push files into the shared Drive folder via a service account.
- **Why:** The pain in the brief (the wrong `IMG_43xx.jpg` shipped) is a naming and
  provenance problem, which the filenames solve. A Drive push needs a service account the
  team must create and share a folder with; dropping a zip in Drive is a step they already do.
- **Cost accepted:** One manual step. Our storage and Drive can drift if someone renames.
- **Revisit trigger:** "Which file is final?" is asked again, or the team wants the folder
  to fill itself.

## D4 — Claude Haiku writes the suggested ideas (2026-09-03)

- **Decision:** One chunked Haiku call per import proposes ideas for blank rows from name,
  category, color, material and notes. A category-template fallback runs without a key.
- **Alternatives:** Templates only.
- **Why:** Templates read as generic across 300 products; ideas that name the actual
  product get accepted more and edited less. The cost is noise next to images.
- **Cost accepted:** A second external API and key, and a fallback path.
- **Revisit trigger:** Suggestions need editing more often than not.

## D6 — One always-on Node service on Railway, SQLite and images on one volume (2026-09-03)

- **Decision:** Next.js in a single process on Railway. SQLite (WAL) and JPEG images on one
  mounted volume, all disk access through one storage module. An in-process loop polls Luma.
- **Alternatives:** Vercel plus Supabase (serverless, managed Postgres and storage, cron
  calling a tick). Cloudflare Workers plus D1 and R2. SQLite on the volume with images in R2
  from day one.
- **Why:** The Luma Agents API has no callbacks, so something must poll; a long-lived
  process makes that one interval instead of three triggers across two vendors. Six people
  and 300 products will never need a second instance. One vendor, one process, one env file
  is the right surface for a team with no engineer. Files on a disk match "a folder".
- **Cost accepted:** Single instance by construction (Railway volumes cannot attach to
  replicas). Images served by the app, not a CDN. 5 GB on Hobby. **No backups** (amended
  2026-09-06): scheduled volume backups are a Pro feature and the service runs on Hobby, so
  the volume is the only copy; the exported CSV and zip in Drive are the copy until Pro or a
  nightly copy job, which is the first operational follow-up. About $5 a month.
- **Scaling order:** knobs (concurrency, caps), worker parallelism, prune rejections at 60
  percent of the volume, images to object storage when the storefront wants to hotlink or
  the volume fills, SQLite to Postgres only for concurrent writers, a second instance last.
- **Revisit trigger:** Volume past 60 percent, a hotlink request, or headcount that makes a
  second instance plausible.

## D7 — Every image carries its cost, every trigger is a batch, two caps (2026-09-03)

- **Decision:** `candidates.cost_usd` is written the moment Luma accepts a job. A `batches`
  table records each trigger with its estimate. Spend is reported by outcome (approved,
  rejected or failed, pending), with cost per approved image and approval rate. Two caps:
  images in flight (`MAX_IMAGES_IN_FLIGHT`, 40) and lifetime spend (`MAX_TOTAL_SPEND_USD`,
  50 since 2026-09-06). Admission runs in one SQLite transaction; a product with work in
  flight is skipped, a batch over either cap is refused with the reason.
- **Alternatives:** Record cost at completion. No batch concept.
- **Why:** "Don't burn our budget" is a total, and "where things stand" includes what it
  cost. Acceptance is when money is committed; a failed generation keeps its cost because
  Luma's refund behaviour is undocumented. Batches make "what did that tap cost" answerable.
- **Cost accepted:** Spend may be overstated by failures Luma does not bill. The cap is
  lifetime, so it must be raised by hand as the catalog is worked through.
- **Revisit trigger:** The lifetime cap is raised for the first time; then a per-drop cap,
  one column on `batches`.

## D11 — Every Luma response maps to a typed code and a plain-English message (2026-09-04)

- **Decision:** One `LumaError` with a typed `code`, our `userMessage`, Luma's raw `detail`
  for logs, `retryable` and `retryAfterMs`. Generation failures map Luma's documented
  `failure_code` list the same way. The worker pauses with a banner on budget, auth and
  forbidden; backs off on a rate limit; counts retryable errors as attempts out of five;
  fails a candidate with its reason on the rest.
- **Alternatives:** Two typed errors plus a generic one (a revoked key would be retried five
  times per candidate). Show Luma's raw string on the card.
- **Why:** The operator is not an engineer; the card and the banner are the only place an
  error is read. Pausing on a bad key protects the attempt budget and spend, the failure we
  actually hit.
- **Cost accepted:** A bigger error module. A new `failure_code` reads as "Luma failed on
  its side" until the table is extended.
- **Revisit trigger:** A new `failure_code` in the logs more than once.

## D12 — One Slack message per settlement, watermarked by candidate id (2026-09-04)

- **Decision:** The message sends when nothing is queued or processing and the highest
  completed candidate id exceeds `settings.last_notified_id`. It is per settlement, not per
  batch: if batch A completes while B is processing, one message covers both when B settles.
  The message links to `/next`, the first product needing a decision.
- **Alternatives:** A timestamp watermark (one-second resolution swallows a batch triggered
  in the same second). Per-batch messages.
- **Why:** The message is the only signal Ellie gets; a dropped ping is a batch nobody
  reviews. Ids are monotonic. One message when the queue empties is the right amount of
  Slack for six people.
- **Cost accepted:** A ping lost to a Slack outage is not retried. Per-batch messages become
  worth it if two people trigger batches independently.
- **Revisit trigger:** Two people triggering batches at once.

## D14 — One shared token for the team; the CSV's image links carry it (2026-09-04)

- **Decision:** One unguessable token, set as a one-year httpOnly cookie on the first visit
  to `APP_URL/?k=<token>`, checked by middleware on every route except the health check.
  The exported CSV's image links carry the token so a Sheets user can open an image. The
  gate builds its redirect from the configured `APP_URL`, never from forwarded headers.
- **Alternatives:** Per-user links or accounts. Signed image URLs in the CSV.
- **Why:** Zero onboarding for six people who already share a Drive folder. Forwarded
  headers would make the redirect an open one for anyone holding the token.
- **Cost accepted:** No per-person audit trail. A forwarded CSV is a forwarded key. Rotating
  the token breaks the links in old exports (filenames in the zip still work).
- **Revisit trigger:** A second approver, or the link seen outside the team's Drive.

## D17 — A candidate remembers the idea it was generated with (2026-09-04)

- **Decision:** `candidates.shot_idea` snapshots the product's idea at enqueue. Approved
  filenames come from that snapshot, so editing the idea later never renames files the team
  already downloaded.
- **Alternatives:** Store the full filename at approval. Mark approvals stale when the idea
  changes.
- **Why:** The hand-off is a folder of files whose names must stay meaningful and stable; a
  rename between exports is the "which file is final?" confusion the build exists to remove.
- **Cost accepted:** Un-approving still renumbers the candidates after it. Two additive
  columns now live inline in `db.ts`; the third gets a migrations table.
- **Revisit trigger:** A request for stable numbering, or a third schema change.

## D19 — The status page groups products by what happens next (2026-09-04, final form 2026-09-05)

- **Decision:** One status line and one bar for the drop (done, needs a decision, to go);
  "Needs a decision" first and open, holding any product with a candidate to decide
  whatever its lifecycle status; then the next batch with the generate control; then the
  passive states folded; "Download N approved images" as the one call to action at the
  foot. Lists page at six rows. Import and Spend are header controls opening sheets; the
  spend sheet shows the total against the cap. No estimate on trigger buttons; no person's
  name in the UI.
- **Alternatives:** Seven count tiles and a flat list. A segmented filter. Tabs per status.
  Prices on every button.
- **Why:** Maya sees where the drop stands and what it cost without asking; Ellie gets to
  what needs her decision. The abandoned KPI dashboard is the anti-reference. Maya's ask is
  a bound on spend, not a receipt per tap; the caps bound and the total reports.
- **Cost accepted:** Passive states are disclosures. Pagination reloads the page. Nobody
  sees a dollar figure before a tap; the total is one tap away.
- **Revisit trigger:** A request to search or filter, or a budget surprise.

## D21 — Rejections fold into a grid below the carousel (2026-09-05)

- **Decision:** Rejected candidates leave the carousel for a folded grid below it, each
  still approvable. An Archive button was built and replaced before it shipped.
- **Alternatives:** Archive (one tap per image, no way back, hides spend already paid for).
  A seventh candidate state. Deleting the row.
- **Why:** Clear the clutter after rejecting without touching the money ledger or the
  status ladder, and keep the change-your-mind path.
- **Cost accepted:** A long grid on a product with many rounds.
- **Revisit trigger:** A request to hide rejections for good.

## D29 — Not built: a Slack post on pause, worker liveness in `/healthz` (2026-09-06)

- **Decision:** Neither is built. The paused banner on the status page is the surface.
- **Why:** Railway calls the health check once at deploy and does not poll it, so a
  liveness endpoint restarts nothing. Every await in a tick is synchronous SQLite or a fetch
  with a timeout, so the hang it would catch cannot occur. The two real failures, a pause
  and a slow Luma, both land on the status page.
- **Cost accepted:** A pause mid-batch is silent until someone opens the page.
- **Revisit trigger:** A pause the team did not notice for a day; then the post to the
  existing webhook, ten lines.

## D30 — The product is called Dropshot (2026-09-06)

- **Decision:** The team's "drop" and the brief's "shots" in one word. The name lives in one
  constant; the mark is a photo frame with one shot landed in it, in the moss that already
  means approved.
- **Alternatives:** Contact Sheet, Proofs, Picks, "Styled Shots".
- **Why:** A finished product has a name people can say in Slack.
- **Cost accepted:** `package.json` still says `shots`.
