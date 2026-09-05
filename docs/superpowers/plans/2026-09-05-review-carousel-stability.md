# Task 15 — Review flow: stable carousel, end card always, pending cues (D25)

From the user's test of PR #13 (2026-09-05). Branch `task/15-review-flow`, chained on
`task/14-motion`; one PR to main after #13 merges (or a combined review).

- [x] `byCreation` replaces `byReadingOrder` (lib/status.ts, test updated): oldest first, never
      re-sorted, so a decision never moves the card and the approval lands in place.
- [x] End card always the last slide once there is an idea and a candidate: done / photo /
      generating / open / needs more, with Try again, Generate N more, Next product and
      Change the idea on it. The header's More menu removed.
- [x] `components/Pending.tsx`: `Spinner` (LoaderCircle, `animate-spin`, still under reduced
      motion) and `SubmitButton` (`useFormStatus`: inert, `aria-busy`, ring + pending verb) on
      Approve / Reject (carousel and lightbox); the ring in GenerateProductForm, GenerateForm,
      ImportForm, IdeaForm.
- [x] Generating placeholder: ring, `.breathe` pulse, "This page updates itself."
- [x] `components/Refresher.tsx`: `router.refresh()` every 5 s while status is generating,
      paused when the tab is hidden, unmounted when nothing is in flight.
- [x] Contract (LoaderCircle), D25, STATE.
- [ ] Browser round → evaluator → Codex → PR → stop for review.
