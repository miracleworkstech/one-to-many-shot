# Task 13 — Status page: hierarchy, actions row, spend behind a disclosure (planned)

Agreed 2026-09-05 from the Impeccable critique of `app/page.tsx` (25/40, snapshot
`.impeccable/critique/2026-09-05T14-45-25Z__app-page-tsx.md`) and the user's review of PR #12.
Ready to start (2026-09-05): #11 merged, `task/11-status-page` rebased onto it, the shared
contract is `docs/superpowers/plans/2026-09-05-shared-visual-system.md`. One commit per step.
Reuse from the review page: `STATUS_TONE` + a `Dot` beside neutral text (`app/review/[sku]/page.tsx`),
lucide at 20 px with `strokeWidth` 1.75, native `<details>` with a rotating chevron
(`.chevron` in globals.css), `PRIMARY` / `QUIET` button classes, no `$` on triggers, no names.

## Jobs on this page

1. Understand where the styled shots stand (Maya).
2. Get to the products that need a decision (Ellie).
3. Trigger a generation batch with the cost visible (Maya).
4. Download the approved images and the updated CSV (the web person). A main CTA.
5. Import a new export (whoever has it). Infrequent, urgent when it happens.
6. Keep spend from exhausting the budget. Secondary; total spend is the only number that
   matters day to day.

## Decisions taken

- **Header sentence is status only**: "1 of 40 done · 1 waiting for review". Spend leaves it.
- **Spend fully behind a disclosure** (user's call, over the option of one visible line). The
  disclosure heading reads "Spend"; inside, two sentences (total, per-outcome, per approved
  image, approval rate) and recent batches as one line each in the team's words, no table,
  no card, no batch kind, local time without seconds. The generate button keeps its estimate,
  which is what the money-path invariant requires; the cap is no longer on the page surface.
  Revisit if Maya asks where the budget stands more than once.
- **Action row under the header**, one 44 px row so Ellie's queue stays on the first screen:
  "Download N approved images" as the primary button (disabled with "No approved images yet"
  at zero), "Import CSV" as a secondary button that opens the file chooser, the updated CSV as
  a text link. "The sheet" section and the bottom import go.
- **Three tiers of groups.** Tier 1, Ellie's queue: Waiting for review, Needs more, with a
  heavier heading and an amber count. Tier 2, Maya's trigger: Ready to generate collapses to
  one line holding the form, "35 ready · Generate the next [10] · about $0.87", with its rows
  folded. Tier 3, passive: Generation failed (rare; red count so it is found when it
  happens and never looks like Generating), Generating, Done (closed).
- **Ellie sees a stated empty state**: "Nothing waiting for review" instead of a missing group.
- **Implementation details go.** The caps sentence is deleted. "Same columns as the export"
  goes; "Existing approvals are kept" stays as the file field's one helper line, because it
  answers the fear that stops a re-import. No tooltips: hover-only help is useless on a phone.
- **Colour as a dot beside the count, never a badge.** Ochre = needs a person, clay = broken,
  moss = approved, from the `@theme` tokens in `app/globals.css` (D20 amended). Headings and
  rows stay neutral. The paused banner uses `ochre-tint`, not amber-50.
- **Icons: lucide-react**, shared with Task 12. Chevrons on every disclosure (fixes the P0:
  flex on `<summary>` hides the native marker), an alert mark on Failed, download and upload
  marks on the two action buttons.
- **Headings for screen readers**: each group summary wraps a real `<h2>`; the file input
  gets a label; the summary sentence becomes a live region after a generate.

## Also from the critique

- Row idea lines keep the ellipsis; rows for Waiting show how many candidates wait.
- "(suggested)" dropped from rows (it matters on the review page, not here).
- Empty-catalog copy stops naming Maya.
- Hover state on summaries and links; the global focus ring from #11 applies once merged.

## Order of work

layout (tiers, action row) → clarify (headings, empty state, copy) → distill (spend prose)
→ quieter (delete the leaks) → typeset (icons, weights) → polish → browser round at 375×812
and desktop → evaluator → Codex → update PR #12 → stop for review.

## Not doing

- Tinted group headings (closer to the dashboard anti-reference).
- "Generate all 35" (the 40 cap and the default of 10 stand; revisit if Maya asks).
- Cancelling a queued batch (a worker feature, not a page feature).

## Amended 2026-09-05 after the user's review of PR #12 (D22)

Second critique: 27/40, one P0 (a product with a decidable candidate and a second batch in
flight was filed under Generating and missing from the header count). The user's notes:
stronger hierarchy and CTAs, no accordion stack, merge the two human-wait groups, rows with a
real affordance and no idea line, Spend as its own control with a popout, buttons aligned and
full width, Download beside Done. Agreed, with these amendments to "Decisions taken":

- **Three zones replace the tiers.** Zone 1 "Needs a decision" is a plain `<section>`, never a
  `<details>`: `toDecide > 0 || status === "needs_more"`, so a generating product with
  candidates to decide stays in the queue. Rows: name 16/500, SKU 12 px under it, one fact
  on the right ("2 to decide", "1 of 2 approved · try again"), a `ChevronRight`, 56 px,
  hover and active tints. Empty state stated in words. Zone 2 "Next batch" (the form, hidden
  when nothing is ready) then Ready, Generating, Failed, Needs an idea as `Folded` one-line
  counts at 14/500, closed. Zone 3 "Approved images N": Download primary + Updated CSV,
  stacked full width under 640 px, a two-column grid above; Done folded beneath.
- **Header controls, not an action row.** "Import CSV" and "$x.xx spent" as two `QUIET`
  buttons right of the title, each a native popover `.sheet` (bottom sheet on a phone,
  anchored panel on a laptop). The import sheet holds the file button, the helper line and
  the result; the spend sheet holds total first, two sentences, then batches newest first
  with 0-image batches dropped. The running total on the control amends D20.
- **Shared:** `components/buttons.ts` (`PRIMARY`, `QUIET`) used by both pages; the popover
  anchor is `--sheet` on both. `overview()` rows carry `approved` for the "1 of 2" fact.
- **Dropped from this plan:** the action row, the three tiers, the Spend disclosure, the
  "Nothing here." copy, the idea line on rows.
