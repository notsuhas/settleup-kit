import assert from "node:assert/strict";
import { test } from "node:test";
import { inviteHash, pushId } from "../pushid.js";

const PUSH_CHARS = /^[-0-9A-Z_a-z]{20}$/;

test("a push id is 20 characters from Firebase's alphabet", () => {
  assert.match(pushId(), PUSH_CHARS);
});

test("ids sort chronologically as plain strings", () => {
  // This is the whole point of the format: the app lists by key order.
  const early = pushId(1_700_000_000_000);
  const later = pushId(1_800_000_000_000);
  assert.ok(early < later, `${early} should sort before ${later}`);
});

test("the first 8 characters encode the timestamp, so same-ms ids share them", () => {
  const a = pushId(1_789_000_000_000);
  const b = pushId(1_789_000_000_000);
  assert.equal(a.slice(0, 8), b.slice(0, 8));
});

test("ids made in the same millisecond still sort in creation order", () => {
  const now = 1_789_000_000_001;
  const ids = Array.from({ length: 25 }, () => pushId(now));
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(new Set(ids).size, ids.length);
});

test("ids are unique across a burst", () => {
  const ids = Array.from({ length: 500 }, () => pushId());
  assert.equal(new Set(ids).size, 500);
});

test("an invite hash is 20 alphanumeric characters", () => {
  // Not a push id: no hyphen or underscore, and no timestamp prefix.
  assert.match(inviteHash(), /^[0-9A-Za-z]{20}$/);
  assert.notEqual(inviteHash(), inviteHash());
});

test("an explicit timestamp of 0 still produces a full id", () => {
  // `lastTime` started at 0, so pushId(0) looked like a repeat of the initial
  // state and returned only the 8 timestamp characters.
  assert.match(pushId(0), PUSH_CHARS);
});
