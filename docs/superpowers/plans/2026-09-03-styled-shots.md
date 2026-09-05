# Styled Shots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution style chosen by the user (2026-09-03):** one subagent pair per task, implementer then evaluator, followed by a Codex review as the final pass. The evaluator invokes the project skill `evaluating-task`. Progress lives in `docs/STATE.md`. See DECISIONS.md D8.

**Goal:** Turn the catalog sheet's shot ideas into approved, correctly named product images via a phone-first approval page, with generation that never spends without a visible cost and a cap, and every dollar spent attributable to a product, a batch, and an outcome.

**Architecture:** One Next.js process on Railway. SQLite (better-sqlite3, WAL) and images on a mounted volume, all disk access through `lib/storage.ts`. An in-process worker polls Luma because the Agents API has no callbacks. Pure domain functions (`catalog`, `status`, `prompt`, `names`) and the two money modules (`enqueue`, `analytics`) are tested; I/O modules are thin.

**Tech Stack:** Next.js 15 (App Router, server actions, TypeScript, Tailwind), better-sqlite3, csv-parse / csv-stringify, fflate (zip), @anthropic-ai/sdk (Haiku suggestions), Node 22, tsx + node:test for tests. Railway with a volume at `/data`.

## Global Constraints

- Never read, print, or commit `.env.local`. Secrets come from `process.env` only.
- Every path that calls Luma shows no estimate on the trigger (D20) and is bounded by `MAX_IMAGES_IN_FLIGHT` and `MAX_TOTAL_SPEND_USD`.
- Cost is recorded on a candidate the moment Luma accepts the job (state becomes `processing`), because that is when money is committed. A generation that later fails keeps its cost (conservative; Luma's refund behaviour on failures is undocumented). A candidate that never reached Luma (photo fetch failed) costs zero.
- Every candidate belongs to a batch. A batch is one trigger: "generate next N", "generate this product", or "try again".
- Luma: `POST https://agents.lumalabs.ai/v1/generations` with `{type:"image_edit", model:"uni-1", prompt, source:{data, media_type:"image/jpeg"}, output_format:"jpeg"}`; poll `GET /v1/generations/{id}`; states `queued|processing|completed|failed`; output at `output[0].url`, expires in 1 hour. Cost `LUMA_COST_PER_IMAGE_USD` default `0.0434`.
- Photo host returns 403 to plain clients: always fetch with a browser User-Agent.
- Claude model for suggestions: `claude-haiku-4-5` (user's explicit choice).
- Data dir: `DATA_DIR` (default `./data-local`, gitignored; `/data` on Railway). DB at `${DATA_DIR}/app.db`, images at `${DATA_DIR}/images/<candidateId>.jpg`.
- Access: one shared token `ACCESS_TOKEN`; links are `${APP_URL}/?k=<token>`.
- Approved filename: `<SKU>-<first three idea words slugged>-<nn>.jpg`, e.g. `HG-002-morning-kitchen-counter-01.jpg`.
- Product status is derived, never stored.
- **No stringly-typed states.** `CandidateState`, `BatchKind`, `ShotIdeaSource` live in `lib/types.ts` as unions derived from const arrays (they mirror database columns). `ProductStatus` is derived, not stored, so it lives with its derivation in `lib/status.ts`, same const-array pattern. Functions take and return the union, never `string`. The schema's `check (state in (...))` constraints are generated from the same arrays, so the database rejects what the compiler would. Adding a state fails the compiler and the constraint until every site is updated.
- **Single responsibility:** each module below has one reason to change. When a module grows a second responsibility during a task, split it in that task and say so in the commit message. Pages render; `lib/queries.ts` reads; actions mutate; the worker advances generation; `analytics` counts money.
- **Branch per task.** Before a task starts: `git checkout -b task/<n>-<slug>` from `main`. The implementer and evaluator work on that branch. After the evaluator passes, push the branch and open a PR to `main` (`gh pr create`) carrying both agents' summaries, then stop for the user's review. After approval: `git checkout main && git merge --ff-only task/<n>-<slug>`, delete the branch, push `main`. A task that fails twice stays on its branch while the plan is fixed.
- **`npm run check`** is `tsc --noEmit`, `eslint .`, `prettier --check .`, and the tests. A pre-commit hook (`.githooks/pre-commit`, enabled by `npm run prepare`) runs it, and GitHub Actions runs it on every push. Never commit with `--no-verify`. `@typescript-eslint/no-explicit-any` and `ban-ts-comment` are errors, so most of pattern 5 fails the build, not just the review.
- **Fail fast in production.** `assertProductionEnv()` in `lib/env.ts` throws at server start (called from `instrumentation.ts`, not at build) if `LUMA_AGENTS_API_KEY` or `ACCESS_TOKEN` is missing.
- Commit after every task with a reasoned message ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Append to `DECISIONS.md` when a task makes a material choice not already logged.

---

## Money paths: failure modes and races (accepted by the user 2026-09-03)

| # | Scenario | What happens | Mitigation in this plan |
|---|---|---|---|
| 1 | Maya double-taps "Generate next 10" | Two enqueues of 20 candidates, $1.74 instead of $0.87 | `enqueue()` runs in one SQLite transaction; a product with any queued/processing candidate is skipped; the in-flight cap counts queued+processing across all products. Second tap enqueues nothing and says so. |
| 2 | Worker ticks overlap (slow Luma call, next interval fires) | Same queued candidate submitted twice | Single-flight: `tick()` returns immediately if a tick is running. One process, one loop, no cron. |
| 3 | Process dies after Luma accepted the job but before we stored the generation id | Candidate still `queued`, resubmitted on restart; one image paid for twice ($0.04) | Accepted. Logged as a warning at boot when candidates are `queued` with `attempts > 0`. Not worth a two-phase state in v1. |
| 4 | Luma 402 (credits exhausted), 401 (bad key), 403 (client suspended) | Every tick retries every queued candidate forever, log storm; a bad key burns five attempts per candidate | Worker sets `settings.paused_reason` with the `LumaError.userMessage`, submits nothing until a human clicks Resume. Banner on the status page. (401/403 added by D11.) |
| 5 | Luma 429 (rate limit) | Hammering | Stop submitting for this tick, leave candidates queued. Concurrency is capped by `LUMA_CONCURRENCY` (default 4) anyway. |
| 6 | Luma 5xx or network error on submit | Silent stall | `attempts` incremented; after 5 the candidate is `failed` with the last error, visible on the card with a retry button. |
| 7 | Result URL expired before download (worker was down > 1 h) | Download 403 | Re-poll the generation on next tick for a fresh URL; candidate stays `processing`. |
| 8 | Total spend creeps past what Maya expected | Budget surprise | `MAX_TOTAL_SPEND_USD` (default 25): enqueue refuses if spent + in-flight + planned would exceed it. Spent total, per-batch and per-outcome spend are on the status page. |
| 9 | Re-import of a CSV while a batch is running | Approvals or candidates lost | Import upserts products only and never touches candidates or batches. A changed shot idea applies to the *next* generation; existing candidates keep the prompt they were made with. |
| 10 | Two people decide the same candidate at once | Conflict | Last write wins, both are humans, the card shows the current state and `decided_by`. No lock. |
| 11 | "Try again" tapped repeatedly | Each tap costs 2 × $0.0434 | Allowed; the caps' answer is shown after the tap (no estimate before it, D20); bounded by the in-flight cap and spend cap; each tap is its own batch so the spend is visible. Per-product cap is a named non-feature. |
| 12 | Photo host 403/404 for a SKU | Nothing generates, nobody knows why | Fetch failure marks the candidate `failed` with "photo not reachable" and zero cost; shown on the card. Import does not block on photo reachability. |

---

## File structure (one responsibility per module)

```
app/
  layout.tsx                 shell, viewport meta, Tailwind
  page.tsx                   status page: renders overview + spend + forms (no queries inline)
  review/[sku]/page.tsx      phone-first review card (renders productDetail)
  img/[id]/route.ts          serves a candidate image from the volume
  export/csv/route.ts        updated catalog CSV
  export/zip/route.ts        approved images zip
components/
  IdeaForm.tsx               client component: edit a shot idea
  GenerateForm.tsx           client component: generate next N, shows estimate, caps, result
  GenerateProductForm.tsx    client component: generate this product / try again, cost on the button
  ImportForm.tsx             client component: CSV upload, shows counts and skipped rows
  SpendPanel.tsx             renders analytics.spendSummary + recent batches
lib/
  env.ts                     typed env with defaults
  types.ts                   domain types and enums (the only place a state name is spelled)
  db.ts                      SQLite open + schema (check constraints mirror types.ts)
  storage.ts                 the only module that touches image files
  catalog.ts                 CSV parse + validate (pure)
  status.ts                  derived product status (pure)
  prompt.ts                  Luma prompt from product + idea (pure)
  names.ts                   approved filename (pure)
  photos.ts                  fetch product photo with browser UA
  luma.ts                    Luma Agents API client (transport, polling)
  luma-errors.ts             every Luma status and failure_code -> typed code + plain-English message (D11)
  suggest.ts                 Haiku shot-idea suggestions + template fallback
  slack.ts                   incoming webhook transport
  notify.ts                  "batch ready" policy: when to send, what to say
  enqueue.ts                 admission control: caps, dedupe, batch creation
  worker.ts                  advance generation: submit, poll, download
  analytics.ts               money: spend by outcome, by batch, by product
  queries.ts                 read model for pages and exports
  review.ts                  decideCandidate + the typed decision union (D13)
  export.ts                  CSV and zip formats
  actions/
    import.ts                importCatalog
    generate.ts              generateNext, generateSku, tryAgain, resumeWorker
    review.ts                decide, updateIdea
middleware.ts                shared-token gate
instrumentation.ts           asserts production env, starts the worker once per process
.githooks/pre-commit         runs npm run check (enabled by npm run prepare)
.github/workflows/check.yml  npm ci && npm run check on push and pull request
.prettierrc, .prettierignore default Prettier, docs and data excluded
tests/
  db.test.ts, catalog.test.ts, status.test.ts, prompt.test.ts, names.test.ts,
  enqueue.test.ts, analytics.test.ts
Dockerfile, railway.json, .env.example (updated), README section
```

---

### Task 1: Scaffold, env, database, storage

**Files:**
- Create: Next.js app via `create-next-app`, `lib/env.ts`, `lib/types.ts`, `lib/db.ts`, `lib/storage.ts`, `next.config.ts` (modify), `.gitignore` (modify), `tests/db.test.ts`, `.githooks/pre-commit`, `.github/workflows/check.yml`, `.prettierrc`, `.prettierignore`

**Interfaces:**
- Produces: `env` object; `lib/types.ts` exporting `CandidateState`, `CANDIDATE_STATES`, `BatchKind`, `BATCH_KINDS`, `ShotIdeaSource`, `Product`, `Candidate`, `Batch`; `db()` returning a `better-sqlite3` Database with schema applied; `storage.saveImage(id, buf)`, `storage.readImage(id)`, `storage.imagePath(id)`.

- [x] **Step 1: Scaffold**

```bash
git checkout -b task/1-scaffold
npx --yes create-next-app@15 . --ts --tailwind --app --no-src-dir --eslint --import-alias "@/*" --use-npm
npm i better-sqlite3 csv-parse csv-stringify fflate @anthropic-ai/sdk
npm i -D @types/better-sqlite3 tsx prettier
```

If `npm i better-sqlite3` compiles from source (no prebuilt binary for the local Node major) and fails for lack of build tools, switch to Node 22 LTS (`nvm use 22`) and retry; the Docker image pins Node 22 regardless.

Expected: `package.json`, `app/`, `next.config.ts` exist. If create-next-app refuses a non-empty directory, run it in a temp dir and copy `app/`, `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `next-env.d.ts` into the repo root.

- [x] **Step 2: Scripts, lint rules, formatter, hook, CI, gitignore**

In `package.json` scripts add:
```json
"test": "node --import tsx --test tests/*.test.ts",
"typecheck": "tsc --noEmit",
"lint": "eslint .",
"format": "prettier --write .",
"format:check": "prettier --check .",
"check": "npm run typecheck && npm run lint && npm run format:check && npm test",
"prepare": "git config core.hooksPath .githooks || true"
```
In `eslint.config.mjs` (generated by create-next-app, flat config), add a final entry:
```js
{ rules: { "@typescript-eslint/no-explicit-any": "error", "@typescript-eslint/ban-ts-comment": "error" } }
```
`.prettierrc`: `{}` (defaults). `.prettierignore`:
```
.next
node_modules
data-local
scratch
dist
data
*.md
package-lock.json
```
`.githooks/pre-commit` (make it executable with `git update-index --chmod=+x .githooks/pre-commit`):
```sh
#!/bin/sh
npm run check
```
Run `npm run prepare` once locally. `.github/workflows/check.yml`:
```yaml
name: check
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run check
```
Append to `.gitignore`: `data-local/` and `.next/`. Run `npm run format` once so the scaffold is formatted before the first commit.

- [x] **Step 3: next.config.ts**

```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
};
export default nextConfig;
```

- [x] **Step 4: lib/env.ts**

```ts
const num = (v: string | undefined, d: number) => (v ? Number(v) : d);
export const env = {
  dataDir: process.env.DATA_DIR ?? "./data-local",
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  accessToken: process.env.ACCESS_TOKEN ?? "",
  lumaKey: process.env.LUMA_AGENTS_API_KEY ?? "",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  slackWebhook: process.env.SLACK_WEBHOOK_URL ?? "",
  costPerImage: num(process.env.LUMA_COST_PER_IMAGE_USD, 0.0434),
  candidatesPerProduct: num(process.env.CANDIDATES_PER_PRODUCT, 2),
  maxInFlight: num(process.env.MAX_IMAGES_IN_FLIGHT, 40),
  maxTotalSpend: num(process.env.MAX_TOTAL_SPEND_USD, 25),
  lumaConcurrency: num(process.env.LUMA_CONCURRENCY, 4),
  tickMs: num(process.env.WORKER_TICK_MS, 5000),
};

/** Call at server start, never at build: Next sets NODE_ENV=production during `next build` too. */
export function assertProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;
  for (const k of ["LUMA_AGENTS_API_KEY", "ACCESS_TOKEN"] as const)
    if (!process.env[k]) throw new Error(`Missing required env var ${k}`);
}
```

- [x] **Step 5: Failing test for db**

`tests/db.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "shots-"));
const { db } = await import("../lib/db.ts");

test("schema applies and settings row exists", () => {
  const d = db();
  const tables = (d.prepare("select name from sqlite_master where type='table'").all() as { name: string }[]).map(r => r.name);
  for (const t of ["products", "candidates", "batches", "settings"]) assert.ok(tables.includes(t), t);
  assert.equal((d.prepare("select count(*) as n from settings").get() as { n: number }).n, 1);
});
test("database rejects a state the type union does not know", () => {
  const d = db();
  d.prepare("insert into products (sku,name,photo_url) values ('T','t','https://x/a.jpg')").run();
  const b = d.prepare("insert into batches (kind) values ('next')").run().lastInsertRowid;
  assert.throws(() => d.prepare("insert into candidates (sku,batch_id,prompt,state) values ('T',?,'p','aproved')").run(b), /CHECK/);
  assert.throws(() => d.prepare("insert into batches (kind) values ('bogus')").run(), /CHECK/);
});
```

Run: `npm test` → Expected: FAIL, cannot find `../lib/db.ts`.

- [x] **Step 6: lib/types.ts (domain types; the only place a state name is spelled)**

```ts
export const CANDIDATE_STATES = ["queued", "processing", "completed", "failed", "approved", "rejected"] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

export const BATCH_KINDS = ["next", "product", "retry"] as const;
export type BatchKind = (typeof BATCH_KINDS)[number];

export const SHOT_IDEA_SOURCES = ["sheet", "suggested", "edited"] as const;
export type ShotIdeaSource = (typeof SHOT_IDEA_SOURCES)[number];

export interface Product {
  sku: string; name: string; category: string; color: string; material: string; price: string;
  photo_url: string; shot_idea: string | null; shot_idea_source: ShotIdeaSource | null;
  notes: string; priority: number; imported_at: string; updated_at: string;
}
export interface Batch { id: number; kind: BatchKind; estimated_usd: number; created_at: string; }
export interface Candidate {
  id: number; sku: string; batch_id: number; prompt: string; luma_generation_id: string | null; state: CandidateState;
  cost_usd: number; failure_reason: string | null; attempts: number; decided_by: string | null;
  created_at: string; decided_at: string | null;
}
```

- [x] **Step 7: lib/db.ts**

```ts
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import { CANDIDATE_STATES, BATCH_KINDS, SHOT_IDEA_SOURCES, type CandidateState, type ShotIdeaSource } from "./types";

const list = (xs: readonly string[]) => xs.map(x => `'${x}'`).join(",");

/** Typed SQL literals. A misspelled state in a query or an assignment is a compile error, not a silent miss. */
export const st = (s: CandidateState) => `'${s}'`;
export const inStates = (...s: CandidateState[]) => `(${s.map(st).join(",")})`;
export const src = (s: ShotIdeaSource) => `'${s}'`;

const SCHEMA = `
create table if not exists products (
  sku text primary key, name text not null, category text not null default '',
  color text not null default '', material text not null default '', price text not null default '',
  photo_url text not null, shot_idea text, shot_idea_source text check (shot_idea_source is null or shot_idea_source in (${list(SHOT_IDEA_SOURCES)})),
  notes text not null default '', priority integer not null default 0,
  imported_at text not null default (datetime('now')), updated_at text not null default (datetime('now'))
);
create table if not exists batches (
  id integer primary key autoincrement, kind text not null check (kind in (${list(BATCH_KINDS)})), estimated_usd real not null default 0,
  created_at text not null default (datetime('now'))
);
create table if not exists candidates (
  id integer primary key autoincrement, sku text not null references products(sku),
  batch_id integer not null references batches(id),
  prompt text not null, luma_generation_id text, state text not null default ${st("queued")} check (state in (${list(CANDIDATE_STATES)})),
  cost_usd real not null default 0, failure_reason text, attempts integer not null default 0,
  decided_by text, created_at text not null default (datetime('now')), decided_at text
);
create index if not exists candidates_sku on candidates(sku);
create index if not exists candidates_state on candidates(state);
create index if not exists candidates_batch on candidates(batch_id);
create table if not exists settings (
  id integer primary key check (id = 1), paused_reason text, last_notified_at text
);
insert or ignore into settings (id) values (1);
`;

declare global { var __shotsDb: Database.Database | undefined; }

export function db(): Database.Database {
  if (globalThis.__shotsDb) return globalThis.__shotsDb;
  fs.mkdirSync(env.dataDir, { recursive: true });
  const d = new Database(path.join(env.dataDir, "app.db"));
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.exec(SCHEMA);
  globalThis.__shotsDb = d;
  return d;
}
```

- [x] **Step 8: lib/storage.ts**

```ts
// ponytail: local disk only. Swap this module for R2/S3 if a second instance or CDN is ever needed (DECISIONS.md D6).
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";

const dir = () => { const p = path.join(env.dataDir, "images"); fs.mkdirSync(p, { recursive: true }); return p; };
export const storage = {
  imagePath: (id: number) => path.join(dir(), `${id}.jpg`),
  saveImage: (id: number, buf: Buffer) => fs.writeFileSync(storage.imagePath(id), buf),
  readImage: (id: number): Buffer | null => { const p = storage.imagePath(id); return fs.existsSync(p) ? fs.readFileSync(p) : null; },
};
```

- [x] **Step 9: Run the full check, commit**

Run: `npm run check` → Expected: typecheck clean, lint clean, tests PASS.

```bash
git add -A && git commit -m "scaffold: next app, sqlite schema, storage module

Single-process app per D6. Products, batches (one per trigger),
candidates (one per image, carries its cost), and a settings row for the
worker pause reason. State enums live once in lib/types.ts and are
mirrored as CHECK constraints. All image I/O goes through lib/storage.ts.
Quality gates: typecheck, lint (no-explicit-any, ban-ts-comment),
prettier, tests, via pre-commit hook and GitHub Actions.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Pure domain functions (catalog, status, prompt, names)

**Files:**
- Create: `lib/catalog.ts`, `lib/status.ts`, `lib/prompt.ts`, `lib/names.ts`, `tests/catalog.test.ts`, `tests/status.test.ts`, `tests/prompt.test.ts`, `tests/names.test.ts`

**Interfaces:**
- Produces: `parseCatalog(text): { rows: CatalogRow[]; errors: string[] }`; `REQUIRED_HEADERS`; `isPriority(notes)`; `productStatus(hasIdea, candidates): ProductStatus`; `STATUS_LABEL`; `buildPrompt(p, idea): string`; `approvedFilename(sku, idea, n): string`.

- [x] **Step 1: Failing tests**

`tests/catalog.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCatalog, isPriority } from "../lib/catalog.ts";

test("parses the customer export", () => {
  const { rows, errors } = parseCatalog(fs.readFileSync("data/catalog.csv", "utf8"));
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 40);
  const mug = rows.find(r => r.sku === "HG-002")!;
  assert.equal(mug.shot_idea, "morning kitchen counter, steam, warm light");
  assert.equal(mug.notes, "El: bestseller, do this one first");
});
test("normalises whitespace, case and duplicates", () => {
  const { rows, errors } = parseCatalog("SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes\n hg-001 , Vase ,Ceramics,,,$1,https://x/a.jpg,,\nHG-001,Vase 2,Ceramics,,,$1,https://x/a.jpg,,\n");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sku, "HG-001");
  assert.equal(rows[0].name, "Vase 2");
  assert.match(errors[0], /duplicate/i);
});
test("rejects wrong headers with a diff", () => {
  const { rows, errors } = parseCatalog("SKU,Name\nHG-1,x\n");
  assert.equal(rows.length, 0);
  assert.match(errors[0], /missing.*Product Name/i);
});
test("priority from notes", () => {
  assert.equal(isPriority("El: bestseller, do this one first"), true);
  assert.equal(isPriority("top seller, gets reordered constantly"), false);
});
```

`tests/status.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { productStatus } from "../lib/status.ts";
import type { CandidateState } from "../lib/types.ts";
const c = (...states: CandidateState[]) => states.map(state => ({ state }));
test("status ladder", () => {
  assert.equal(productStatus(false, []), "no_idea");
  assert.equal(productStatus(true, []), "idea_ready");
  assert.equal(productStatus(true, c("queued")), "generating");
  assert.equal(productStatus(true, c("completed", "completed")), "in_review");
  assert.equal(productStatus(true, c("approved", "rejected")), "needs_more");
  assert.equal(productStatus(true, c("approved", "approved", "processing")), "done");
});
test("failures are visible, not folded into needs_more", () => {
  assert.equal(productStatus(true, c("failed", "failed")), "failed");        // nothing for a human to judge
  assert.equal(productStatus(true, c("failed", "rejected")), "needs_more");  // Ellie saw one; she can try again
  assert.equal(productStatus(true, c("failed", "approved")), "needs_more");  // partial success
  assert.equal(productStatus(true, c("failed", "queued")), "generating");
});
```

`tests/prompt.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../lib/prompt.ts";
test("prompt names the product and keeps it unchanged", () => {
  const p = buildPrompt({ name: "Stoneware Mug 12oz", color: "Sage", material: "Stoneware", notes: "El: smoke glass photographs badly, careful" }, "morning kitchen counter, steam, warm light?");
  assert.match(p, /Stoneware Mug 12oz/);
  assert.match(p, /Sage/);
  assert.match(p, /morning kitchen counter, steam, warm light\./);
  assert.match(p, /identical/i);
  assert.match(p, /Team notes/);
  assert.ok(!p.includes("?"));
});
```

`tests/names.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedFilename } from "../lib/names.ts";
test("deterministic filenames", () => {
  assert.equal(approvedFilename("HG-002", "morning kitchen counter, steam, warm light", 1), "HG-002-morning-kitchen-counter-01.jpg");
  assert.equal(approvedFilename("HG-010", "holiday morning, gift-y", 2), "HG-010-holiday-morning-gift-y-02.jpg");
  assert.equal(approvedFilename("HG-001", null, 1), "HG-001-styled-01.jpg");
});
```

Run: `npm test` → Expected: FAIL on missing modules.

- [x] **Step 2: lib/catalog.ts**

```ts
import { parse } from "csv-parse/sync";

export const REQUIRED_HEADERS = ["SKU", "Product Name", "Category", "Color / Finish", "Material", "Price", "Photo", "Shot Idea", "Notes"] as const;

export interface CatalogRow {
  sku: string; name: string; category: string; color: string; material: string; price: string;
  photo_url: string; shot_idea: string | null; notes: string; priority: boolean;
}

export const isPriority = (notes: string) => /do this (one )?first/i.test(notes);

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

export function parseCatalog(text: string): { rows: CatalogRow[]; errors: string[] } {
  const errors: string[] = [];
  let records: Record<string, string>[];
  try {
    records = parse(text.replace(/^﻿/, ""), { columns: (h: string[]) => h.map(norm), skip_empty_lines: true, trim: true, relax_column_count: true });
  } catch (e) {
    return { rows: [], errors: [`Could not parse CSV: ${(e as Error).message}`] };
  }
  const present = new Set(Object.keys(records[0] ?? {}));
  const missing = REQUIRED_HEADERS.filter(h => !present.has(norm(h)));
  if (missing.length) return { rows: [], errors: [`Missing columns: ${missing.join(", ")}. Expected: ${REQUIRED_HEADERS.join(", ")}`] };

  const bySku = new Map<string, CatalogRow>();
  records.forEach((r, i) => {
    const g = (h: string) => (r[norm(h)] ?? "").trim();
    const sku = g("SKU").toUpperCase();
    if (!sku) { errors.push(`Row ${i + 2}: empty SKU, skipped`); return; }
    if (!/^https?:\/\//.test(g("Photo"))) { errors.push(`Row ${i + 2} (${sku}): Photo is not a URL, skipped`); return; }
    if (bySku.has(sku)) errors.push(`Row ${i + 2}: duplicate SKU ${sku}, last one wins`);
    const notes = g("Notes");
    bySku.set(sku, {
      sku, name: g("Product Name"), category: g("Category"), color: g("Color / Finish"), material: g("Material"),
      price: g("Price"), photo_url: g("Photo"), shot_idea: g("Shot Idea") || null, notes, priority: isPriority(notes),
    });
  });
  return { rows: [...bySku.values()], errors };
}
```

- [x] **Step 3: lib/status.ts**

```ts
import type { CandidateState } from "./types";

export const PRODUCT_STATUSES = ["no_idea", "idea_ready", "generating", "in_review", "done", "needs_more", "failed"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export const DONE_AT = 2; // approved images that make a product "done" (brief: 2–3)

export function productStatus(hasIdea: boolean, candidates: { state: CandidateState }[]): ProductStatus {
  const n = (s: CandidateState) => candidates.filter(c => c.state === s).length;
  if (n("approved") >= DONE_AT) return "done";
  if (n("queued") + n("processing") > 0) return "generating";
  if (n("completed") > 0) return "in_review";
  if (candidates.length > 0 && n("failed") === candidates.length) return "failed";
  if (candidates.length > 0) return "needs_more";
  return hasIdea ? "idea_ready" : "no_idea";
}

export const STATUS_LABEL: Record<ProductStatus, string> = {
  no_idea: "Needs an idea", idea_ready: "Ready to generate", generating: "Generating",
  in_review: "Waiting for review", done: "Done", needs_more: "Needs more", failed: "Generation failed",
};
```

- [x] **Step 4: lib/prompt.ts**

```ts
export function buildPrompt(p: { name: string; color: string; material: string; notes: string }, idea: string): string {
  const scene = idea.trim().replace(/[?.]+$/, "");
  const spec = [p.color, p.material].filter(Boolean).join(", ");
  const parts = [
    `Place this exact ${p.name}${spec ? ` (${spec})` : ""} in this scene: ${scene}.`,
    "Keep the product identical in shape, color, glaze, material, proportions and details. Do not add text, logos or extra copies of the product.",
    "Photorealistic product photography for an e-commerce page, natural light, shallow depth of field.",
  ];
  if (p.notes) parts.push(`Team notes for context: ${p.notes.replace(/[?]+/g, "")}.`);
  return parts.join(" ");
}
```

- [x] **Step 5: lib/names.ts**

```ts
export function approvedFilename(sku: string, idea: string | null, n: number): string {
  const words = (idea ?? "").toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter(Boolean).slice(0, 3);
  const slug = words.length ? words.join("-") : "styled";
  return `${sku}-${slug}-${String(n).padStart(2, "0")}.jpg`;
}
```

- [x] **Step 6: Run tests, commit**

Run: `npm test` → Expected: all PASS.

```bash
git add lib tests && git commit -m "domain: catalog parsing, derived status, prompt, filenames

Pure functions with tests. Parser normalises SKU case/whitespace, dedupes
(last wins, reported), rejects bad headers with the diff. Status is a
ladder, never stored. Filenames are deterministic so the wrong IMG_43xx
can't ship.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Import, suggestions, read model, status page

**Files:**
- Create: `lib/suggest.ts`, `lib/queries.ts`, `lib/actions/import.ts`, `lib/actions/review.ts` (updateIdea only for now), `app/page.tsx`, `app/layout.tsx` (modify)

**Interfaces:**
- Consumes: `parseCatalog`, `productStatus`, `db`, `env`.
- Produces: `importCatalog(formData): Promise<{ imported: number; suggested: number; errors: string[] }>`; `updateIdea(sku, idea)`; `suggestIdeas(products): Promise<Map<string,string>>`; `queries.overview(): { rows: {p, status}[]; counts; pausedReason }`.

- [x] **Step 1: lib/suggest.ts**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

type P = { sku: string; name: string; category: string; color: string; material: string; notes: string };

// ponytail: template fallback when no key; good enough to unblock, generic by design.
const TEMPLATES: Record<string, string> = {
  Ceramics: "on a linen-covered breakfast table by a window, soft morning light",
  Textiles: "draped casually over a neutral sofa in a bright living room",
  Kitchen: "on a wooden kitchen counter mid-use, natural daylight",
  Decor: "on a styled shelf with a plant and a book, warm afternoon light",
  Bath: "on a bathroom counter with a folded towel and soft window light",
  Glassware: "on an outdoor table at golden hour with condensation",
};
const fallback = (p: P) => TEMPLATES[p.category] ?? "styled in a calm, minimal home setting with natural light";

export async function suggestIdeas(products: P[]): Promise<Map<string, string>> {
  const out = new Map(products.map(p => [p.sku, fallback(p)]));
  if (!env.anthropicKey || products.length === 0) return out;
  const client = new Anthropic({ apiKey: env.anthropicKey });
  const list = products.map(p => `${p.sku} | ${p.name} | ${p.category} | ${p.color} | ${p.material} | notes: ${p.notes || "-"}`).join("\n");
  const prompt = `You write shot ideas for a small home-goods brand's product photos: the product placed in a real, lived-in scene. Style: short, lowercase, comma-separated fragments like "morning kitchen counter, steam, warm light" or "holiday mantel with evergreen". One idea per product, specific to the product and material, no people, no text. Respond with JSON only: {"<SKU>": "<idea>", ...}.\n\nProducts:\n${list}`;
  try {
    const res = await client.messages.create({ model: "claude-haiku-4-5", max_tokens: 4000, messages: [{ role: "user", content: prompt }] });
    const text = res.content.filter(b => b.type === "text").map(b => b.text).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, string>;
    for (const p of products) if (typeof json[p.sku] === "string" && json[p.sku].trim()) out.set(p.sku, json[p.sku].trim());
  } catch (e) {
    console.warn("suggestIdeas: falling back to templates:", (e as Error).message);
  }
  return out;
}
```

- [x] **Step 2: lib/queries.ts (read model; grows in Tasks 6 and 7)**

```ts
import { db } from "./db";
import type { Product, Candidate, CandidateState } from "./types";
import { productStatus, type ProductStatus } from "./status";

export function overview() {
  const d = db();
  const products = d.prepare("select * from products order by priority desc, sku").all() as Product[];
  const cands = d.prepare("select sku, state from candidates").all() as Pick<Candidate, "sku" | "state">[];
  const bySku = new Map<string, { state: CandidateState }[]>();
  for (const c of cands) bySku.set(c.sku, [...(bySku.get(c.sku) ?? []), c]);
  const rows = products.map(p => ({ p, status: productStatus(!!p.shot_idea, bySku.get(p.sku) ?? []) }));
  const counts = {} as Record<ProductStatus, number>;
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const { paused_reason } = d.prepare("select paused_reason from settings").get() as { paused_reason: string | null };
  return { rows, counts, pausedReason: paused_reason };
}
```

- [x] **Step 3: lib/actions/import.ts**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { db, src } from "@/lib/db";
import type { Product } from "@/lib/types";
import { parseCatalog } from "@/lib/catalog";
import { suggestIdeas } from "@/lib/suggest";

export async function importCatalog(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) return { imported: 0, suggested: 0, errors: ["No file"] };
  const { rows, errors } = parseCatalog(await file.text());
  if (!rows.length) return { imported: 0, suggested: 0, errors };
  const d = db();
  const upsert = d.prepare(`insert into products (sku,name,category,color,material,price,photo_url,shot_idea,shot_idea_source,notes,priority)
    values (@sku,@name,@category,@color,@material,@price,@photo_url,@shot_idea,@shot_idea_source,@notes,@priority)
    on conflict(sku) do update set name=excluded.name, category=excluded.category, color=excluded.color, material=excluded.material,
      price=excluded.price, photo_url=excluded.photo_url, notes=excluded.notes, priority=excluded.priority, updated_at=datetime('now'),
      shot_idea = case when excluded.shot_idea is not null then excluded.shot_idea else products.shot_idea end,
      shot_idea_source = case when excluded.shot_idea is not null then ${src("sheet")} else products.shot_idea_source end`);
  d.transaction(() => { for (const r of rows) upsert.run({ ...r, priority: r.priority ? 1 : 0, shot_idea_source: r.shot_idea ? "sheet" : null }); })();

  const blank = d.prepare("select * from products where shot_idea is null").all() as Product[];
  const ideas = await suggestIdeas(blank);
  const setIdea = d.prepare(`update products set shot_idea=?, shot_idea_source=${src("suggested")} where sku=? and shot_idea is null`);
  d.transaction(() => { for (const [sku, idea] of ideas) setIdea.run(idea, sku); })();
  revalidatePath("/");
  return { imported: rows.length, suggested: ideas.size, errors };
}
```

- [x] **Step 4: lib/actions/review.ts (updateIdea; decide arrives in Task 6)**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { db, src } from "@/lib/db";

export async function updateIdea(sku: string, idea: string) {
  db().prepare(`update products set shot_idea=?, shot_idea_source=${src("edited")}, updated_at=datetime('now') where sku=?`).run(idea.trim() || null, sku);
  revalidatePath("/"); revalidatePath(`/review/${sku}`);
}
```

- [x] **Step 5: app/layout.tsx**

```tsx
import "./globals.css";
export const metadata = { title: "Styled Shots" };
export const viewport = { width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="bg-stone-50 text-stone-900 antialiased">{children}</body></html>;
}
```

- [x] **Step 6: app/page.tsx (status + import; generate form and SpendPanel land in Task 5)**

```tsx
import Link from "next/link";
import { overview } from "@/lib/queries";
import { STATUS_LABEL, type ProductStatus } from "@/lib/status";
import { importCatalog } from "@/lib/actions/import";

export const dynamic = "force-dynamic";

export default function Home() {
  const { rows, counts, pausedReason } = overview();
  return (
    <main className="mx-auto max-w-3xl p-4 space-y-6">
      <h1 className="text-2xl font-semibold">Styled shots</h1>
      {pausedReason && <div className="rounded bg-amber-100 p-3 text-amber-900">Generation paused: {pausedReason}</div>}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 text-sm">
        {(Object.keys(STATUS_LABEL) as ProductStatus[]).map(s => (
          <div key={s} className="rounded bg-white p-3 shadow-sm"><div className="text-2xl">{counts[s] ?? 0}</div>{STATUS_LABEL[s]}</div>
        ))}
      </section>
      <form action={importCatalog} className="rounded bg-white p-3 shadow-sm flex flex-wrap items-center gap-2">
        <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
        <button className="rounded bg-stone-900 px-3 py-2 text-white text-sm">Import catalog CSV</button>
        <span className="text-xs text-stone-500">Same columns as the export. Existing approvals are kept.</span>
      </form>
      <div className="flex gap-3 text-sm">
        <a className="underline" href="/export/csv">Download updated CSV</a>
        <a className="underline" href="/export/zip">Download approved images</a>
      </div>
      <ul className="divide-y rounded bg-white shadow-sm">
        {rows.map(({ p, status }) => (
          <li key={p.sku}>
            <Link href={`/review/${p.sku}`} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0"><div className="font-medium truncate">{p.sku} · {p.name}</div>
                <div className="text-xs text-stone-500 truncate">{p.shot_idea ?? "no idea yet"}{p.shot_idea_source === "suggested" && " (suggested)"}</div></div>
              <span className="shrink-0 rounded-full bg-stone-100 px-2 py-1 text-xs">{STATUS_LABEL[status]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [x] **Step 7: Manual check**

Run: `npm run dev`, open `http://localhost:3000`, import `data/catalog.csv`. Expected: 40 rows, 16 with sheet ideas, 24 marked suggested (templates if no `ANTHROPIC_API_KEY` in the shell; Haiku ideas if set). Re-import: counts unchanged, no duplicates.

- [x] **Step 8: Commit**

```bash
git add -A && git commit -m "import + suggestions + read model + status page

CSV upsert by SKU never touches candidates (money path #9). Blank rows get
a Haiku-suggested idea, labelled, editable, free until generated (D2, D4).
Pages render what lib/queries.ts reads; no SQL in components.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Luma client and photo fetch

**Files:**
- Create: `lib/luma.ts`, `lib/photos.ts`

**Interfaces:**
- Produces: `submitEdit({ prompt, jpegBase64 }): Promise<string>` (generation id); `getGeneration(id): Promise<{ state: GenerationState; url?: string; failure?: { code: LumaFailureCode; userMessage: string; retryable: boolean } }>`; `LumaError` (`code: LumaErrorCode`, `userMessage`, `detail`, `retryable`, `retryAfterMs?`) with subclasses `LumaBudgetError` (402), `LumaRateLimitError` (429); `fetchPhoto(url): Promise<Buffer>`. (D11, 2026-09-04: every documented Luma status and failure_code maps to a code and a plain-English message; the worker pauses on 401 and 403 as well as 402.)

- [x] **Step 1: lib/luma.ts**

```ts
import { env } from "./env";
const API = "https://agents.lumalabs.ai/v1";

export class LumaBudgetError extends Error {}
export class LumaRateLimitError extends Error {}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { Authorization: `Bearer ${env.lumaKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (res.status === 402) throw new LumaBudgetError("Luma: not enough credits");
  if (res.status === 429) throw new LumaRateLimitError("Luma: rate limited");
  if (!res.ok) throw new Error(`Luma ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

export async function submitEdit(args: { prompt: string; jpegBase64: string }): Promise<string> {
  const gen = await call("POST", "/generations", {
    type: "image_edit", model: "uni-1", prompt: args.prompt, output_format: "jpeg",
    source: { data: args.jpegBase64, media_type: "image/jpeg" },
  });
  return gen.id as string;
}

export async function getGeneration(id: string): Promise<{ state: string; url?: string; failure?: string }> {
  const g = await call("GET", `/generations/${id}`);
  return { state: g.state, url: g.output?.[0]?.url, failure: g.failure_reason ? `${g.failure_code ?? ""} ${g.failure_reason}`.trim() : undefined };
}
```

- [x] **Step 2: lib/photos.ts**

```ts
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36";
// The customer's photo host returns 403 to plain clients; a browser UA gets 200.
export async function fetchPhoto(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`photo not reachable (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
```

- [x] **Step 3: Commit**

```bash
git add lib/luma.ts lib/photos.ts && git commit -m "luma client + photo fetch

Typed 402/429 errors so the worker can pause vs back off. Photo fetch
uses a browser UA (host 403s plain clients).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Admission control, worker, notify, analytics, generate actions

**Files:**
- Create: `lib/enqueue.ts`, `lib/worker.ts`, `lib/slack.ts`, `lib/notify.ts`, `lib/analytics.ts`, `lib/actions/generate.ts`, `components/SpendPanel.tsx`, `instrumentation.ts`, `tests/enqueue.test.ts`, `tests/analytics.test.ts`
- Modify: `app/page.tsx` (generate form, resume button, SpendPanel)

**Interfaces:**
- Consumes: `db`, `env`, `buildPrompt`, `submitEdit`, `getGeneration`, `fetchPhoto`, `storage`.
- Produces: `enqueue(skus, kind, opts?): { batchId?: number; queued: number; skipped: string[]; estimatedUsd: number; refused?: string }`; `nextSkus(n)`; `tick()`; `startWorker()`; `notifySlack(text)`; `notifyIfBatchReady()`; `spendSummary()`; `recentBatches(limit)`.

- [x] **Step 1: Failing tests (money paths #1, #8, and the ledger)**

`tests/enqueue.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "shots-"));
process.env.MAX_IMAGES_IN_FLIGHT = "4";
process.env.MAX_TOTAL_SPEND_USD = "1";
const { db } = await import("../lib/db.ts");
const { enqueue } = await import("../lib/enqueue.ts");

const d = db();
for (const sku of ["A", "B", "C"]) d.prepare("insert into products (sku,name,photo_url,shot_idea) values (?,?,?,?)").run(sku, "x", "https://x/a.jpg", "idea");

test("double trigger enqueues once, each trigger is a batch", () => {
  const first = enqueue(["A"], "product");
  assert.equal(first.queued, 2);
  assert.ok(first.batchId);
  const second = enqueue(["A"], "product");
  assert.equal(second.queued, 0);
  assert.deepEqual(second.skipped, ["A"]);
  assert.equal(second.batchId, undefined);
  assert.equal((d.prepare("select count(*) as n from batches").get() as { n: number }).n, 1);
});
test("in-flight cap refuses", () => {
  const r = enqueue(["B", "C"], "next");           // 2 in flight + 4 planned > 4
  assert.equal(r.queued, 0);
  assert.match(r.refused!, /in flight/);
});
test("spend cap refuses", () => {
  d.prepare("update candidates set state='approved', cost_usd=0.5").run(); // spent 1.00 already
  const r = enqueue(["B"], "next");
  assert.equal(r.queued, 0);
  assert.match(r.refused!, /budget/);
});
```

`tests/analytics.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "shots-"));
const { db } = await import("../lib/db.ts");
const { spendSummary, recentBatches } = await import("../lib/analytics.ts");

const d = db();
d.prepare("insert into products (sku,name,photo_url,shot_idea) values ('A','x','https://x/a.jpg','idea')").run();
const b = d.prepare("insert into batches (kind, estimated_usd) values ('next', 0.16)").run().lastInsertRowid;
const ins = d.prepare("insert into candidates (sku,batch_id,prompt,state,cost_usd) values ('A',?,'p',?,?)");
ins.run(b, "approved", 0.04); ins.run(b, "rejected", 0.04); ins.run(b, "failed", 0.04); ins.run(b, "failed", 0);

test("spend by outcome, cost per approved, approval rate", () => {
  const s = spendSummary();
  assert.equal(s.spent.toFixed(2), "0.12");
  assert.equal(s.spentApproved.toFixed(2), "0.04");
  assert.equal(s.spentWasted.toFixed(2), "0.08");   // rejected + failed
  assert.equal(s.approved, 1);
  assert.equal(s.costPerApproved!.toFixed(2), "0.12");
  assert.equal(s.approvalRate, 0.5);                  // 1 approved of 2 decided
});
test("recent batches show estimate vs actual", () => {
  const [row] = recentBatches(5);
  assert.equal(row.kind, "next");
  assert.equal(row.estimated_usd, 0.16);
  assert.equal(row.actual_usd.toFixed(2), "0.12");
  assert.equal(row.images, 4);
});
```

Run: `npm test` → Expected: FAIL, missing modules.

- [x] **Step 2: lib/enqueue.ts (admission control)**

```ts
import { db, inStates } from "./db";
import type { Product, BatchKind } from "./types";
import { env } from "./env";
import { buildPrompt } from "./prompt";

export function enqueue(skus: string[], kind: BatchKind, opts: { perProduct?: number } = {}) {
  const per = opts.perProduct ?? env.candidatesPerProduct;
  const d = db();
  return d.transaction(() => {
    const inFlight = (d.prepare(`select count(*) as n from candidates where state in ${inStates("queued", "processing")}`).get() as { n: number }).n;
    const spent = (d.prepare("select coalesce(sum(cost_usd),0) as s from candidates").get() as { s: number }).s;
    const busy = new Set((d.prepare(`select distinct sku from candidates where state in ${inStates("queued", "processing")}`).all() as { sku: string }[]).map(r => r.sku));
    const targets = skus.length
      ? (d.prepare(`select * from products where sku in (${skus.map(() => "?").join(",")}) and shot_idea is not null`).all(...skus) as Product[]).filter(p => !busy.has(p.sku))
      : [];
    const skipped = skus.filter(s => !targets.some(p => p.sku === s));
    const planned = targets.length * per;
    const estimatedUsd = planned * env.costPerImage;
    if (planned === 0) return { queued: 0, skipped, estimatedUsd: 0 };
    if (inFlight + planned > env.maxInFlight)
      return { queued: 0, skipped, estimatedUsd, refused: `${inFlight} images already in flight; adding ${planned} would exceed the ${env.maxInFlight} in-flight cap. Wait for the current batch.` };
    if (spent + inFlight * env.costPerImage + estimatedUsd > env.maxTotalSpend)
      return { queued: 0, skipped, estimatedUsd, refused: `This would take total spend past the $${env.maxTotalSpend} budget cap (spent $${spent.toFixed(2)}). Raise MAX_TOTAL_SPEND_USD to continue.` };
    const batchId = Number(d.prepare("insert into batches (kind, estimated_usd) values (?, ?)").run(kind, estimatedUsd).lastInsertRowid);
    const ins = d.prepare("insert into candidates (sku, batch_id, prompt) values (?, ?, ?)");
    for (const p of targets) for (let i = 0; i < per; i++) ins.run(p.sku, batchId, buildPrompt(p, p.shot_idea!));
    return { batchId, queued: planned, skipped, estimatedUsd };
  })();
}

/** Next N products by priority that have an idea and nothing in flight or approved yet. */
export function nextSkus(n: number): string[] {
  return (db().prepare(`select p.sku from products p where p.shot_idea is not null
    and not exists (select 1 from candidates c where c.sku = p.sku and c.state in ${inStates("queued", "processing", "completed", "approved")})
    order by p.priority desc, p.sku limit ?`).all(n) as { sku: string }[]).map(r => r.sku);
}
```

- [x] **Step 3: lib/analytics.ts (money reporting)**

```ts
import { db, st, inStates } from "./db";
import type { Batch } from "./types";

export function spendSummary() {
  const r = db().prepare(`select
      coalesce(sum(cost_usd), 0) as spent,
      coalesce(sum(case when state = ${st("approved")} then cost_usd end), 0) as spentApproved,
      coalesce(sum(case when state in ${inStates("rejected", "failed")} then cost_usd end), 0) as spentWasted,
      coalesce(sum(case when state in ${inStates("completed", "queued", "processing")} then cost_usd end), 0) as spentPending,
      coalesce(sum(state = ${st("approved")}), 0) as approved,
      coalesce(sum(state in ${inStates("approved", "rejected")}), 0) as decided,
      coalesce(sum(cost_usd > 0), 0) as generated
    from candidates`).get() as { spent: number; spentApproved: number; spentWasted: number; spentPending: number; approved: number; decided: number; generated: number };
  return {
    ...r,
    costPerApproved: r.approved ? r.spent / r.approved : null,
    approvalRate: r.decided ? r.approved / r.decided : null,
  };
}

export function recentBatches(limit = 10) {
  return db().prepare(`select b.*, count(c.id) as images, coalesce(sum(c.cost_usd), 0) as actual_usd,
      coalesce(sum(c.state = ${st("approved")}), 0) as approved
    from batches b left join candidates c on c.batch_id = b.id
    group by b.id order by b.id desc limit ?`).all(limit) as (Batch & { images: number; actual_usd: number; approved: number })[];
}

export function spendBySku(): Map<string, number> {
  const rows = db().prepare("select sku, coalesce(sum(cost_usd),0) as s from candidates group by sku").all() as { sku: string; s: number }[];
  return new Map(rows.map(r => [r.sku, r.s]));
}
```

Run: `npm test` → Expected: enqueue and analytics tests PASS.

- [x] **Step 4: lib/slack.ts (transport) and lib/notify.ts (policy)**

`lib/slack.ts`:
```ts
import { env } from "./env";
export async function notifySlack(text: string) {
  if (!env.slackWebhook) return;
  try { await fetch(env.slackWebhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }); }
  catch (e) { console.warn("slack:", (e as Error).message); }
}
```

`lib/notify.ts`:
```ts
import { db, st, inStates } from "./db";
import { env } from "./env";
import { notifySlack } from "./slack";

/** One message per settled batch: nothing in flight, and something completed since the last message. */
export async function notifyIfBatchReady() {
  const d = db();
  const pending = (d.prepare(`select count(*) as n from candidates where state in ${inStates("queued", "processing")}`).get() as { n: number }).n;
  if (pending > 0) return;
  const s = d.prepare("select last_notified_at from settings").get() as { last_notified_at: string | null };
  const ready = d.prepare(`select count(distinct sku) as n, max(created_at) as latest from candidates where state=${st("completed")}`).get() as { n: number; latest: string | null };
  if (!ready.n || !ready.latest || (s.last_notified_at && s.last_notified_at >= ready.latest)) return;
  await notifySlack(`${ready.n} product${ready.n === 1 ? "" : "s"} ready to review: ${env.appUrl}/?k=${env.accessToken}`);
  d.prepare("update settings set last_notified_at=datetime('now')").run();
}
```

- [x] **Step 5: lib/worker.ts (advance generation only)**

```ts
import { db, st } from "./db";
import type { Candidate } from "./types";
import { env } from "./env";
import { storage } from "./storage";
import { fetchPhoto } from "./photos";
import { submitEdit, getGeneration, LumaBudgetError, LumaRateLimitError } from "./luma";
import { notifyIfBatchReady } from "./notify";

const MAX_ATTEMPTS = 5;
let running = false;

export async function tick() {
  if (running) return;            // money path #2: single flight
  running = true;
  try { await submitQueued(); await pollProcessing(); await notifyIfBatchReady(); }
  catch (e) { console.error("tick:", (e as Error).message); }
  finally { running = false; }
}

async function submitQueued() {
  const d = db();
  if ((d.prepare("select paused_reason from settings").get() as { paused_reason: string | null }).paused_reason) return; // money path #4
  const inFlight = (d.prepare(`select count(*) as n from candidates where state=${st("processing")}`).get() as { n: number }).n;
  const slots = env.lumaConcurrency - inFlight;
  if (slots <= 0) return;
  const rows = d.prepare(`select c.*, p.photo_url from candidates c join products p on p.sku=c.sku where c.state=${st("queued")} order by c.id limit ?`).all(slots) as (Candidate & { photo_url: string })[];
  const photos = new Map<string, string>();
  for (const c of rows) {
    try {
      if (!photos.has(c.sku)) photos.set(c.sku, (await fetchPhoto(c.photo_url)).toString("base64"));
    } catch (e) {
      d.prepare(`update candidates set state=${st("failed")}, failure_reason=? where id=?`).run((e as Error).message, c.id); // money path #12, cost stays 0
      continue;
    }
    try {
      const gid = await submitEdit({ prompt: c.prompt, jpegBase64: photos.get(c.sku)! });
      // Money is committed here, so cost is recorded here (Global Constraints).
      d.prepare(`update candidates set state=${st("processing")}, luma_generation_id=?, attempts=attempts+1, cost_usd=? where id=?`).run(gid, env.costPerImage, c.id);
    } catch (e) {
      if (e instanceof LumaBudgetError) { d.prepare("update settings set paused_reason=?").run("Luma credits exhausted. Top up, then press Resume."); return; }
      if (e instanceof LumaRateLimitError) return;                                   // money path #5
      const attempts = c.attempts + 1;                                                // money path #6
      if (attempts >= MAX_ATTEMPTS) d.prepare(`update candidates set state=${st("failed")}, failure_reason=?, attempts=? where id=?`).run((e as Error).message, attempts, c.id);
      else d.prepare("update candidates set attempts=? where id=?").run(attempts, c.id);
    }
  }
}

async function pollProcessing() {
  const d = db();
  const rows = d.prepare(`select * from candidates where state=${st("processing")}`).all() as Candidate[];
  for (const c of rows) {
    try {
      const g = await getGeneration(c.luma_generation_id!);
      if (g.state === "failed") { d.prepare(`update candidates set state=${st("failed")}, failure_reason=? where id=?`).run(g.failure ?? "generation failed", c.id); continue; }
      if (g.state !== "completed" || !g.url) continue;
      const res = await fetch(g.url);
      if (!res.ok) { console.warn(`download ${res.status} for ${c.id}, will re-poll`); continue; }  // money path #7
      storage.saveImage(c.id, Buffer.from(await res.arrayBuffer()));
      d.prepare(`update candidates set state=${st("completed")} where id=?`).run(c.id);
    } catch (e) { console.warn(`poll ${c.id}:`, (e as Error).message); }
  }
}

export function startWorker() {
  const stuck = (db().prepare(`select count(*) as n from candidates where state=${st("queued")} and attempts>0`).get() as { n: number }).n;
  if (stuck) console.warn(`worker: ${stuck} candidate(s) were mid-submit at last shutdown; they will be resubmitted (money path #3)`);
  setInterval(() => void tick(), env.tickMs);
}
```

- [x] **Step 6: instrumentation.ts**

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionEnv } = await import("./lib/env");
    assertProductionEnv();
    const { startWorker } = await import("./lib/worker");
    startWorker();
  }
}
```

- [x] **Step 7: lib/actions/generate.ts**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { db, src } from "@/lib/db";
import { enqueue, nextSkus } from "@/lib/enqueue";
import { tick } from "@/lib/worker";

function after(sku?: string) { void tick(); revalidatePath("/"); if (sku) revalidatePath(`/review/${sku}`); }

export async function generateNext(formData: FormData) {
  const n = Math.max(1, Math.min(40, Number(formData.get("n") ?? 10)));
  const r = enqueue(nextSkus(n), "next"); after(); return r;
}
export async function generateSku(sku: string) {
  const r = enqueue([sku], "product"); after(sku); return r;
}
export async function tryAgain(sku: string, note: string) {
  if (note.trim()) {
    const d = db();
    const p = d.prepare("select shot_idea from products where sku=?").get(sku) as { shot_idea: string | null };
    d.prepare(`update products set shot_idea=?, shot_idea_source=${src("edited")} where sku=?`).run(`${p.shot_idea ?? ""}, ${note.trim()}`, sku);
  }
  const r = enqueue([sku], "retry"); after(sku); return r;
}
export async function resumeWorker() {
  db().prepare("update settings set paused_reason=null").run(); after();
}
```

- [x] **Step 8: components/SpendPanel.tsx**

```tsx
import { spendSummary, recentBatches } from "@/lib/analytics";
const usd = (n: number) => `$${n.toFixed(2)}`;
export function SpendPanel() {
  const s = spendSummary(); const batches = recentBatches(5);
  return (
    <section className="rounded bg-white p-3 shadow-sm text-sm space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div><div className="text-xl">{usd(s.spent)}</div>spent total</div>
        <div><div className="text-xl">{usd(s.spentApproved)}</div>on approved</div>
        <div><div className="text-xl">{usd(s.spentWasted)}</div>on rejected or failed</div>
        <div><div className="text-xl">{s.costPerApproved == null ? "–" : usd(s.costPerApproved)}</div>per approved image{s.approvalRate != null && ` · ${Math.round(s.approvalRate * 100)}% approved`}</div>
      </div>
      {batches.length > 0 && (
        <table className="w-full text-xs text-stone-600"><tbody>
          {batches.map(b => <tr key={b.id}><td>{b.created_at}</td><td>{b.kind}</td><td>{b.images} images</td><td>est {usd(b.estimated_usd)}</td><td>actual {usd(b.actual_usd)}</td><td>{b.approved} approved</td></tr>)}
        </tbody></table>
      )}
    </section>
  );
}
```

- [x] **Step 9: Status page additions**

In `app/page.tsx`, import `generateNext`, `resumeWorker` from `@/lib/actions/generate`, `SpendPanel`, and `env`. After the banner add:

```tsx
{pausedReason && <form action={resumeWorker}><button className="rounded bg-amber-700 px-3 py-2 text-white text-sm">Resume generation</button></form>}
<SpendPanel />
<form action={generateNext} className="rounded bg-white p-3 shadow-sm flex flex-wrap items-center gap-2 text-sm">
  <span>Generate the next</span>
  <input type="number" name="n" defaultValue={10} min={1} max={40} className="w-16 rounded border px-2 py-1" />
  <span>products · {env.candidatesPerProduct} candidates each · about ${(10 * env.candidatesPerProduct * env.costPerImage).toFixed(2)} per 10 products</span>
  <button className="rounded bg-stone-900 px-3 py-2 text-white">Generate</button>
  <span className="text-xs text-stone-500">Caps: {env.maxInFlight} in flight, ${env.maxTotalSpend} total.</span>
</form>
```

- [x] **Step 10: Manual check with a paused account**

Run: `npm run dev` with `LUMA_AGENTS_API_KEY` in the shell (never printed). Click Generate next 1. Expected with zero credits: banner "Luma credits exhausted", candidates stay queued at cost 0, spend panel shows $0.00, no log storm. With credits: two candidates go `processing` (cost recorded) then `completed` within about a minute, images appear under `data-local/images/`, the batch row shows est = actual.

- [x] **Step 11: Commit**

```bash
git add -A && git commit -m "generation: admission control, worker, notify policy, spend analytics

Enqueue is one transaction: skips products with work in flight, refuses
past the in-flight cap and the total spend cap, creates a batch per
trigger. Cost is recorded when Luma accepts the job. Worker is
single-flight, pauses on 402, backs off on 429, fails after 5 errors,
re-polls on expired download URLs. Notify policy lives apart from the
Slack transport. Spend panel: by outcome, per approved, per batch.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Review page and image route

**Files:**
- Create: `app/review/[sku]/page.tsx`, `app/img/[id]/route.ts`, `components/IdeaForm.tsx`
- Modify: `lib/actions/review.ts` (add `decide`), `lib/queries.ts` (add `productDetail`)

**Interfaces:**
- Consumes: `db`, `storage`, `productStatus`, `generateSku`, `tryAgain`, `updateIdea`.
- Produces: `decide(formData)`; `queries.productDetail(sku): { p, cands, status, prev?, next? } | null`.

- [x] **Step 1: decide action**

Append to `lib/actions/review.ts`, and change its db import to `import { db, inStates } from "@/lib/db";`:
```ts
export async function decide(formData: FormData) {
  const id = Number(formData.get("id")); const state = String(formData.get("state")); const sku = String(formData.get("sku"));
  const who = String(formData.get("who") ?? "").trim() || "Ellie";
  if (state !== "approved" && state !== "rejected") return;
  db().prepare(`update candidates set state=?, decided_by=?, decided_at=datetime('now') where id=? and state in ${inStates("completed", "approved", "rejected")}`).run(state, who, id);
  revalidatePath("/"); revalidatePath(`/review/${sku}`);
}
```

- [x] **Step 2: productDetail query**

Append to `lib/queries.ts` (Product and Candidate are already imported from `./types`):
```ts
export function productDetail(sku: string) {
  const d = db();
  const p = d.prepare("select * from products where sku=?").get(sku) as Product | undefined;
  if (!p) return null;
  const cands = d.prepare("select * from candidates where sku=? order by id desc").all(sku) as Candidate[];
  const nav = (d.prepare("select sku from products order by priority desc, sku").all() as { sku: string }[]).map(r => r.sku);
  const i = nav.indexOf(sku);
  return { p, cands, status: productStatus(!!p.shot_idea, cands), prev: nav[i - 1], next: nav[i + 1] };
}
```

- [x] **Step 3: app/img/[id]/route.ts**

```ts
import { storage } from "@/lib/storage";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const buf = storage.readImage(Number((await params).id));
  if (!buf) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
}
```

- [x] **Step 4: components/IdeaForm.tsx**

```tsx
"use client";
import { useState } from "react";
export function IdeaForm({ sku, idea, source, onSave }: { sku: string; idea: string | null; source: string | null; onSave: (sku: string, idea: string) => Promise<void> }) {
  const [v, setV] = useState(idea ?? "");
  return (
    <form action={() => onSave(sku, v)} className="space-y-1">
      <label className="text-xs text-stone-500">Shot idea {source === "suggested" && "(suggested, edit if you like)"}</label>
      <textarea value={v} onChange={e => setV(e.target.value)} rows={2} className="w-full rounded border p-2 text-sm" />
      {v !== (idea ?? "") && <button className="rounded bg-stone-900 px-3 py-1.5 text-white text-sm">Save idea</button>}
    </form>
  );
}
```

- [x] **Step 5: app/review/[sku]/page.tsx**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { productDetail } from "@/lib/queries";
import { STATUS_LABEL } from "@/lib/status";
import { env } from "@/lib/env";
import { decide, updateIdea } from "@/lib/actions/review";
import { generateSku, tryAgain } from "@/lib/actions/generate";
import { IdeaForm } from "@/components/IdeaForm";

export const dynamic = "force-dynamic";

export default async function Review({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const detail = productDetail(sku);
  if (!detail) notFound();
  const { p, cands, status, prev, next } = detail;
  const perCost = (env.candidatesPerProduct * env.costPerImage).toFixed(2);

  return (
    <main className="mx-auto max-w-lg p-4 space-y-4">
      <div className="flex items-center justify-between text-sm">
        <Link href="/" className="underline">All products</Link>
        <span className="rounded-full bg-stone-100 px-2 py-1 text-xs">{STATUS_LABEL[status]}</span>
        <div className="space-x-3">
          {prev && <Link href={`/review/${prev}`} className="underline">Prev</Link>}
          {next && <Link href={`/review/${next}`} className="underline">Next</Link>}
        </div>
      </div>
      <h1 className="text-xl font-semibold">{p.sku} · {p.name}</h1>
      <div className="flex gap-3 text-sm">
        <img src={p.photo_url} alt="" className="h-24 w-24 rounded object-cover bg-white" />
        <div className="text-stone-600">{[p.color, p.material, p.price].filter(Boolean).join(" · ")}{p.notes && <div className="mt-1 text-xs italic">Notes: {p.notes}</div>}</div>
      </div>
      <IdeaForm sku={p.sku} idea={p.shot_idea} source={p.shot_idea_source} onSave={updateIdea} />
      {p.shot_idea && status !== "generating" && (
        <form action={async () => { "use server"; await generateSku(sku); }}>
          <button className="rounded bg-stone-900 px-3 py-2 text-white text-sm">{cands.length ? "Generate 2 more" : "Generate 2 candidates"} · ${perCost}</button>
        </form>
      )}
      <ul className="space-y-4">
        {cands.map(c => (
          <li key={c.id} className="rounded bg-white p-2 shadow-sm">
            {c.state === "queued" || c.state === "processing" ? <div className="p-6 text-center text-sm text-stone-500">Generating…</div>
            : c.state === "failed" ? <div className="p-3 text-sm text-red-700">Failed: {c.failure_reason}</div>
            : <img src={`/img/${c.id}`} alt="" className="w-full rounded" />}
            {["completed", "approved", "rejected"].includes(c.state) && (
              <div className="mt-2 flex items-center gap-2">
                {(["approved", "rejected"] as const).map(s => (
                  <form key={s} action={decide} className="flex-1">
                    <input type="hidden" name="id" value={c.id} /><input type="hidden" name="sku" value={sku} /><input type="hidden" name="state" value={s} />
                    <button className={`w-full rounded px-3 py-3 text-sm ${c.state === s ? (s === "approved" ? "bg-green-700 text-white" : "bg-red-700 text-white") : "bg-stone-100"}`}>
                      {s === "approved" ? "Approve" : "Reject"}
                    </button>
                  </form>
                ))}
              </div>
            )}
            {c.decided_by && <div className="mt-1 text-xs text-stone-500">{c.state} by {c.decided_by}</div>}
          </li>
        ))}
      </ul>
      {cands.some(c => c.state === "rejected") && status !== "generating" && (
        <form action={async (fd: FormData) => { "use server"; await tryAgain(sku, String(fd.get("note") ?? "")); }} className="flex gap-2">
          <input name="note" placeholder="What to change (optional)" className="flex-1 rounded border px-2 py-2 text-sm" />
          <button className="rounded bg-stone-900 px-3 py-2 text-white text-sm">Try again · ${perCost}</button>
        </form>
      )}
    </main>
  );
}
```

- [x] **Step 6: Manual check on a phone-width viewport**

Run dev, open `/review/HG-002` at 375px wide. Expected: original photo, idea editable, generate button with cost, candidates stack vertically, approve/reject are full-width thumb targets, prev/next work.

- [x] **Step 7: Commit**

```bash
git add -A && git commit -m "review page: one product per screen, thumb-sized approve/reject

Cost shown on every generate button. Try-again is its own batch and
appends the note to the idea so the next prompt carries it. Decisions
record who decided. Page renders queries.productDetail; no SQL inline.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Exports (CSV, zip)

**Files:**
- Create: `lib/export.ts`, `app/export/csv/route.ts`, `app/export/zip/route.ts`
- Modify: `lib/queries.ts` (add `approvedByProduct`)

**Interfaces:**
- Consumes: `db`, `storage`, `approvedFilename`, `productStatus`, `STATUS_LABEL`, `REQUIRED_HEADERS`, `spendBySku`.
- Produces: `queries.approvedByProduct()`; `exportCsv(): string`; `exportZip(): ReadableStream<Uint8Array>` (streamed per file, D14).

- [x] **Step 1: approvedByProduct query**

Append to `lib/queries.ts`:
```ts
import { approvedFilename } from "./names";
export function approvedByProduct() {
  const d = db();
  const products = d.prepare("select * from products order by sku").all() as Product[];
  const cands = d.prepare("select * from candidates order by id").all() as Candidate[];
  return products.map(p => {
    const mine = cands.filter(c => c.sku === p.sku);
    const approved = mine.filter(c => c.state === "approved").map((c, i) => ({ c, name: approvedFilename(p.sku, p.shot_idea, i + 1) }));
    return { p, approved, status: productStatus(!!p.shot_idea, mine) };
  });
}
```

- [x] **Step 2: lib/export.ts (formats only)**

```ts
import { stringify } from "csv-stringify/sync";
import { zipSync } from "fflate";
import { storage } from "./storage";
import { STATUS_LABEL } from "./status";
import { REQUIRED_HEADERS } from "./catalog";
import { approvedByProduct } from "./queries";
import { spendBySku } from "./analytics";
import { env } from "./env";

export function exportCsv(): string {
  const spend = spendBySku();
  const rows = approvedByProduct().map(({ p, approved, status }) => ({
    SKU: p.sku, "Product Name": p.name, Category: p.category, "Color / Finish": p.color, Material: p.material, Price: p.price,
    Photo: p.photo_url, "Shot Idea": p.shot_idea ?? "", Notes: p.notes,
    Status: STATUS_LABEL[status], "Approved Images": approved.map(a => `${env.appUrl}/img/${a.c.id}`).join("; "),
    "Approved Filenames": approved.map(a => a.name).join("; "), "Spent (USD)": (spend.get(p.sku) ?? 0).toFixed(2),
  }));
  return stringify(rows, { header: true, columns: [...REQUIRED_HEADERS, "Status", "Approved Images", "Approved Filenames", "Spent (USD)"] });
}

export function exportZip(): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const { approved } of approvedByProduct()) for (const a of approved) { const b = storage.readImage(a.c.id); if (b) files[a.name] = new Uint8Array(b); }
  files["manifest.csv"] = new TextEncoder().encode(exportCsv());
  return zipSync(files, { level: 0 });
}
```

- [x] **Step 3: Routes**

`app/export/csv/route.ts`:
```ts
import { exportCsv } from "@/lib/export";
export const dynamic = "force-dynamic";
export async function GET() {
  return new Response(exportCsv(), { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="catalog-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
```
`app/export/zip/route.ts`:
```ts
import { exportZip } from "@/lib/export";
export const dynamic = "force-dynamic";
export async function GET() {
  return new Response(exportZip(), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="approved-${new Date().toISOString().slice(0, 10)}.zip"` } });
}
```

- [x] **Step 4: Manual check, commit**

Download both from the status page. Expected: CSV opens in Sheets with the original nine columns first; zip contains `HG-xxx-...-01.jpg` files plus `manifest.csv`.

```bash
git add -A && git commit -m "exports: updated catalog CSV and approved-images zip

Original columns preserved and first; status, filenames and per-product
spend appended. Zip is the Drive hand-off (D3): deterministic names plus
a manifest.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Access gate, Dockerfile, Railway, docs

**Files:**
- Create: `middleware.ts`, `Dockerfile`, `railway.json`, `.dockerignore`
- Modify: `.env.example`, `README.md` (append a "Running it" section only; the brief stays intact)

- [x] **Step 1: middleware.ts**

```ts
import { NextResponse, type NextRequest } from "next/server";
export function middleware(req: NextRequest) {
  const token = process.env.ACCESS_TOKEN;
  if (!token) return NextResponse.next();                       // local dev without a token
  const k = req.nextUrl.searchParams.get("k");
  if (k === token) {
    const url = req.nextUrl.clone(); url.searchParams.delete("k");
    const res = NextResponse.redirect(url);
    res.cookies.set("k", token, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge: 60 * 60 * 24 * 365 });
    return res;
  }
  if (req.cookies.get("k")?.value === token) return NextResponse.next();
  return new NextResponse("This page needs the team link. Ask Maya or Ellie for it.", { status: 401 });
}
export const config = { matcher: ["/((?!_next|favicon.ico|healthz).*)"] };
```

Add `app/healthz/route.ts`: `export const GET = () => new Response("ok");`

- [x] **Step 2: Dockerfile and .dockerignore**

```dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

`.dockerignore`: `node_modules`, `.next`, `data-local`, `scratch`, `.env.local`, `.git`.

`railway.json`:
```json
{ "$schema": "https://railway.app/railway.schema.json", "build": { "builder": "DOCKERFILE" }, "deploy": { "restartPolicyType": "ON_FAILURE", "healthcheckPath": "/healthz", "healthcheckTimeout": 60 } }
```

- [x] **Step 3: .env.example**

Replace contents with the keys this app actually reads, no values:
```
LUMA_AGENTS_API_KEY=
ANTHROPIC_API_KEY=            # optional: Haiku shot-idea suggestions; template fallback without it
ANTHROPIC_WORKSPACE_ID=       # required only for identity-linked Anthropic keys (API returns 400 without it)
SLACK_WEBHOOK_URL=            # optional: one message per finished batch
ACCESS_TOKEN=                 # long random string; the team link is APP_URL/?k=ACCESS_TOKEN
APP_URL=http://localhost:3000
DATA_DIR=./data-local         # /data on Railway (volume)
LUMA_COST_PER_IMAGE_USD=0.0434
CANDIDATES_PER_PRODUCT=2
MAX_IMAGES_IN_FLIGHT=40
MAX_TOTAL_SPEND_USD=25
LUMA_CONCURRENCY=4
```

- [x] **Step 4: Deploy**

Railway: new project from the GitHub repo, add a volume mounted at `/data`, set the env vars above (paste the Luma key from `.env.local` by hand, never via this session), enable a daily volume backup in the volume settings, generate a domain, set `APP_URL` to it. Verify: open `APP_URL/?k=TOKEN`, import `data/catalog.csv`, generate 1, watch it complete, approve on a phone, download zip.

- [x] **Step 5: README run section, commit**

Append to `README.md` a short "Running it" section: env vars, `npm install && npm run prepare` (enables the pre-commit hook), `npm run dev`, `npm run check`, deploy notes, the team link format. Then:

```bash
git add -A && git commit -m "deploy: shared-link gate, Dockerfile, Railway config, env example

One token for the whole team (ASSUMPTIONS #1). Standalone Next build in
a slim image; volume at /data holds the DB and images.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Final docs

**Files:**
- Modify: `APPROACH.md` (fill every *(fill after build)* section from what shipped), `ASSUMPTIONS.md` (any assumption that changed), `DECISIONS.md` (any material choice made during build), `video.md` (link)

- [ ] Fill APPROACH.md: live URL, key decisions and tradeoffs, road not taken, scope ledger (in / out / next with reasoning), unit economics from the spend panel's real numbers (dollars: spend ÷ approved; minutes: Ellie's seconds per candidate plus Maya's import; at 10× catalog: what changes is the in-flight cap, review time, and volume size, not the code), what breaks first (Ellie's attention at 80 candidates in one batch, then the single instance).
- [ ] Record the video, paste the link in `video.md`.
- [ ] Commit, push, run `./submit.sh`.

---

## Self-review

- **Spec coverage:** import (T3), suggestions (T3), generate with cost and caps (T5), cost ledger by outcome, batch and product (T5, T7), Slack one-per-batch (T5), review on phone (T6), approved copied out of Luma before expiry (T5 downloads on completion, stricter than the design draft and avoids the 1-hour race), deterministic filenames (T2, T7), CSV and zip export (T7), status page (T3, T5), shared-link access (T8), poll loop restart-safe (T5), 402 pause and resume (T5), deploy on Railway with volume and backups (T8), docs (T9).
- **Single responsibility check:** `worker.ts` no longer decides when to notify (`notify.ts` does) and no longer computes money (`analytics.ts` does). Pages hold no SQL (`queries.ts`). Actions are split by concern. `export.ts` only formats. `slack.ts` only transports. `enqueue.ts` is admission control and nothing else.
- **Deviation from APPROACH.md, deliberate:** images are downloaded at *completion*, not at approval. Rejected candidates stay on disk; pruning is in the D6 scaling plan, not v1. Cost is recorded at *submission*, not completion. Update APPROACH.md wording in T9.
- **Placeholder scan:** none.
- **Stringly-typed check:** no function signature in this plan takes `state: string`, and no SQL outside `tests/` spells a state or idea-source literal: every one goes through `st()`, `inStates()` or `src()` from `lib/db.ts`, which take the union. Every comparison against a state name is against the `CandidateState` union or a `ProductStatus` member, and the schema's CHECK constraints are generated from the same const arrays, so the two cannot drift.
- **Failed products:** `failed` is its own status with its own count on the status page. The review page's generate button already shows for any non-generating status, so a failed product has a one-tap retry; the failure reason is on each card.
- **Type consistency:** `enqueue(skus, kind, opts?)` returns `{ batchId?, queued, skipped, estimatedUsd, refused? }` and is consumed as such in T5 actions and tests; `BatchKind` values `next | product | retry` match `enqueue` call sites; `decide` takes FormData in T6 and the review page posts `id`, `sku`, `state`; `productStatus(hasIdea, candidates)` signature matches T2, T3, T6, T7; `storage.readImage` returns `Buffer | null` in T1 and is checked in T6 and T7; `spendSummary` field names match the analytics test and `SpendPanel`.
