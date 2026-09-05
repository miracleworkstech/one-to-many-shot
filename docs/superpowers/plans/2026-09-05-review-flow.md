# Task 12 — Review flow: carousel, pinned context, follow-ups behind a menu (planned)

Agreed 2026-09-05 from the second Impeccable critique of `app/review/[sku]/page.tsx`
(28/40, snapshot `.impeccable/critique/2026-09-05T14-04-22Z__app-review-sku-page-tsx.md`)
and the user's own review of PR #11. Not started. Branch `task/12-review-flow`, one commit
per step, after #11 and #12 merge and the two pages' findings are reviewed together for a
consistent approach.

## Jobs to be done, in order of frequency

1. Review candidates against the shot idea and decide.
2. Generate candidates for a product that has none.
3. Follow up: change the idea, or ask for another set after seeing results.

## Decisions taken

- **Pinned context strip.** Under the header, sticky: the source product photo as a 48 px
  thumbnail and the shot idea beside it. Both things Ellie compares against stay on screen
  through every candidate. The source-photo section at the bottom and its sentence go.
- **Inline idea editing.** The caption *is* the textarea: styled as text, no border until
  focus, Save appears only when the text differs from what is saved. The "(suggested)" mark
  stays as a small prefix. The `<details>` editor goes; no more duplicated text.
- **Carousel.** One candidate per slide, CSS `scroll-snap`, no JavaScript. Each slide holds
  the image and its own Approve/Reject, so the decision is always under the image it belongs
  to. A visible "2 of 3" counter and a peek of the next slide's edge, so off-screen candidates
  are discoverable. Slide height capped at 60 vh so image + buttons fit one screen at any
  aspect ratio. Reading order inside the carousel stays `byReadingOrder`.
- **Follow-ups behind a More menu, surfaced at the end slot.** Try again (with its note) and
  Generate more move into a header "More" control using the native popover API, hidden
  during review. The last carousel slot is an end card: when every candidate is decided and
  fewer than two are approved it offers "Nothing approved yet. Say what to change and try
  again · $0.09" inline; when the second approval lands it says "Done · 2 approved" with
  Next. **Generate more stays available on a Done product** (user's call): two approvals is a
  soft status and the team may want more variations for other purposes. It lives in the menu
  there, not in the end card.
- **Icons: lucide-react**, the repo's first icon dependency. Exactly: back arrow, previous
  and next chevrons, edit pencil, the More control, and check / cross on the pressed decision
  states. Approve and Reject keep their words; icon-only is allowed only where an
  `aria-label` names the action (chevrons, More).
- **Navigation links** lose the underline: medium weight, icon + label, pill hit areas on the
  fixed bar with Next at least 88 px wide.
- **Bar collision.** Reserve the bar's height with scroll padding and size the slide to the
  viewport minus the bar, so the first decision is never under the bar or below the fold.

## Also from the critique, folded into the same branch

- A live region announcing "Approved" / "Rejected" after a decision; `alt` on a candidate
  carries the idea, not only the id; the status pill gets a name.
- One corner radius, one input style, an `active:` state on the decision buttons.
- Failed and generating cards share one height.
- The "re-import" hint links to the status page.
- "(suggested)" shown once.

## Order of work

shape (carousel + end card) → layout (context strip, inline idea) → clarify (More menu,
end-card copy) → typeset (icons, links) → harden (bar, live region, alt) → polish → browser
round at 375×812 and desktop → evaluator (`evaluating-task`) → Codex → PR → stop for review.

## Not doing

- Auto-advance to the next SKU (D18 stands; the end card offers Next instead).
- Swipe-to-decide gestures (a swipe already means "next candidate" in the carousel).
- A thumbnail strip of decided candidates (the carousel makes it unnecessary).
