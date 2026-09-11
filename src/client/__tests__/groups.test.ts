import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "../../api/db.js";
import { Cache } from "../../core/cache.js";
import type { Group } from "../../core/types.js";
import { createGroupApi } from "../groups.js";

const GROUP: Group = {
  id: "g1",
  name: "Trip",
  currencyCode: "INR",
  minimizeDebts: true,
  members: [{ id: "m1", name: "Alice", active: true, defaultWeight: "1" }],
  meMemberId: "m1",
};

/** A Db that records the calls made against it, in order. */
function recorder() {
  const calls: string[] = [];
  const db = {
    get: async () => null,
    put: async (path: string) => {
      calls.push(`put ${path}`);
      return undefined as never;
    },
    patch: async (path: string) => {
      calls.push(`patch ${path}`);
    },
    push: async (path: string) => {
      calls.push(`push ${path}`);
      return `id${calls.length}`;
    },
    delete: async (path: string) => {
      calls.push(`delete ${path}`);
    },
  } as unknown as Db;

  const api = createGroupApi({
    db: async () => db,
    uid: async () => "u1",
    cache: new Cache(0),
    group: async () => GROUP,
  });
  return { api, calls };
}

test("deleting a group removes permissions last", async () => {
  // `permissions` authorises every other delete. Removing it first strands the
  // rest: the group survives with nobody able to read or remove it.
  const { api, calls } = recorder();
  await api.deleteGroup("Trip");

  assert.deepEqual(calls, [
    "delete transactions/g1",
    "delete members/g1",
    "delete groups/g1",
    "delete userGroups/u1/g1",
    "delete permissions/g1",
  ]);
});

test("deleting a group never touches debts, which the server owns", async () => {
  const { api, calls } = recorder();
  await api.deleteGroup("Trip");
  assert.ok(!calls.some((c) => c.includes("debts")));
});

test("creating a group writes permissions first, and the user link last", async () => {
  // The mirror of the delete order: nothing is writable until the permission
  // exists, and the group must not appear to the user until it is built.
  const { api, calls } = recorder();
  await api.createGroup({ name: "Trip", currencyCode: "INR", members: ["Alice", "Bob"] });

  assert.match(calls[0] as string, /^put permissions\/.+\/u1$/);
  assert.match(calls[1] as string, /^put groups\//);
  assert.match(calls.at(-1) as string, /^put userGroups\/u1\//);
});

test("a created group carries the invite hash the rules demand", async () => {
  const { api } = recorder();
  const created = await api.createGroup({ name: "Trip", currencyCode: "INR" });
  // Without it the write is refused — see docs/traps.md.
  assert.match(created.inviteLink as string, /^https:\/\/join\.settleup\.app\/[0-9A-Za-z]{20}$/);
});
