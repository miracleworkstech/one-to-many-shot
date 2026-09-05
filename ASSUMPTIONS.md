# ASSUMPTIONS.md

> Assumptions made because the brief was silent, and what each changed. Decisions we took
> on purpose live in `DECISIONS.md`. Rows marked *(revised)* changed after review on 2026-09-03. The "What it changed" column is the contract: if an assumption
> flips, that is the part of the build that moves.

The brief says I can't interview Ellie or Maya. These are the questions I would have asked,
the assumption I'm proceeding on instead, and what that assumption does to the build.

## What I learned from the data before assuming anything

- `data/catalog.csv`: 40 rows, 9 columns, ASCII, CRLF, no BOM, no duplicate SKUs, no stray
  whitespace. Cleaner than a real export usually is. I will still parse defensively (strip,
  case-insensitive SKU, dedupe) because the next export will not be this clean.
- SKUs run HG-001 to HG-045 with five gaps (007, 015, 023, 031, 039). Gap photo URLs 404.
- 16 of 40 rows have a Shot Idea. 24 do not. The 40-product drop will mostly arrive blank.
- Photo URLs return 200 to a browser and 403 to a plain script client. The host filters on
  user agent. Luma fetching the reference image server-side may be refused too. Verify with
  one generation before designing around it.
- Notes carry three different kinds of information mixed together: priority ("El: bestseller,
  do this one first"), photographic cautions ("smoke glass photographs badly"), and product
  status ("discontinued after spring?").

- Luma facts that shape the build (from docs.agents.lumalabs.ai): the key is for the Agents API;
  `uni-1` edit with one reference costs $0.0434 per image; there is **no callback_url** on this
  API, so results are polled (15 to 60 s typical); result URLs expire after 1 hour, so bytes
  must be copied out. Dollars are not the scarce resource here. Ellie's attention is.

## Questions, assumptions, consequences

| # | Question I'd ask | Assumption I'm proceeding on | What it changes about the build |
|---|---|---|---|
| 1 | Is Ellie the only approver, ever? *(revised)* | For v1, yes: her pick is the decision, per the brief. Not forever. If the team grows, Ellie becomes the bottleneck, so multiple approvers is the first follow-up, not a never. | No accounts or roles in v1. One shared link protected by an unguessable token. Every approval is recorded with a free-text "decided by" so adding named approvers later is a column, not a rewrite. |
| 2 | What does "on the product page" mean technically (Shopify? custom site?) | Unknown platform, so publishing to the site is out of scope. "Done" for this build = approved image in the shared Drive folder with a filename that names the SKU, plus the row updated in the export. | No storefront integration. The web person's weekly upload stays, but the "which file is final?" Slack question disappears because filenames and the sheet answer it. |
| 3 | Where does Ellie want to approve: Slack, email, a link? *(revised)* | A lightweight web page reached from a Slack message. It is one screen outside Slack, and that is the accepted cost: in-Slack approval gets bad fast when a product has many candidates or there are many notifications. Nothing to install, nothing to log into. | Approval UI is a phone-first page: one product, its candidates, tap approve or reject. Slack is an incoming webhook, one message per batch, not one per image. In-Slack buttons are a later addition that needs an installed app (see 9). |
| 4 | How much are you willing to spend per product, and how many options does Ellie want to see? | Two candidates per shot idea at the cheaper model tier first. Regenerate only when Ellie asks. Hard cap per batch so a bad CSV can't drain the account. | Generation is staged, not bulk. Cost is visible per product and per batch. A "try again" button exists; an "auto-retry until she likes it" loop does not. |
| 5 | How exact must the product look, and what does "styled photo in a real scene" mean? *(revised)* | Fidelity matters more than scene creativity for this catalog (glazes, colors, materials are the product). v1 treats "in a real scene" as the product placed into a new setting via the Agents API `image_edit` with the white-background photo as `source` (the documented subject-preserving path; there is no weight knob on this API). New angles, hero crops, and in-use shots are a real part of the ask but a follow-up. Ellie's approval is the quality gate. | Prompt construction leans on product name, color, material, and the Notes cautions. One edit path in v1. Fidelity failures are expected and are what "reject" is for. |
| 6 | For rows with no shot idea (24 of 40 now, most of the drop later), should the system propose one? | Yes, but a proposal costs nothing until Ellie taps "generate". The system drafts a shot idea from category and material and labels it "suggested". | Without this, the 40-product drop launches with a handful of shots. With it, generation still never spends money on an idea nobody looked at. |
| 7 | What counts as done? | The brief's definition: 2 to 3 approved images per request. A product is "done" at 2 approved. | Status is computed, not typed: none / in review / done. Maya's question "where do things stand" has a numeric answer. |
| 8 | Who feeds new CSVs in, and how? *(revised)* | Maya, from a laptop, by uploading the same export format to the same page. Approval happens on a phone; import happens at a desk. The page is responsive so both work, but upload is designed desk-first and review is designed thumb-first. Same columns, new rows, new photo URLs. Re-uploading a SKU that already exists updates its shot idea and never deletes its approved images. | One upload entry point. Idempotent by SKU. No live sheet sync, per the brief. |
| 9 | Can we install a Slack app in the workspace? | Avoid needing to. An incoming webhook is enough for notifications and needs no admin approval on Ellie's side. | Nudges go to a channel. Approvals do not happen inside Slack. If the team later wants in-Slack buttons, that is an add, not a rewrite. |
| 10 | Should notes like "discontinued after spring?" exclude a product? | No automatic exclusion from fuzzy text. Notes are shown on the review card and fed to the prompt as cautions. | No note-parsing heuristics. A human reads the note where it matters, at approval time. |
| 11 | What image size and aspect ratio? | 1:1, matching the white-background source. Product page first; social crops are later. | One aspect ratio in v1. |
| 12 | Should multi-product scenes ("shoot with the mugs") be supported? | Not in v1. One product per image. | Keeps fidelity tractable. Multi-reference is a known next step. |
| 13 | How does Maya see status without asking Ellie? | The same page, read-only summary at the top, plus an updated CSV export she can open in Sheets. Not a dashboard she has to remember to visit; a link she keeps. | Status page is one screen with counts and a per-product list. No charts. |
| 14 | Where do approved images live long-term? | In our own storage, copied out of Luma when the generation completes, and in the shared Drive folder. Luma result URLs are treated as temporary. | Download-on-completion step, so the review page has something to show before anyone approves. Deterministic filenames: `HG-002-morning-kitchen-01.jpg`. |
| 15 | Are the 16 existing requests still wanted? Some are months old. | Yes, all 16 are live. "Do this one first" ordering is honored. | The first batch is the existing 16. The drop is the second. |
| 16 | Can the image links in the exported CSV be clicked from the shared spreadsheet? | Yes: each "Approved Images" link carries the team's shared access token (`?k=`), the same token the app link already contains, so Task 8's gate lets a Sheets user open an image. The CSV therefore holds a capability URL and should stay inside the team's Drive, which is where the brief already keeps it. | One token for the team, no per-user auth in v1 (see row 1). Rotating `ACCESS_TOKEN` invalidates old exports' links; the filenames in the zip still work. |
| 17 | Which CSV will people open in Excel? | The direct download from the status page, which carries a UTF-8 BOM so accented product names read correctly. The `manifest.csv` inside the zip is the raw export (byte-identical to `exportCsv()`, no BOM) and is there for reconciliation, not for opening in Excel. | One BOM, in the route; the manifest stays comparable to the CSV endpoint in tests. |
| 18 | Is the app ever reached at a host other than `APP_URL`? | No. The team link and the CSV's image links are both minted from `APP_URL`, so every `?k=` visit arrives at that host. Railway forwards plain HTTP to the container behind its own TLS, so the container cannot tell the public origin from the request alone without trusting forwarded headers. | The gate builds its redirect on `APP_URL` (D15) and `APP_URL` is required in production. A visit at another host is redirected to the canonical one after the cookie is set, so it would show as a 401 on the second host; the deploy checklist opens the link at `APP_URL` first. |
| 19 | Does the team want to see the price of each generation before they tap? *(revised 2026-09-05)* | No. Maya's ask is "don't burn our budget on stuff she'll reject", which is a bound, not a receipt. The caps do the bounding; the total is one disclosure away on the status page. Showing $0.09 on every button made the tool feel like a meter. | Trigger buttons carry no estimate. `MAX_TOTAL_SPEND_USD` and `MAX_IMAGES_IN_FLIGHT` still refuse over the line, with the reason shown. Nobody's name appears in the UI: bylines are "Approved · 4 Sep". |
