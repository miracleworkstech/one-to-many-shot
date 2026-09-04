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

## D7 — Cost ledger: every image carries its cost, every trigger is a batch (2026-09-03)

- **Decision:** `candidates.cost_usd` is written the moment Luma accepts a job (state becomes
  `processing`). A `batches` table records each trigger ("generate next N", "this product",
  "try again") with its estimate. `lib/analytics.ts` reports spend by outcome (approved,
  rejected or failed, pending), cost per approved image, approval rate, and estimate versus
  actual per batch. The CSV export carries spend per product. Two caps: images in flight
  (`MAX_IMAGES_IN_FLIGHT`, 40) and total spend (`MAX_TOTAL_SPEND_USD`, 25).
- **Alternatives:** Record cost at completion only. A separate ledger table per API call.
  No batch concept, just candidates.
- **Why:** Maya's "every image costs money, so don't burn our budget" is a total, not a
  per-batch number, and "where things stand" includes what it cost. Recording at
  acceptance is when money is committed; a failed generation still counts as spent because
  Luma's refund behaviour on failures is undocumented (conservative). Batches make the
  question "what did that tap cost" answerable.
- **Cost accepted:** Spend may be overstated by failed generations that Luma does not bill.
  One more table.
- **Revisit trigger:** Luma documents refunds on failures, or the team wants spend by
  person or by month, which is a query on the same data, not a schema change.

## D8 — Execution: implementer + evaluator subagent per task, Codex as final review (2026-09-03)

- **Decision:** Each plan task is built by an implementer subagent, checked by an evaluator
  subagent that invokes the project skill `evaluating-task`: runs the tests, mutation-tests
  every branch-bearing function (minimum three mutants per task), checks each Interfaces
  line, the invariants, the claimed money-path rows, and nine known agent anti-patterns
  (mock-testing mocks, missing error paths, hardcoded test data, over-mocking, type escape
  hatches, stale imports, missing cleanup, incomplete UI, accessibility gaps), and reports
  in a fixed contract. Then reviewed by the user in this session. A Codex review runs over
  the whole diff as the final pass before deploy.
  **Amended 2026-09-04 (user's call):** every task runs three checks in order, and each
  gates the next: (1) the implementer's own `npm run check`, (2) the Claude evaluator's
  verdict, which must be PASS, (3) a Codex review of the task diff (`codex:codex-rescue`,
  read-only). Codex runs only after the evaluator passes, never in parallel with it. Cheap
  Codex findings are fixed on the branch and re-checked; product-decision findings go to
  the user verbatim in the PR and the recap. Only then is the PR opened. Codex is part of
  validation, not of review: it finishes before the user sees the PR, and the user's review
  is the last gate before merge. The whole-diff Codex pass after Task 8 stays. Progress is tracked in `docs/STATE.md` so
  a fresh session can resume at the next task. Work happens in the main tree, no worktrees
  (tasks are sequential; a worktree per task adds a merge for no isolation).
- **Alternatives:** Inline execution in this session. Single subagent per task without an
  evaluator.
- **Why:** Fresh context per task keeps each subagent focused on one responsibility, the
  evaluator catches drift from the plan's interfaces, and a second model as reviewer is a
  genuinely independent check. Mutation testing is required because a baseline run of an
  evaluator without the skill (2026-09-03, on a fixture with deliberate gaps) found the
  static problems but never broke the code to see whether the tests noticed.
- **Cost accepted:** More tokens and wall-clock than inline. Reasoning is spread across
  subagent transcripts, so this session's log must summarise what each pair concluded.
- **Revisit trigger:** A task where the evaluator and implementer loop more than twice; then
  the task is under-specified and the plan gets fixed first.

## D9 — A PR and a human review gate between every task (2026-09-03)

- **Decision:** After the evaluator passes, the task branch is pushed and a PR to `main` is
  opened with both agents' summaries. The next task does not start until the user has
  reviewed and approved. Merge is fast-forward after approval.
- **Alternatives:** Auto-merge on evaluator PASS and continue (the D8 loop as first
  written). Batch several tasks per review.
- **Why:** The user owns decisions and wants to read the diff, not just the evaluator's
  verdict, before it lands. A PR gives a stable review surface and a CI result per task.
- **Cost accepted:** Wall-clock: each task waits on a human. Slightly more ceremony.
- **Revisit trigger:** Review turnaround becomes the bottleneck on day one; then batch
  low-risk tasks (2, 4, 7) into one PR.

## D10 — Import feedback is a client component; suggestions are chunked and warn, never block (2026-09-03)

- **Decision:** The import form is `components/ImportForm.tsx`, a client component using
  `useActionState` around a closure that calls `importCatalog(formData)`. It renders the
  counts and every row-level error from `parseCatalog`. The database work lives in
  `lib/import.ts` (`importCatalogRows(rows, suggest = suggestIdeas)`) so it is unit-tested
  against a real SQLite; `lib/actions/import.ts` is request glue only. Haiku suggestions go
  out in chunks of 50 products; a failed chunk falls back to templates for that chunk and
  logs a warning. An optional `ANTHROPIC_WORKSPACE_ID` is sent as the
  `anthropic-workspace-id` header because identity-linked keys are rejected without it.
- **Alternatives:** Keep the plain `<form action={importCatalog}>` from the plan (silent:
  a renamed column or a skipped row rendered a byte-identical page). Pass `importCatalog`
  straight to `useActionState` (needs the `(prevState, formData)` signature, breaking the
  declared interface). One unchunked Haiku request (truncates mid-JSON near ~150
  products, templating the whole catalog). Surface "model unreachable" in the UI (widens
  `suggestIdeas`' return type; deferred).
- **Why:** Maya must see what an import did (brief: "where do things stand"). Money path
  #9 needs the upsert testable in isolation. CLAUDE.md says name the ceiling at ~300
  products.
- **Cost accepted:** The form has no progressive enhancement: before hydration or with JS
  off the button is inert (React renders a throwing `javascript:` action for client
  closures). Every other screen needs JS anyway. When the Anthropic call fails the only
  signal is a server log line; the page shows template ideas labelled "suggested".
- **Revisit trigger:** A support question "why are all the ideas the same?" means surface
  the model-vs-template count in the import result. A slow-phone report of a dead import
  button means switch `importCatalog` to the `(prevState, formData)` signature.
- **Addendum 2026-09-04 (user's call on the Codex findings):** the sheet wins on
  re-import. A re-uploaded CSV overwrites an idea edited in the app and relabels it
  `sheet`, and any import re-suggests ideas for products whose idea was cleared in the
  app. Accepted because the material impact is small (a Haiku prompt's worth of cost,
  no candidate or approval is touched) and the export CSV carries edits, so the normal
  round trip keeps them. No version check.

## D11 — Every Luma response maps to a typed code and a plain-English message; bad credentials pause the worker (2026-09-04)

- **Decision:** `lib/luma.ts` throws one `LumaError` carrying `code` (typed union: auth,
  budget, forbidden, rate_limited, bad_request, not_found, upstream, timeout, network,
  invalid_response), `userMessage` (ours), `detail` (Luma's raw string, for logs),
  `retryable`, and `retryAfterMs` from the `Retry-After` header. `LumaBudgetError` and
  `LumaRateLimitError` stay as subclasses. Generation failures come back as
  `failure: { code, userMessage, retryable }` keyed on Luma's documented `failure_code`
  list. The worker (Task 5) pauses with a banner on 402, 401 and 403, not only 402.
- **Alternatives:** Keep the plan's two typed errors plus a generic `Error` (the worker
  would retry a revoked key five times per candidate and fail every batch with a log
  storm). Show Luma's `detail` string raw on the card (accurate, but "source: image
  exceeds 50 MB limit" is not what Ellie needs to read).
- **Why:** The brief's operator is not an engineer; the card and the banner are the only
  place an error is seen. The mapping is exact because Luma documents every status and
  `failure_code` (docs.agents.lumalabs.ai/guides/error-handling). Pausing on 401/403
  protects the attempt budget and spend from a wrong key, the failure we actually hit
  during Task 4.
- **Cost accepted:** A bigger error module than the plan had. Luma's wording changes are
  absorbed by `detail`, so a new `failure_code` shows as "Luma failed on its side" until
  the table is extended.
- **Revisit trigger:** A new `failure_code` appears in logs more than once.

## D12 — The Slack "ready to review" watermark is a candidate id, not a timestamp (2026-09-04)

- **Decision:** `settings` gains `last_notified_id`. `notifyIfBatchReady()` sends when nothing
  is queued or processing and the highest completed candidate id exceeds that watermark, then
  stores the new high-water mark (`last_notified_at` is left unwritten; nothing reads it). `lib/db.ts` adds the
  column with an inline `alter table` for databases that already exist.
- **Alternatives:** The plan's comparison of `last_notified_at` against `max(created_at)` of
  completed candidates. `datetime('now')` has one-second resolution, so a batch triggered in
  the same second as a notification would never be announced, and the case is untestable
  without sleeping. A `completed_at` column (a second schema change, only for this).
- **Why:** Notification is the only signal Ellie gets that there is work waiting; a silently
  dropped ping is a batch nobody reviews. Candidate ids are monotonic, and at the moment we
  notify every candidate is terminal, so the highest completed id is exactly the point the
  next message must start from.
- **Cost accepted:** One additive column and the first migration line in `lib/db.ts`.
  A ping lost to a Slack outage is not retried (the watermark moves anyway).
- **Revisit trigger:** A second schema change lands, which is when the inline `alter table`
  becomes a migrations table.
- **Addendum 2026-09-04 (Codex finding, accepted):** the message is per *settlement*, not
  per batch. If batch A completes while batch B is still processing, nothing is sent until B
  settles, and then one message covers both. For a six-person team on 40-product drops one
  message when the queue empties is the right amount of Slack; per-batch messages become
  worth it if two people start triggering batches independently.

## D13 — Decisions and per-product generation are split the same way as import (2026-09-04)

- **Decision:** The review page's writes follow the Task 3 shape. `lib/review.ts` holds
  `decideCandidate(id, state, who)` (the UPDATE, guarded to completed/approved/rejected)
  and the typed `DECISIONS` union; `lib/actions/review.ts` is request glue that validates
  the form and revalidates. `components/GenerateProductForm.tsx` is a client component
  around one server action, `generateForProduct`, so "generate 2 more" and "try again"
  show their cost on the button before the tap and the queued count or the cap refusal
  after it. A try-again whose enqueue is refused restores the idea it would have amended.
  The `IdeaForm` is keyed on the SKU and re-syncs its text when the stored idea changes,
  so a note appended by try-again, or another reviewer's edit, replaces the textarea
  instead of showing a stale "Save idea", while a plain save keeps the instance and can
  show "Saved". (Keying on the idea text itself remounted the form on every save.)
- **Alternatives:** The plan's inline `"use server"` closures on the page (they discard
  `EnqueueResult`, so a refused generate looks like nothing happened). SQL inside the
  action (untestable under node:test because `revalidatePath` needs a request context).
- **Why:** "No generation without a visible cost and a cap" needs the answer as well as
  the estimate, and money path #11 makes try-again its own batch. The split is what let
  the evaluator mutation-test the decision guard against a real database.
- **Cost accepted:** One more module than the plan's file structure lists; two client
  components instead of plain forms, so the buttons are inert before hydration.
- **Revisit trigger:** A third action needs the same shape, at which point a tiny helper
  for "server action returning a result to a client form" earns its place.

## D14 — The approved-images zip streams; the CSV's image links carry the team token (2026-09-04)

- **Decision:** `exportZip()` returns a `ReadableStream` built with fflate's streaming `Zip`
  and pass-through entries, reading one image file at a time, so peak memory is one image
  regardless of catalog size. The CSV's "Approved Images" links keep the shared `?k=`
  token so a Sheets user opens an image with no extra permissioning (A16).
- **Alternatives:** Keep the in-memory `zipSync` with a named ceiling (about 900 MB peak
  for 300 products × 3 approved at 0.5 MB, twice that with the route's copy). A `since`
  date to scope the zip to the week's approvals. A byte cap that refuses large exports.
  Per-user links or signed image URLs instead of the team token.
- **Why:** The user chose streaming: a small change that removes the ceiling rather than
  documenting it, for catalogs with many large images. Simplicity for the end user
  outweighs per-user permissioning at a six-person team.
- **Cost accepted:** The manifest CSV is still built in memory (kilobytes). The
  capability URL in a shared spreadsheet is only as private as the Drive folder it sits
  in; rotating `ACCESS_TOKEN` breaks links in old exports.
- **Amended 2026-09-04 (user's call):** the stream carries an exact `Content-Length` so
  browsers show a progress bar. With stored entries the zip layout is deterministic, so
  the size is computed up front from `fs.stat` sizes and name lengths (local header 30 +
  name, data, 16-byte descriptor; central entry 46 + name; 22-byte trailer) without
  reading a byte. Alternatives were spooling the zip to a temp file first (exact size,
  but no bytes until the whole zip is written and double disk I/O) or buffering again.
  Cost: the arithmetic depends on fflate's stored-entry format, so a test asserts the
  computed length equals the streamed byte count and pins the fflate version; anything
  over 4 GB (zip64) is refused with a clear message rather than miscounted. An image that
  disappears or changes size between planning and streaming errors the download (the
  browser sees a failed transfer) instead of quietly sending fewer bytes than promised.
- **Revisit trigger:** A request to hand a link to someone outside the team, which is when
  per-user or expiring links replace the shared token. A weekly hand-off that wants only
  new approvals, which is when the `since` filter earns its place.

## D15 — The access gate redirects to `APP_URL`, and the server exits when startup fails (2026-09-04)

- **Decision:** `middleware.ts` gates every route except `_next/`, `favicon.ico` and `healthz`
  (exact matches, not prefixes), accepts `?k=<token>` on any path because the exported CSV
  links images that way (D14), sets the token as a one-year httpOnly cookie and redirects to
  the same path with `k` removed, using the configured `APP_URL` as the origin. `APP_URL` is
  therefore required in production and must be a bare http(s) origin, checked by
  `assertProductionEnv()`. `instrumentation.ts` wraps the whole Node startup (env assertion,
  imports, `startWorker()`) and exits 1 on any throw. The runtime image runs as root.
- **Alternatives:** Build the redirect from `x-forwarded-proto` and `x-forwarded-host` (the
  first cut did; the evaluator showed a forged header turns the link into an open redirect
  for anyone holding the token). Leave Next's behaviour on a thrown `register()`: the
  standalone server logs "Failed to prepare server" and keeps serving 500s, so a Railway
  deploy with a missing variable sits unhealthy instead of restarting (verified in Docker).
  A hashed cookie value instead of the raw token. A non-root user in the image.
- **Why:** The team link is minted from `APP_URL`, so the redirect host matches by
  construction and nothing client-controlled reaches the `Location` header. Fail fast in
  production is a plan constraint and Railway's `ON_FAILURE` restart and healthcheck both key
  off a process exit. Railway mounts volumes root-owned, and a non-root user would need a
  chown step for `/data`; at six users on one container the isolation gain is nil.
- **Cost accepted:** A wrong `APP_URL` sends the team link to the wrong host; the deploy
  checklist's first step (open `APP_URL/?k=TOKEN`) catches it immediately. The cookie holds
  the same secret as the link (httpOnly, `secure` on https). The matcher test anchors the
  brief's regex source rather than driving Next's compiler (Codex finding, accepted: the
  compiled matcher was exercised live in the Docker check). The `process.exit` wrap is
  verified only by the Docker check, not a unit test.
- **Revisit trigger:** The app being reached at two hosts at once (custom domain plus the
  Railway default), when the canonical-host redirect becomes visible to the team. A request
  for per-user access, which is D14's trigger too. A Next upgrade that makes `register()`
  errors fatal, at which point the wrap can go.

## D16 — Photo URLs are checked against private address space, redirects included; the worker polls before it submits (2026-09-04)

- **Decision:** From the whole-codebase Codex pass after Task 8 (D8 step 6), the user chose to
  fix four of six findings. `photoUrlProblem()` in `lib/photos.ts` rejects a photo URL whose
  host is a literal loopback, link-local, private, carrier-grade NAT or translated-IPv4
  address, `localhost`, or carries credentials; it runs at import (the row is skipped with the
  reason) and again in `fetchPhoto`, on every redirect hop, with at most three hops. The
  generate form's estimate follows the chosen N. A generation that Luma fails with
  `budget_exhausted` pauses the worker like a 402 does, and each tick now polls processing
  generations before submitting queued ones, so that pause lands before new spend.
- **Alternatives:** Resolve DNS and check the resolved address (closes hostname-to-private
  and rebinding cases). An allow-list of photo hosts from the catalog. Leaving the estimate
  fixed at ten products. Keeping submit-before-poll.
- **Why:** The container fetches whatever URL a CSV names, so a CSV could point it at the
  container's own network; a literal-address check is a few lines and closes the cheap
  cases. The Global Constraint says every trigger shows its estimate, and the form let N vary
  without the estimate following. Money path #4 says exhausted credits pause the worker,
  whichever way Luma reports them.
- **Cost accepted:** A hostname that resolves to a private address, or rebinds after the
  check, still gets through (named in a `ponytail:` comment; DNS resolution is the upgrade).
  Findings 3 and 4 of that pass (approvals kept across a shot-idea change, and missing image
  files still counted as approved) stay as documented costs of D14 and money path #9, the
  user's call.
- **Revisit trigger:** A catalog whose photos live on a host we do not recognise, or the app
  ever running with access to anything on a private network worth protecting.

## D17 — A candidate remembers the idea it was generated with; approved filenames come from it (2026-09-04)

- **Decision:** `candidates.shot_idea` snapshots the product's shot idea at enqueue, next to the
  prompt built from it. `approvedByProduct` names each approved file from that snapshot, so
  editing the product's idea afterwards (review-page edit, re-import, a "try again" note) no
  longer renames files the team already downloaded. Rows generated before the column existed
  are backfilled once from the product's current idea, the best available guess. The user
  chose this over leaving finding 3 of the whole-codebase Codex pass as an accepted cost;
  finding 4 (missing image files still counted as approved) stays accepted.
- **Alternatives:** Store the full filename at approval (also freezes the `-01` number across
  un-approval). Mark approvals stale when the idea changes (turns a filename problem into a
  workflow question Ellie has to answer). Parse the idea back out of the stored prompt (fragile).
- **Why:** The brief's hand-off is a Drive folder of files whose names must stay meaningful
  and stable; a rename between two exports is the "which file is final?" confusion the build
  exists to remove. One nullable column and one read-side fallback is the smallest change
  that makes the name a fact about the candidate rather than about the product today.
- **Cost accepted:** Un-approving a candidate still renumbers the ones after it. The
  backfill is a guess for pre-existing rows (none in production yet: the volume is empty).
  Two additive columns now live inline in `db.ts`; a migrations table at the third.
- **Revisit trigger:** A request for stable numbering, or a third schema change.

## D18 — The review page leads with the candidate; Prev/Next live in a bottom bar, no auto-advance (2026-09-04)

- **Decision:** From the Impeccable critique of the review page (26/40, snapshot in
  `.impeccable/critique/`), the page is reordered to the task: header with status and
  "n to decide", product name, the shot idea as a read-only caption (editing behind a
  disclosure, open only when there is no idea yet), then candidates full-width with
  undecided ones first, then the spend actions as quiet outlined buttons, then the source
  photo. Prev/Next and "n of N" sit in a bar fixed to the bottom on phones. The user chose
  the bar over auto-advancing to the next SKU after the last decision. Try again now also
  appears for a failed candidate, and a photo-host failure says the fix is the link in the
  sheet. Decision buttons carry `aria-pressed` and a per-candidate label.
- **Alternatives:** Auto-advance on the last decision (one gesture fewer, but a decision
  Ellie did not make moves her page). Collapse decided candidates to a thumbnail strip
  (less scroll, but hides the change-your-mind path). Keep the generate button on top.
- **Why:** PRODUCT.md's principles: the image is the interface, status before action, money
  visible but never outranking the candidate. On a 375 px phone the first Approve moved from
  about 1100 px to the first screen.
- **Cost accepted:** The idea editor is one tap further away. The bar costs 50 px of the
  phone viewport. A 4:5 candidate leaves the first decision buttons a few pixels under the
  bar until the page is nudged.
- **Revisit trigger:** Ellie asks for swipe or auto-advance, or candidates come back in a
  taller aspect ratio than 4:5.

## D20 — One visual system for both pages; no price on trigger buttons; no names in the UI (2026-09-05)

- **Decision:** The cross-page consistency review after the two critiques (review page 28/40,
  status page 25/40) produced one direction contract for Tasks 12 and 13,
  `docs/superpowers/plans/2026-09-05-shared-visual-system.md`: one hue per meaning on marks
  only (green approved, red rejected or failed, amber waiting on a person), lucide-react at
  20 px for eleven named icons, no underlined links, native disclosures with chevrons, one
  radius, a four-step type scale, dates as "4 Sep" in `<time>`. Two changes of direction
  from the user: trigger buttons no longer show the estimate (reverses the "cost on the
  button" part of D18 and the CLAUDE.md invariant, now reworded), and no person's name
  appears in UI copy or code defaults. Spend moves fully behind a Spend disclosure on the
  status page. Task 12 ships first on `task/10-review-page`; Task 13 rebases after #11 merges.
- **Alternatives:** Keep the estimate only on the batch trigger (recommended by Claude, not
  taken). Keep the total visible as one line (not taken). Tinted group headings (not taken).
- **Why:** The brief's ask is a bound on spend, not a receipt per tap; the caps are the
  bound. Two pages built on separate branches were drifting on colour, links and dates; one
  contract now, DESIGN.md generated from what ships afterwards.
- **Cost accepted:** Nobody sees a dollar figure before a tap; the cap is not on the page
  surface. If Maya asks where the budget stands more than once, the one-line total returns.
  `decided_by` is null unless a name is supplied, so the audit trail loses "who" for now.
- **Revisit trigger:** A budget surprise, or a request for per-person accountability on
  approvals.

## D21 — A rejected candidate can be archived; it is a column, not a state (2026-09-05)

- **Decision:** `candidates.archived_at`, additive like `shot_idea`, set by an Archive button
  on a rejected slide. Archived candidates leave the review carousel; the state stays
  `rejected`, so status, spend and exports are unchanged and an "n archived" note keeps the
  count honest. Only a rejection can be archived. No un-archive yet.
- **Alternatives:** A seventh candidate state (a CHECK-constraint change, so a table rebuild,
  and every state switch gains a branch). Deleting the row (loses the spend record).
- **Why:** The user asked to clear clutter after rejecting; a nullable column is the smallest
  change that does that without touching the money ledger or the status ladder.
- **Cost accepted:** An archived rejection is invisible from the page; the CSV and the spend
  disclosure still count it. Un-archive is a follow-up if anyone asks.
- **Revisit trigger:** A request to see or restore archived candidates.

**Amended the same day:** Archive was replaced before it shipped. Rejections now leave the
carousel for a folded grid below it ("n rejected", closed by default, four thumbnails a row,
each with a quiet "Approve instead"), and the end card nudges "change the idea" once two
rounds have been turned down. Archive got worse as numbers grew (one tap per image, no way
back) and hid spend already paid for; the grid wraps to dozens and hides nothing. The
`archived_at` column was reverted before any deployment carried it.

**D20 amended (2026-09-05):** state labels are a coloured dot beside neutral text, not a
tinted pill with same-hue text (Tailwind's default badge, which reads as generated). The
hues are three theme tokens tuned to the stone neutrals, moss / clay / ochre, instead of
green / red / amber. `STATUS_TONE` names meanings (`wait`, `ok`, `stop`, `neutral`), not hues.
## D19 — The status page groups products by what happens next; counts live in the group headings (2026-09-04)

- **Decision:** `/impeccable layout app/page.tsx`. The page opens with one sentence
  ("1 of 40 done · 1 waiting for review · $0.35 of $25.00 spent"), then the products grouped
  by status in action order: waiting for review, needs more, generation failed, generating,
  ready to generate, needs an idea, done. Each group is a native `<details>` with its count in
  the heading; the actionable groups open by default, Done is closed. A group past 12 rows
  folds the rest behind "Show N more". The generate-next form lives inside "Ready to
  generate", capped at that count, with the estimate on the button. The seven count tiles
  and the standalone list are gone; spend and recent batches sit behind a disclosure; import
  and the two downloads sit last under "The sheet". An empty database shows only the import.
- **Alternatives:** Keep the flat list with a status filter (one more control, no grouping).
  Client-side pagination (JavaScript for what `<details>` does). Tabs per status (hides the
  whole picture Maya wants at a glance).
- **Why:** PRODUCT.md: status before action, the abandoned KPI dashboard as anti-reference,
  nothing to learn. The user named the problem: too much information, no hierarchy, no
  grouping or pagination. Native disclosures give grouping and paging with no client code.
- **Cost accepted:** A 300-product Done group still renders its rows into the DOM behind a
  closed disclosure (fine at this scale). "Show N more" is one fold, not real pagination.
- **Revisit trigger:** The catalog passes about a thousand products, or the team asks to
  search or filter.
