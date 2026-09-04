---
target: app/review/[sku]/page.tsx
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
target_identity: "file:C:\\Users\\mirac\\Documents\\lumalabs-eng-take-home-13ed13959e5ba3e7acc72a8a9f41ecd409620c80\\app\\review\\[sku]\\page.tsx"
target_fingerprint: "sha256:89f41497aa4f509c614d3f13fcb9112b4f25e6bce1dca2a52ab61089cc591851"
target_path: "C:\\Users\\mirac\\Documents\\lumalabs-eng-take-home-13ed13959e5ba3e7acc72a8a9f41ecd409620c80\\app\\review\\[sku]\\page.tsx"
timestamp: 2026-09-04T16-43-40Z
slug: app-review-sku-page-tsx
---
Method: dual-agent (A: design-review subagent · B: detector+browser subagent)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Chip says "Waiting for review" but not how many candidates remain; no position in the drop |
| 2 | Match System / Real World | 3 | Byline prints the raw enum and a raw UTC datetime ("rejected by Ellie · 2026-09-04 14:03:40 UTC") |
| 3 | User Control and Freedom | 3 | Decisions reversible, but no un-decide and Try again spends $0.09 with no confirm |
| 4 | Consistency and Standards | 2 | Three button idioms on one page; "Rejected ✓" uses a checkmark |
| 5 | Error Prevention | 2 | Generate and Try again are one-tap money actions beside scroll targets; Try again row is cramped at 375 px |
| 6 | Recognition Rather Than Recall | 3 | Shot idea is 600+ px above the second and third candidates |
| 7 | Flexibility and Efficiency | 1 | No swipe, no keyboard, no approve-and-next; every decision is a full POST then a manual scroll |
| 8 | Aesthetic and Minimalist Design | 3 | Calm and quiet, but under-designed: system font, no rhythm beyond space-y-4 |
| 9 | Error Recovery | 3 | Failure copy is plain English but the failed card offers no action; Try again only mounts on rejected |
| 10 | Help and Documentation | 3 | Nothing to learn, which is the brief; "(suggested, edit if you like)" is good |
| **Total** | | **26/40** | **Acceptable** |

## Design Specificity Verdict

LLM assessment: partly authored, mostly interchangeable. Vocabulary, money-on-the-button and the absence of dashboard chrome are this product's. The layout is a generic Tailwind CRUD detail stack. The binding reference (Apple Photos: image fills width, decisions under it, next item one gesture) did not ship: on 375×812 the first Approve button is at ~1100 px, behind a header, product meta, a textarea and a $0.09 button.

Deterministic scan: 0 findings across app/review/[sku]/page.tsx, IdeaForm.tsx, GenerateProductForm.tsx, layout.tsx. Browser overlay on HG-002, HG-003, HG-001 at 1280×900: 0 anti-patterns. Two text-overflow hits on HG-003 at a 0×0 hidden-pane viewport were measurement artifacts (false positives).

## Priority Issues

- [P0] The decision is below the fold on the primary device. First Approve at ~1100 px on a phone; candidates 2 and 3 need 600 px scrolls each. Fix: first undecided candidate full-bleed under a one-line header; product meta and IdeaForm below or behind a disclosure; decided candidates collapse to a strip. Command: /impeccable layout
- [P0] "Next item is one gesture" is not delivered. After the last decision Ellie scrolls ~1500 px up to a 14 px underlined Next link. Fix: sticky bottom bar with Prev/Next, or auto-advance to `next` when no undecided candidates remain. Command: /impeccable layout
- [P1] The money button outranks the image. The only black filled control above the fold is a spend action. Fix: when candidates exist, render Generate more as a quiet outlined button at the bottom beside Try again; keep it prominent only on a SKU with no candidates. Command: /impeccable quieter
- [P1] Failed candidate has no exit. Try again gates on some(rejected); a failed-only SKU gets no button. Fix: gate on rejected or failed; on a photo-host 403 say "Check the product photo link in the sheet". Command: /impeccable harden
- [P2] Machine strings in the byline. Raw enum and SQLite datetime. Fix: "Approved by Ellie · today 14:03" or drop the time. Command: /impeccable clarify

## Persona Red Flags

Casey (thumb only): Prev/Next are 14 px text links top-right, the hardest thumb zone. Try again note input and $0.09 button share a row at 375 px; a mis-thumb spends money. Approve is bg-stone-100 on white and reads as disabled.

Sam (screen reader / keyboard): no aria-pressed on decision buttons; "Approve, button / Reject, button" repeats three times with no candidate context; no authored focus styles; byline text-xs stone-500 is ~4.6:1, marginal on stone-50; status chip is a bare span.

Ellie (from PRODUCT.md): the shot idea is a textarea, not a caption; Maya's Notes line is the smallest text on the page; no "how many left"; p-2 card padding plus shadow means the image does not fill the width.

## Minor Observations

- "✓" on both Approved and Rejected.
- h1 puts SKU and name in one string at one weight.
- space-y-4 everywhere; no break between product info and candidates.
- Candidate images have no width/height, so buttons jump as images load.
- No motion at all; a small decide confirmation is a missed opportunity.
- The candidate list has no heading.

## Questions to Consider

- If the shot idea is the criterion, why is it an input rather than a caption pinned to the image?
- When all candidates are decided, should the page stay here, or auto-advance with "HG-002 done · 1 approved"?
- Is the $0.09 Generate button above the images Maya's button masquerading as Ellie's?
