---
target: app/review/[sku]/page.tsx
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:C:\\Users\\mirac\\Documents\\lumalabs-eng-take-home-13ed13959e5ba3e7acc72a8a9f41ecd409620c80\\app\\review\\[sku]\\page.tsx"
target_fingerprint: "sha256:c21c7f0756ce382938c5be73976ec37dae57fa4ce3226046fa14e2baf9a06ad9"
target_path: "C:\\Users\\mirac\\Documents\\lumalabs-eng-take-home-13ed13959e5ba3e7acc72a8a9f41ecd409620c80\\app\\review\\[sku]\\page.tsx"
timestamp: 2026-09-05T14-04-22Z
slug: app-review-sku-page-tsx
---
Method: dual-agent (A: design-review subagent · B: detector+browser subagent)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | HG-003 pill says Generating while the failed card says try again, with no control and no explanation |
| 2 | Match System / Real World | 4 | Team vocabulary throughout; "HTTP 403" and the ISO date are the only leaks |
| 3 | User Control and Freedom | 3 | Decisions reversible but nothing says so |
| 4 | Consistency and Standards | 2 | Three button treatments, two input styles, mixed radii |
| 5 | Error Prevention | 3 | Approve/Reject are equal halves 8 px apart; a seam thumb flips a decision |
| 6 | Recognition Rather Than Recall | 2 | The idea scrolls off after candidate 1; the source photo sits at 2136 px |
| 7 | Flexibility and Efficiency | 2 | 2.8 screens per product at 3 candidates, ~5 at 6; no swipe or keys |
| 8 | Aesthetic and Minimalist Design | 3 | Quiet chrome; idea caption + editor duplicate |
| 9 | Error Recovery | 3 | Plain-English failure copy; "re-import" points at another screen with no link |
| 10 | Help and Documentation | 3 | None needed, none present |
| **Total** | | **28/40** | **Good** |

## Design Specificity Verdict

LLM assessment: specific, not generic, but half-committed to its own reference. One column, edge-to-edge image, paired thumb buttons, price on every trigger. It is a vertical contact sheet, not Apple Photos' one item one gesture; defensible at 2 candidates, not at 6.

Deterministic scan: 0 findings across the page, both forms, layout and globals. Browser overlay at 1280×900 and 375×812: 0 on HG-002 and HG-003; one text-occlusion on HG-001 that is a false positive (the textarea is inside a closed details; the detector reads its layout box without checking visibility).

## Priority Issues

- [P0] The criterion and the reference leave the screen before the comparison starts. Idea at 112–170 px, third candidate at 1403 px, source photo at 2136 px. Fix: a compact context strip (idea + 40 px source thumbnail) pinned under the header. Command: /impeccable layout
- [P1] Per-product scroll cost scales linearly with candidates (581 px per candidate, 2296 px doc at 3). Fix: one-at-a-time horizontal snap carousel with the decision buttons inside each slide. Command: /impeccable shape
- [P1] First candidate's decisions collide with the fixed bar (buttons 718–768, bar at 759). Fix: reserve the bar height and size image+buttons to fit the viewport. Command: /impeccable harden
- [P2] Follow-up actions are quiet but undifferentiated: Try again and Generate more are identical outline buttons; the note input has no visible label; Generate more is offered on a Done product. Command: /impeccable clarify
- [P2] Text-styled links do not separate from body text: All products, Edit the idea, Previous, Next. Iconography warranted for exactly the navigation controls. Command: /impeccable typeset

## Persona Red Flags

Casey: Approve/Reject seam; Next is 29 px wide at the far right; All products only at the top.
Sam: summary marker hidden with no replacement; no live region on decide; candidate alt carries a number, not the idea; status pill unnamed.
Ellie: asked to remember the idea for three images; "(suggested)" twice; no reward beat when the second approval lands; Generate more offered on a Done product.

## Minor Observations

- Caption + textarea show the same text in two sizes when the editor is open.
- "Note: El: bestseller" double prefix.
- rounded vs rounded-lg mixed; no active: state on decision buttons; failed and generating cards have different heights; candidate img has no width/height.

## Questions to Consider

- Which candidate count is the ceiling, and does the layout change at it?
- What does Ellie see when the second approval lands?
- Should Generate more exist on a Done product?
