# Task 20 — First arrival: purpose line, `/next` deep link, "Next to decide" (D28)

From the `/impeccable onboard & clarify` journey review (2026-09-06). Branch
`task/20-first-arrival` from main (worktree `../lumalabs-task20`). One PR to main.

Journey reviewed: someone joins the Slack workspace, taps the batch message, lands on the
status page, taps a row, decides, comes back. Findings: nothing says what the app is; the
Slack link lands on the overview, not the queue; after a product settles, "Next product"
walks the catalog rather than the queue; the 401 names people; the header's "CSV" hides
both directions.

- [x] `lib/queries.ts`: `needsDecision(row)` moves out of `app/page.tsx` (same predicate:
      `toDecide > 0 || status === "needs_more"`), and `nextToDecide(): string | null`
      returns the first queue SKU in the list order (`overview()` rows) or `null`. Test.
- [x] `app/next/route.ts`: `GET` redirects (302, no caching) to `/review/<sku>` from
      `nextToDecide()`, or to `/#decide` when the queue is empty. `dynamic = "force-dynamic"`.
      Gated by the existing middleware (no matcher change; `/next?k=…` sets the cookie and
      lands on `/next`). Test the two branches.
- [x] `lib/notify.ts`: the Slack message becomes
      `"12 products have new shots to approve or reject: ${appUrl}/next?k=${token}"`
      (singular: "1 product has new shots …"). Update the worker test's two regexes.
- [x] `app/page.tsx`: one permanent line under the h1, `text-sm text-stone-600`:
      "Shot ideas from the catalog sheet, made into images by Luma. Approve the ones that
      match." Shown with products and in the empty state (above the import prompt). The
      header button label "CSV" becomes "Catalog" (the sheet's aria-label stays "Catalog CSV").
- [x] `app/review/[sku]/page.tsx` end card, `endKind === "done"`: "Next product" becomes a
      link to `/next` labelled "Next to decide" when another product is in the queue, else
      a link to `/` labelled "Back to the drop". Needs a boolean from `productDetail` or a
      separate `nextToDecide()` call excluding the current SKU (the current product is done,
      so it is not in the queue; a plain call is enough). Footer Prev/Next unchanged.
- [x] `middleware.ts` 401 body: "This page needs the team link. Open it from the link
      pinned in Slack." Update the middleware test.
- [x] D28 in DECISIONS.md, ASSUMPTIONS row 20 (team link pinned in the Slack channel),
      STATE.md, this file's boxes.
- [x] Evaluator (`evaluating-task`, two rounds: FAIL on the end-card self-loop, then PASS).
- [ ] Codex review (blocked: Codex CLI 0.144.4 is too old for its default model) → PR → stop for review.
