# Shared visual system — direction contract for Tasks 12 and 13 (2026-09-05)

Both pages follow these rules. DESIGN.md is generated from the shipped pages afterwards
(`/impeccable document`); this file is the contract the builds are checked against.

## Register and scene

Operate mode on both pages. Reviewing happens on a phone in daylight, status on a laptop by
day. Light only; no dark mode. One column, phone-first; desktop is the same layout in a
wider measure (`max-w-lg` review, `max-w-2xl` status).

## Colour: one hue per meaning, on marks only

- Three theme tokens, one meaning each: `moss` (oklch 0.52 0.09 150) is approved or done,
  `clay` (0.55 0.13 30) is rejected, failed or paused, `ochre` (0.66 0.13 75) is waiting on
  a person. Not Tailwind's green, red and amber.
- A state is a **dot beside neutral text**, never a tinted badge with same-hue text (the
  Tailwind badge is a tell). Colour appears only on those dots, on a mark (a moss check),
  on counts, and on the two tinted surfaces (`clay-tint` failed card, `ochre-tint` paused
  banner). Never on headings, rows, page backgrounds or body text. Neutrals are stone;
  page background stone-50.

## Money

- The estimate is **not** shown on trigger buttons (user's call 2026-09-05, reversing D18's
  "cost on the button"). The brief's ask is not to burn budget, not to see the price of each
  tap. The caps (`MAX_IMAGES_IN_FLIGHT`, `MAX_TOTAL_SPEND_USD`) stay enforced in `enqueue`;
  a refusal still says why in plain words. Spend lives behind the status page's Spend
  disclosure, total first.

## People

- No person's name in UI copy, placeholders or code defaults. "Import the export", not
  "Import Maya's export". A decision byline reads "Approved · 4 Sep"; `decided_by` is
  recorded only when a name is actually supplied.

## Type

- Sizes 12, 14, 16, 20 px. Weights 400, 500, 600. The page title is 20/600. Tier-1 group
  headings on the status page are 16/600; everything else 16/500 or lighter. Row detail and
  bylines 12 px stone-600 (7:1 on stone-50). Tabular numerals on counts and dates.

## Controls

- Primary action: filled stone-900, white text, one per page state. Secondary: white with a
  stone-300 outline. Decision buttons: outlined until pressed, then filled green or red with
  `aria-pressed`. Words stay on Approve and Reject; icon-only is allowed only with an
  `aria-label` (chevrons, More).
- Links and text controls: no underline. Navigation is icon + label at weight 500;
  in-page disclosures are chevron + label. Pill hit areas on the fixed bar, 44 px minimum
  everywhere, Next at least 88 px wide.
- Native `<details>` for disclosures, always with a chevron that rotates when open. Native
  popover for the More menu. No JavaScript for either.

## Icons

- lucide-react, 20 px, `strokeWidth` 1.75, `aria-hidden` unless the icon is the only
  content. Exactly: ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, Pencil,
  MoreHorizontal, Check, X, Download, Upload, AlertCircle. Nothing else without a reason.
  Gauge marks the spend control on the status page (2026-09-05, user's call: a meter,
  not a chevron).

## Shape, rhythm, motion

- One radius: 8 px (`rounded-lg`); status chips `rounded-full`. Section rules are a
  stone-300 hairline. Spacing on the 4 px scale; more space above a heading than below.
- Motion is colour transitions at 150 ms ease-out on state changes only;
  `motion-reduce:transition-none`. No entrance animation.

## Copy

- The team's words: shot idea, candidates, approved, the drop, try again. Dates as "4 Sep"
  inside `<time>` with the full UTC stamp in `title`; never seconds, never a timezone
  label. Empty states are stated in words. Errors name the problem and the next step.
  "(suggested)" appears once, on the review page only.
