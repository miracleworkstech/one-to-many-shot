import { test } from "node:test";
import assert from "node:assert/strict";
import { pageOf, pageParam } from "../lib/paging.ts";

const rows = Array.from({ length: 33 }, (_, i) => i + 1);

test("pageOf: pages of 12 over 33 rows", () => {
  const first = pageOf(rows, 1, 12);
  assert.deepEqual(first.items, rows.slice(0, 12));
  assert.equal(first.pages, 3);
  assert.equal(first.from, 1);
  assert.equal(first.to, 12);

  const last = pageOf(rows, 3, 12);
  assert.deepEqual(last.items, [25, 26, 27, 28, 29, 30, 31, 32, 33]);
  assert.equal(last.from, 25);
  assert.equal(last.to, 33);
});

test("pageOf: out-of-range pages clamp to a real page", () => {
  assert.equal(pageOf(rows, 99, 12).page, 3);
  assert.equal(pageOf(rows, 0, 12).page, 1);
  assert.equal(pageOf(rows, -4, 12).page, 1);
});

test("pageOf: an empty list is one empty page", () => {
  const empty = pageOf([], 2, 12);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.pages, 1);
  assert.equal(empty.page, 1);
  assert.equal(empty.from, 0);
  assert.equal(empty.to, 0);
});

test("pageOf: a page size that is not a positive integer is a programmer error", () => {
  for (const size of [0, -1, 1.5, NaN, Infinity])
    assert.throws(() => pageOf(rows, 1, size), RangeError);
});

test("pageOf: a list that fits is one page", () => {
  assert.equal(pageOf(rows.slice(0, 12), 1, 12).pages, 1);
});

test("pageParam: positive integers only, first value of a repeated key", () => {
  assert.equal(pageParam("2"), 2);
  assert.equal(pageParam(["3", "4"]), 3);
  assert.equal(pageParam(undefined), 1);
  assert.equal(pageParam("x"), 1);
  assert.equal(pageParam("0"), 1);
  assert.equal(pageParam("-1"), 1);
  assert.equal(pageParam("1.5"), 1);
});
