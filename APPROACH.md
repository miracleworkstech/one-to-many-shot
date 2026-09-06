# APPROACH.md

> The reasoning behind each choice is in `DECISIONS.md` and the assumptions in
> `ASSUMPTIONS.md`.

**Live:** `https://one-to-many-shot-production.up.railway.app` on Railway. The way in is the
team link, pinned in the Slack channel where the batch messages land; visiting it once sets
a cookie and the site just works from then on. The token itself is not in this file because
the file is in git history forever and the link is a capability; it will be rotated after
the interview.

**Slack workspace invite:**
https://join.slack.com/t/miracleworks-group/shared_invite/zt-48ztgjq5u-2PCZLoKYdtQ7N2hyMw0NeA

## What I built and why

Dropshot: one small web app, reached from one shared link, that turns the Shot Idea column
of the catalog sheet into approved, correctly named images and hands them back as a zip and
an updated CSV. Two screens. No accounts, no install, nothing to learn. The name is the
team's "drop" and the brief's "shots" in one word (D30).

The team's own words drew the shape. "It has to work from my phone" and "I don't want to
install anything new" ruled out a dashboard with logins, a bot to learn, and a desktop
tool. The abandoned creative-automation dashboard was the anti-reference:
beautiful, and nobody logged in after week one. So the app has no home to log in to; it has
a link that Slack hands you when there is something to decide.

The workflow as it runs today:

1. **Import.** Maya uploads the export (same nine columns as `data/catalog.csv`) from the
   header of the status page. Rows upsert by SKU. A re-import updates the sheet's idea and
   never touches an approval. Rows with an unreachable or private-network photo link are
   skipped with the reason.
2. **Ideas.** The 16 sheet ideas are kept. The 24 blank rows get a suggested idea from
   Claude Haiku, labelled "suggested", editable, and free until someone generates. Notes
   like "El: bestseller, do this one first" set a priority flag; cautions like "smoke glass
   photographs badly" go into the prompt.
3. **Generate.** "Generate a batch" on the status page creates two candidates per product
   for the next N ready products, priority first, via Luma `uni-1` image edit with the
   white-background photo as the source. Admission control runs in one SQLite transaction:
   a product with work in flight is skipped, a batch past the in-flight cap or the spend cap
   is refused with the reason in plain words. A worker in the same process submits, polls
   (the Agents API has no callbacks), downloads finished images to the volume, and pauses
   itself when Luma says the account is out of credits.
4. **Notify.** One Slack message per settled batch through an incoming webhook: "12 products
   have new shots to approve or reject" and a link to `/next`, which lands on the first
   product needing a decision. Never a message per image.
5. **Review.** Ellie opens the link on her phone. One product per screen: the source photo
   and the shot idea for context, then the candidates one at a time with Approve and Reject
   under each. Rejections fold away below and can still be approved. "Try again" with a
   note regenerates that product only; "Next to decide" moves through the queue. Her tap
   is the decision; there is no other approval step.
6. **Status.** The same page Maya keeps open: one sentence and one bar for the drop (done,
   needs a decision, to go), "Needs a decision" open at the top, the next batch, then the
   passive groups. Spend is a header control with the total against the cap. "Download N
   approved images" at the foot returns a zip of files named like
   `HG-002-morning-kitchen-01.jpg`, plus a manifest; "Updated CSV" returns the original
   columns plus status and image links.

### Architecture

- **One Node process** (Next.js App Router, server actions) on Railway, always on. The
  generation worker is an interval inside it, single-flight, restart-safe because every
  candidate's state is in the database.
- **SQLite** (better-sqlite3, WAL) with four tables (`products`, `batches`, `candidates`,
  `settings`) and **images on a mounted volume** at `/data`. All disk access goes through
  one storage module. Scheduled volume backups are a Railway Pro feature and this runs on
  Hobby, so there is no backup yet; it is the first operational follow-up.
- **Luma Agents API** (`uni-1` image edit, JPEG). Our server fetches the reference photo
  with a browser user agent (the customer's host returns 403 to scripts) and sends it
  inline. Every Luma status and failure code maps to a typed code and a plain-English
  message; budget, auth and forbidden pause the worker, rate limits back off, the rest
  cost an attempt out of five.
- **Claude Haiku** for suggested ideas, one chunked call per import, template fallback
  without a key.
- **Slack incoming webhook.** It is a Slack app with one feature, posting to one channel,
  added to the workspace once. No bot, no scopes beyond that. Skipped silently if unset.
- **Access** is one unguessable token for the whole team, checked by middleware on every
  route except the health check, carried by the CSV's image links so a Sheets user can open
  an image.
- **Images** are kept twice on the volume: the original for the export and a smaller review
  copy for the phone.
- **Tests:** 180 in 22 files over the pure domain and the two money modules, mutation-tested
  by an evaluator agent per task, then a Codex review of each diff, then a human PR review.

## Key decisions and trade-offs

| Decision | What it buys | What it costs | Where |
|---|---|---|---|
| Web page, not a Slack bot | Big images, one product per screen, nothing to install | One screen outside Slack | D1 |
| One shared token, no accounts | Zero onboarding for six people | No per-person audit trail; the CSV carries the token; rotation invalidates old exports | D14 |
| Suggested ideas in v1 | The drop does not launch with sixteen shots | Haiku cost and a "suggested" label to explain | D2, D4 |
| Two candidates per product, staged batches | Spend is bounded and visible; Ellie sees a choice, not a wall | A hard product may take two rounds | D7 |
| Cost recorded at submission, images copied out at completion | The ledger never under-counts, and Luma's one-hour URL expiry never races a slow reviewer | A failed generation keeps its cost; rejected images sit on disk until pruned | D7 |
| A candidate remembers the idea it was generated with | Editing an idea later never renames files the team already downloaded | One more column; un-approving still renumbers | D17 |
| SQLite on a volume, one process | One deploy, no queue service, nothing to operate | One instance, no backup on the Hobby plan; scaling means Postgres first | D6 |
| Poll loop in-process | No cron, no second service | A restart delays a batch by a tick, never loses it | D6 |
| Photo fetch refuses private address space | A CSV cannot point the container at its own network | Hostnames that resolve privately still pass | code |
| Status grouped by what happens next | Maya and Ellie squint and see the bar, two open groups and one button | A folded strip of six headings | D19 |
| Slack links to the first product to decide | The tap lands on a decision, not on a list | Two redirects | D12 |

## The road not taken

**Slack-native approval.** A Slack app posting each product's candidates into a channel with
Approve and Reject buttons under every image, generation triggered by a slash command, and
the status question answered by a daily summary message. It is the strongest alternative
because it meets the team's words most literally: Ellie's phone already has Slack, the
install is one click for a workspace admin, and the batch notification and the approval
live in the same place, so there is no second surface at all. The money invariants are no
harder to hold; the bot is the same server with the same database, just a different front.

It lost on the review experience, which is the load-bearing moment. A channel is a feed: a
40-product drop with two candidates each is eighty images scrolling past, previews are
small and cropped, and a decision made on a thumbnail in a feed is the "no, too staged"
Slack thread the brief describes, only with buttons. Comparing a candidate against the
white-background photo and the shot idea means either three messages per product or a
modal, and Slack modals on a phone are a worse page than a page. Status at a glance does not
exist in a feed either; Maya would be scrolling for the last summary message. The brief's
own history says the team already had a Slack process and it lost the decisions; putting
the decisions in Slack with buttons keeps them findable but not scannable.

What it would have bought that the web page does not: zero links to pin, and a natural
place for a second opinion ("that one" as a thread reply). If the team says the link is one
tap too many, this is the shape to move to, and the server does not change.

## Scope ledger

**In**, with the requirement each serves:

- CSV import, idempotent by SKU, approvals preserved (new exports keep coming).
- Suggested ideas, free until generated (the drop is mostly blank rows).
- Batched generation with an in-flight cap and a lifetime spend cap, refusals in words
  (don't burn the budget).
- Priority from the notes ("do this one first").
- Phone-first review with approve, reject, approve-instead, try-again-with-a-note (her
  phone, her pick is the decision).
- One Slack message per settled batch (their tools, no noise).
- Status page grouped by what happens next, spend total against the cap (see where things
  stand without asking Ellie).
- Deterministic filenames, zip and updated CSV (no more `IMG_43xx.jpg`).
- Worker pause and resume on budget, auth and forbidden; typed Luma errors in plain English.
- Shared-link gate, Railway deploy with a volume, health check, fail-fast startup.

**Out.** Each row says whether it was cut by value or by time, because the brief asks.

| Cut | By | Why |
|---|---|---|
| Publishing to the product page | value | Platform unknown (Shopify? custom?). The web person's weekly upload stays; the "which file is final?" question is what we removed. |
| Pushing files into Google Drive | value | A zip the web person drops into the folder is one step and needs no OAuth consent from a six-person team. |
| Per-user accounts and named approvers | value | One approver by the brief's own words. `decided_by` exists for the day a second one arrives. |
| In-Slack approve buttons | value | A feed is not a contact sheet; see the road not taken. |
| Multi-product scenes and new angles | value | Fidelity first for a catalog whose glazes and materials are the product. |
| Parsing notes into rules | value | "Discontinued after spring?" is a question, not a flag. A human reads it at approval. |
| A spend cap per period or per drop | value | The cap is one lifetime number, $50 by default, which covers the drop, the sixteen existing ideas, a round of retries and most of a full catalog pass. A per-drop cap is one column on `batches`; it earns its place the first time the lifetime number is raised. |
| Per-drop zips and batch history on the page | time | Both are one query each. Acceptable for v1: the whole-catalog zip and the spend total cover the first drop. |
| A migrations table | time | Three additive changes live inline; the fourth gets the table (D17). |
| Pruning rejected images | time | Sixty kilobytes a rejection; the volume will not notice this year. |
| Volume backups | time and money | Scheduled backups are a Railway Pro feature; the app runs on Hobby. Until then the database and images are one disk with no copy. |

**Next**, in order, with the trigger that makes each worth doing:

1. Backups: the Pro plan's scheduled volume backup, or a nightly copy of the SQLite file
   and the approved images to object storage (before the drop; the volume is the only copy
   of every approval).
2. An external uptime monitor on `/healthz` (the first time the container stops taking
   traffic and nobody notices; Railway's own docs point at one).
3. Per-drop zip and a "Batches" line in the spend sheet (the second drop).
4. A second approver with named magic links (the first time Ellie is on holiday; `/next`
   then becomes a per-reviewer queue).
5. Product analytics beyond `/metrics` and the completion log line: approval rate by idea
   source and the other queries over tables that already exist (below).
6. Infrastructure, in this order and only at these triggers: a migrations table at the
   fourth schema change (three additive changes live inline today); images to object storage
   when the storefront wants to hotlink them or the volume passes 60 percent (a one-off
   copy and a swap of the storage module); SQLite to Postgres only if concurrent writers
   ever matter, which at six people they do not; a second instance last, because Railway
   volumes cannot attach to replicas, so it needs the first two done.

## Unit economics

Measured live: one product on 2026-09-04 (estimate and actual both $0.09) and a ten-product
batch on 2026-09-06, triggered and reviewed from a phone.

| Quantity | Value |
|---|---|
| Luma, per image | $0.0434 |
| Per product, two candidates | $0.09 |
| Ten products, twenty images | 5 min 20 s tap to last candidate, concurrency 4 |
| Throughput at concurrency 4 | just under 4 images a minute |
| Haiku ideas per import | under a cent |
| Railway, per month | about $5 |

**One approved image** costs `0.0434 × generated ÷ approved`. The Spend sheet computes it from
the ledger; until the first sixteen sheet ideas are reviewed the honest figure is a bound,
$0.04 (every candidate approved) to $0.13 (one in three). In minutes: about one of Maya's
per import, about fifteen seconds of Ellie's per candidate (assumed), sixteen seconds of
wall clock per image. The drop is eighty images in two batches (the in-flight cap is
forty): about 22 minutes of generation, about 20 minutes of Ellie's thumb.

| Scale | Products | One pass | Generation | Review |
|---|---|---|---|---|
| The drop | 40 | $3.50 | 22 min | 20 min |
| The catalog | 300 | $26 | 2.7 h | 2.5 h |
| 10× | 3,000 | $260 | 27 h | 25 h |

**At 10×** the code holds and the knobs move: the lifetime spend cap ($50 default), the
in-flight cap (batch size), `LUMA_CONCURRENCY` (throughput, bounded by Luma's rate limit).
The real limit is Ellie's 25 hours per pass, which wants a second approver and a "good
enough" rule before it wants any infrastructure. Storage is about 1.5 GB, fine on a volume;
the whole-catalog zip becomes a per-drop zip. Latency and throughput are read from
`/metrics` (behind the team link) and from one JSON log line per landed image, not from a
stopwatch.

## What breaks first under pressure

In the order I expect to hear about them.

1. **One process, one volume, no backup.** SQLite in WAL mode handles six people without
   noticing, but the volume is one disk with no backup on the Hobby plan, so a lost volume
   is every approval since the last export, and there is no second instance, so a Railway
   incident is downtime. Until a backup exists the updated CSV and the zip in the team's
   Drive are the copy; export after every settled batch. The order to scale is object
   storage for images, then Postgres, then a second instance.
2. **The lifetime spend cap.** The cap counts every dollar ever spent, so the second full
   catalog pass reaches $50 and every trigger is refused until someone raises the variable and
   the service restarts. Watch the total in the Spend sheet against the cap. The fix is a
   per-period or per-drop cap, one column on `batches`.
3. **The shared token.** It lives in the link, the cookie, the Slack message and every
   exported CSV. A forwarded CSV is a forwarded key. Rotating it invalidates every old export's
   image links (filenames in the zip keep working). Watch for the link outside the team's
   Drive. The fix is per-person links, which D14 already names.
4. **The photo host.** It serves a browser user agent today and 403s everything else. If it
   starts checking more than the user agent, every candidate fails at fetch with "photo not
   reachable", at zero cost, and the fix is to ask the team for the files.
5. **Fidelity.** `uni-1` image edit preserves the subject well for solid objects and worse for
   glass and fine texture, which the notes already warn about. Watch the rejection rate per
   material. The fix is prompt work first, a second model tier second.
6. **Ellie's queue.** Twenty images on a phone reviewed smoothly in the live test, so this is
   lower than I first put it. The ceiling is the drop: two batches settle and "Needs a
   decision" holds forty products with eighty images. The page copes; her afternoon does
   not. Watch the age of the oldest undecided candidate. The fix is product, not code: batch
   size matched to her day, and a second approver.

## Operating it

None of the additions below are built. Each is named with the trigger that makes it worth
doing.

**Logging and monitoring.** Today: one log line per event that matters (worker paused with
its typed reason, a tick that threw, a rate limit, a failed download, a Slack or suggestion
or export failure), readable in Railway's log view; a paused banner with a Resume button on
the status page; a health check that gates each deploy and a startup that exits on a
missing variable. The gaps, in the order they would hurt:

1. Nobody is told. A pause is seen only by someone who opens the page. Railway log alerts
   on the paused and tick-error lines, or a post to the existing Slack webhook.
2. Logs are prose. One JSON line per tick outcome so an alert can match on a code.
3. No request logging. Railway's HTTP metrics first; a request id in action logs after.
4. No exception tracker. Worth a day the first time an error repeats across users.
5. Nothing outside the process. An external uptime monitor on `/healthz`.

**Product analytics.** No event rows; every question is a query over existing tables.
`/metrics` and the per-image log line already give Luma latency, decision latency, batch
wall clock and images per minute. Next, as lines in the Spend sheet, not a dashboard:
approval rate by idea source (needs the source snapshotted on the candidate), retries per
product, rejection rate per material, products stuck in "needs more".

**Security.** Today: one token in an httpOnly cookie, every route gated, redirects built
from the configured origin, photo fetches refused into private address space, upload and
photo size caps, CSV formulas neutralised, no names in the UI. Next: per-person links (also
the audit trail), a rate limit on import and generate, token rotation that regenerates the
exports.

**Scaling.** Ceiling named: six people, 300 products, drops of forty, one process, one
volume. In order, each at its trigger:

1. Knobs: concurrency, in-flight cap, spend cap. All environment variables.
2. Prune rejected images past 60 percent of the volume.
3. Images to object storage when the storefront wants to hotlink or the volume fills. One
   copy job and a swap of the storage module; also what frees the volume for step 5.
4. SQLite to Postgres only for concurrent writers from more than one process. Migrations
   table first, then the driver.
5. A second instance, after 3 and 4, with the worker's single-flight lock moved into the
   database. For this customer, never.

The step this order refuses early is the database: Postgres first buys nothing for a year
and adds a vendor for a team with no engineer.

**CI/CD.** Today: a pre-commit hook and GitHub Actions both run typecheck, lint, format and
tests (Actions adds the production build); every task went branch, evaluator, Codex, human
PR review; Railway builds the Dockerfile on every push to main; rollback is a redeploy of
the previous image. For a larger team: branch protection on the check, a staging service
with its own volume and a throwaway Luma key, preview environments per PR, a migrations
table before the fourth schema change, a post-deploy smoke that imports the sample CSV. Not
a release train: with one process and one database, deploying is cheap and rolling back is
cheaper.

## Running it

`npm install && npm run prepare && npm run dev` on http://localhost:3000; `npm run check`
is what the hook and CI run. Variables are listed in `.env.example`. Production is the
Dockerfile on Railway with a volume at `/data`, `APP_URL` set to the public origin and
`ACCESS_TOKEN` minting the team link; `/healthz` is the health check and `/metrics` the
performance JSON, both documented above.
