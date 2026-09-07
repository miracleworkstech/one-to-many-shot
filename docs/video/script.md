# Video walkthrough: plan and draft script

Target 8:00. Part 1 (0:00 to 3:00) is for Maya and Ellie, in their words. Part 2 (3:00 to 8:00)
is the engineering review. Demo the live deploy, never localhost.

## Settled

- Live timing: a two-product round triggered at 0:30 so the Slack message lands on camera
  near 1:30. An earlier settled round is already in the database so the page is never empty.
- Phone footage: recorded on the iPhone (Loom app or screen recording) and cut in.
- Part 2 goes bird's eye first, then zooms in. The diagram supports, it doesn't lead.
- Numbers in Part 2 are the measured ones in APPROACH.md's unit economics table.
- The export is split in two for the demo: `docs/video/csv/1-before-recording-20.csv` (20 products,
  10 sheet ideas, the "do this one first" note) is imported before recording;
  `docs/video/csv/2-live-import-20.csv` (20 new products, 6 sheet ideas) is imported live.

## Part 1: for the team (0:00 to 3:00)

Rules: no tech product names, no "API", "database", "batch", "generate". Say "the sheet",
"shots", "a round", "the AI makes", "your phone", "Slack". Show every claim as you say it.

### 0:00 to 0:20. The problem

> You can't get styled shots made fast enough to matter, and nobody can say which ones are
> done. Forty products land next month and most of the catalog has never had one. Today it
> takes weeks, it comes back in a zip called final_v2_REAL_final, and last year the wrong
> file sat on a product page for three weeks. Here's a different way. It lives at one link,
> pinned in Slack. Nothing to install.

Screen: the Slack channel with the pinned link. Click it. The status page opens.

### 0:20 to 0:50. The sheet goes in, the ideas come out

> Maya, this is the sheet you already keep. Export it, drop it here.

Screen: Catalog in the header, upload `2-live-import-20.csv`. Twenty new rows appear.

> The shot ideas you wrote are kept exactly as written. The blank rows get a
> suggested idea, marked as suggested, and you can change any of them. Suggestions cost a
> fraction of a cent for the whole sheet. The shots are where the money goes, and none of
> that is spent until you say go. Ellie's note "bestseller, do this one first" moved that
> product to the front. Let's make shots for the next two.

Screen: open a suggested idea, edit one word, save. Tap Generate a batch, choose 2, go.

### 0:50 to 1:30. Where things stand, without asking Ellie

> While that works, this is the page Maya keeps open. One sentence: how many are done, how
> many are waiting on a decision, how many to go. The groups underneath are sorted by what
> happens next, so the top one is always the thing someone has to do.

Screen: the drop bar, "2 generating" with the spinner, the Needs a decision group open.

> Every image costs money and you don't want a round of back and forth to blow the budget.
> You can track your spend against a limit you set, and it can't go past it. If a round
> would, it tells you in plain words and makes nothing.

Screen: open Spend. Show total against the limit.

### 1:30 to 2:20. Ellie's phone

> When a round of images is ready for review, you'll get a message in Slack from the
> Dropshot app. One message for the round, not one per image.

Screen: the Slack message arrives: "2 products have new shots to approve or reject", with
a link.

> This part is Ellie's job. I'll tap the link.

Cut to phone recording.

> One product per screen. The original photo and the shot idea at the top so you remember
> what you asked for. Then the candidates, one at a time. Approve, or reject. Your tap is
> the decision.

Phone: approve one. Reject the other. Swipe.

> Not right? Try again with a note in your own words, "less steam, warmer light", and only
> that product is redone. Next to decide takes you to the next one. You can get through ten
> products in the time it takes to have a coffee.

Phone: Try again with a note. Next to decide.

### 2:20 to 2:50. Files with the right names

> Back on the status page, our approved product shots are ready to go. At the bottom:
> download the approved images. Every file is named by product and shot idea, so everyone
> knows exactly what the shot is at a glance. And the updated sheet, your columns plus a
> status and a link to each approved image, ready to go back where the sheet lives.

Screen: Files. Download approved images. Show the zip listing: HG-002-morning-kitchen-01.jpg.
Open the CSV, scroll to the new columns.

### 2:50 to 3:00. Close

> That's the whole thing. One link, one page for Maya, one tap for Ellie, and the drop
> launches with styled shots. Now the engineering.

## Part 2: engineering review (3:00 to 8:00)

Order: the whole flow and the data model first, then the runtime, then the money path,
then the decisions, then UX approach, then what's next. Zoom in, never jump in.

### 3:00 to 3:30. The shape, and the one I didn't build

Screen: the status page and the phone review page side by side.

> The brief reads like a spec. No dashboard to log into, nothing to install, and her tap is
> the decision. So it's one web page reached from one link Slack hands you, with the
> generation, the approvals and the files behind it. The alternative I took seriously was
> Slack native approval, buttons under each image. Same server, same database, different
> front. It lost on the review moment: comparing a candidate to the original photo and the
> idea, on a phone, in a feed. If the team ever says the link is one tap too many, that's
> the shape to move to, and the server doesn't change.

### 3:30 to 4:15. The whole flow, and what's in the database

Screen: `flow-workflow.html` (the six steps across four lanes), then `candidate-lifecycle.html` for the state ladder.

> From end to end: a CSV comes in and upserts products by SKU. Blank ideas get a suggestion.
> Someone taps Generate, which creates a batch and two candidates per product. A worker
> turns each candidate into a Luma job, waits for the image, and saves it. Slack gets one
> message when the batch settles. Ellie approves or rejects on her phone. The approved
> images and an updated CSV come back out.
>
> Four tables carry all of that. Products is the sheet, one row per SKU, with the idea and
> where it came from: sheet, suggested, or edited. Batches is one row per tap, with what it
> was estimated to cost. Candidates is the one that matters: one row per image, with the
> prompt, the Luma job id, the cost, and a state that moves queued, processing, completed,
> then approved or rejected, or failed. Settings is one row: whether the worker is paused
> and why. Everything on the status page is a query over those. Nothing is typed in by hand.

### 4:15 to 5:00. The runtime

Screen: `dropshot-architecture.html`, guided view "Trust boundaries".

> It's one Node process on Railway. Next.js with server actions for the two screens, SQLite
> in WAL mode, and the images on a mounted volume. There's no separate job server. Every
> five seconds the same web process runs one pass: it checks on the images Luma is still
> working on, sends the next queued ones up to the concurrency setting, and posts to Slack
> if a round has finished. Only one pass runs at a time, so a slow pass can't overlap the
> next. If the process restarts mid-round nothing is lost, because every image's state is a
> row in the database and the next pass picks up where the last one stopped. That's the
> trade I made: one deploy and nothing to operate, against one instance and, on the Hobby
> plan, no backup.
>
> Four things leave the container. Luma, which has no callbacks, so the worker polls.
> Claude Haiku, once per import, for the suggested ideas, with a template fallback if there's
> no key. A Slack incoming webhook. And the customer's own photo host, which returns 403 to
> anything that isn't a browser, so the fetch sends a browser user agent, and it refuses any
> address that resolves to private space so a CSV can't point the container at its own
> network. Access is one token for the whole team, checked by middleware on every route
> except the health check. The exported CSV's image links carry it so someone in Sheets can
> open an image.

### 5:00 to 5:45. The money path

Screen: on the live deploy, type a batch of 100 and let the in-flight cap refuse it. Then `money-path-workflow.html` for the gates.

> Maya said don't burn the budget, so everything that spends goes through one function.
> When someone taps Generate, one database transaction does four things. It reads what's
> in flight and what's been spent. It drops any product that already has work running. It
> refuses the whole batch if it would pass the in-flight cap or the spend cap, with the
> sentence you saw on the page. Otherwise it writes the batch and its candidates. Because
> it's one transaction, two taps at the same moment can't both slip under the cap. Cost is
> written at submission, not completion, so a failed generation still counts and the
> ledger never under-counts.
>
> The worker polls before it submits, so an out-of-credits answer pauses it before it
> spends anything new in that tick. That one came from a Codex review of the diff. Every
> Luma status and failure code maps to a typed code and one plain sentence: budget, auth
> and forbidden pause the worker, a rate limit backs off, everything else costs one of five
> attempts. Images are copied out the moment they finish, because Luma's URLs expire in an
> hour and a reviewer can be slower than that.

### 5:45 to 6:30. Decisions, and what they cost

Screen: the Spend sheet, then a row of the exported CSV.

> One shared token, no accounts: zero onboarding for six people,
> no per-person audit trail, and rotating it breaks the image links in every old export. A
> decided-by column already exists for the day a second approver arrives.
>
> The spend cap is lifetime, fifty dollars by default, not per drop. It covers the drop, the
> sixteen existing ideas, retries and most of a catalog pass. The second full pass hits it
> and every trigger is refused until someone raises the variable. A per-drop cap is one
> column on batches, and it earns its place the first time that number goes up.
>
> Slack stays a notification channel, not an input. The brief's problem was requests that
> lived in Slack and never made the sheet. This doesn't read Slack, so that can still
> happen. What it does is make the sheet and the Try again note the only two places an idea
> can live, and both are recorded.
>
> Delivery is a zip and an updated CSV, not a push into Drive or the storefront. The
> platform is unknown, and a Drive push needs OAuth consent from a six-person team. The web
> person's weekly upload stays. What's gone is the "which file is final?" question.

### 6:30 to 7:00. How I approached the two screens

Screen: the status page, then the phone review page.

> Each screen has one job. Maya's is "where do things stand"; Ellie's is "decide". So the
> status page is ordered by what happens next, with the thing someone has to do at the top
> and the passive states folded away, and the review page puts the context first, the
> original photo and the idea, then the decision, and nothing else on the screen. Every
> action gets feedback: a batch in flight shows and follows itself, a refusal says why, an
> approval lands where you tapped. Spend is always one tap away and never in your face.
> The aim is low friction and low cognitive load for the job at hand, and a tool the team
> trusts because nothing happens silently.

### 7:00 to 7:45. What I'd do next

Screen: the Spend sheet for the cost line, then `docs/video/next-slide.html` for the rest.

> Measured on the live deploy, one approved image costs about five cents and about a
> minute of machine time, plus fifteen seconds of Ellie's attention. At ten times the
> catalog the code holds and three settings move: the spend cap, the batch size and the
> concurrency. What doesn't scale is Ellie: twenty five hours of review per pass. That's a
> second approver problem before it's an infrastructure one.
>
> Engineering first. The volume is the only copy of every approval and there's no backup on
> Hobby, so a nightly copy to object storage is Monday. Then nobody is told when the worker
> pauses; a Slack post from the existing webhook, or a Railway log alert on the paused
> line, is ten lines. Then structured logs, one JSON line per tick outcome, so an alert can
> match on a code, and an uptime monitor on the health check.
>
> Product next. A per-drop cap. A second approver with named links, which is also the audit
> trail. Analytics as lines in the Spend sheet, from tables that already exist: approval
> rate by idea source, rejection rate by material, retries per product.
>
> Scaling, only at its trigger. Images to object storage when the storefront wants to
> hotlink or the volume fills. Postgres only when there's a second process writing, which at
> six people there isn't. A second instance last, because Railway volumes can't attach to
> replicas, so it needs the first two done and the worker's lock moved into the database.
> For this customer, never.

### 7:45 to 8:00. How I worked

Screen: `harness-workflow.html`, then one real PR with the evaluator verdict and the Codex notes.

> One plan, one branch per task. An implementer agent wrote the code, an evaluator agent
> mutation tested the diff, Codex reviewed it, and I reviewed the PR last. The tools wrote
> the code. The decisions, and the things I took out, were mine. Thanks for watching.

## Recording checklist

- Live deploy healthy, credits present, Spend shows headroom against the limit.
- Pre-state loaded: `1-before-recording-20.csv` imported, one settled round with a few decisions
  made, two ready products left with good ideas for the live round. `2-live-import-20.csv`
  on the desktop, ready to drop in.
- Slack channel open beside the browser with the team link pinned and the previous batch
  message visible; notifications audible or visible.
- Phone charged, Loom app or screen recorder ready, the team link visited once (cookie set).
- A settled zip and CSV from the earlier round on disk, in case the live round is slow.
- Part 2 tabs in order: status page, phone review page, `flow-workflow.html`,
  `candidate-lifecycle.html`, `dropshot-architecture.html`, the status page again for the
  refusal, `money-path-workflow.html`, the Spend sheet, exported CSV, APPROACH.md,
  `harness-workflow.html`, one PR. All diagrams are in `docs/architecture/`.
- Paste the final link into `video.md`.
