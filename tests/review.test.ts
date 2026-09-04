import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Candidate, CandidateState } from "../lib/types.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-review-"));
process.env.DATA_DIR = dir;

const { db } = await import("../lib/db.ts");
const { decideCandidate } = await import("../lib/review.ts");

after(() => {
  db().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const d = db();
d.prepare(
  "insert into products (sku,name,photo_url) values ('HG-002','Stoneware Mug 12oz','https://x/hg-002.jpg')",
).run();
const batchId = d.prepare("insert into batches (kind) values ('product')").run()
  .lastInsertRowid as number;

function candidate(state: CandidateState): number {
  return Number(
    d
      .prepare(
        "insert into candidates (sku, batch_id, prompt, state) values ('HG-002', ?, 'p', ?)",
      )
      .run(batchId, state).lastInsertRowid,
  );
}
const read = (id: number) =>
  d.prepare("select * from candidates where id=?").get(id) as Candidate;

test("approving a completed candidate records the state, who and when", () => {
  const id = candidate("completed");
  assert.equal(decideCandidate(id, "approved", "Ellie", "HG-002"), 1);
  const c = read(id);
  assert.equal(c.state, "approved");
  assert.equal(c.decided_by, "Ellie");
  assert.ok(c.decided_at, "decided_at is stamped");
});

test("a decision can be changed: approved flips to rejected", () => {
  const id = candidate("completed");
  decideCandidate(id, "approved", "Ellie", "HG-002");
  assert.equal(decideCandidate(id, "rejected", "Maya", "HG-002"), 1);
  const c = read(id);
  assert.equal(c.state, "rejected");
  assert.equal(c.decided_by, "Maya");
});

test("a candidate with no image to judge cannot be decided", () => {
  for (const state of ["queued", "processing", "failed"] as const) {
    const id = candidate(state);
    assert.equal(decideCandidate(id, "approved", "Ellie", "HG-002"), 0, state);
    assert.equal(read(id).state, state);
    assert.equal(read(id).decided_by, null);
  }
});

test("an unknown id changes nothing", () => {
  assert.equal(decideCandidate(999_999, "approved", "Ellie", "HG-002"), 0);
});

// The action is glue over parseDecision; the parsing is where the guards live, and it is
// pure, so it is tested directly. (The action's happy path calls revalidatePath, which needs
// a Next request context and cannot run here.)
test("parseDecision rejects a bad id or a state that is not a decision", async () => {
  const { parseDecision } = await import("../lib/review.ts");
  const form = (id: string, state: string, who?: string, sku = "HG-002") => {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("state", state);
    fd.set("sku", sku);
    if (who !== undefined) fd.set("who", who);
    return fd;
  };
  for (const id of ["1.5", "-1", "0", "abc", ""])
    assert.equal(parseDecision(form(id, "approved")), null, id);
  for (const state of ["queued", "processing", "failed", "completed", ""])
    assert.equal(parseDecision(form("7", state)), null, state);
  for (const sku of ["", "   ", "x".repeat(65)])
    assert.equal(
      parseDecision(form("7", "approved", undefined, sku)),
      null,
      sku,
    );
  assert.deepEqual(parseDecision(form("7", "approved")), {
    id: 7,
    state: "approved",
    who: "Ellie",
    sku: "HG-002",
  });
  assert.deepEqual(parseDecision(form("7", "rejected", "  Maya  ")), {
    id: 7,
    state: "rejected",
    who: "Maya",
    sku: "HG-002",
  });
  assert.equal(
    parseDecision(form("7", "approved", "M".repeat(200)))?.who.length,
    80,
    "who is truncated, not refused: it is a display string",
  );
});

test("a candidate cannot be decided through another product's page", () => {
  const id = candidate("completed");
  assert.equal(decideCandidate(id, "approved", "Ellie", "HG-999"), 0);
  assert.equal(read(id).state, "completed");
  assert.equal(read(id).decided_by, null);
  assert.equal(decideCandidate(id, "approved", "Ellie", "HG-002"), 1);
});

test("the decide action writes nothing for a form parseDecision rejects", async () => {
  const { decide } = await import("../lib/actions/review.ts");
  const id = candidate("completed");
  const fd = new FormData();
  fd.set("id", String(id));
  fd.set("sku", "HG-002");
  fd.set("state", "deleted");
  await decide(fd);
  assert.equal(read(id).state, "completed");
});
