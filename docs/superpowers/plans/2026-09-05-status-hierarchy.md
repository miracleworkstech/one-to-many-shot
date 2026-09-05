# Task 13 — Status page: hierarchy, actions row, spend behind a disclosure (planned)

Agreed 2026-09-05 from the Impeccable critique of `app/page.tsx` (25/40, snapshot
`.impeccable/critique/2026-09-05T14-45-25Z__app-page-tsx.md`) and the user's review of PR #12.
Not started. Built on `task/11-status-page` before it merges, one commit per step, after the
cross-page consistency review settles the shared visual system with Task 12.

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
- **Colour on counts and marks only.** Amber = needs a person, red = broken, green = approved.
  Headings and rows stay neutral. One hue per meaning, shared with the review page.
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
