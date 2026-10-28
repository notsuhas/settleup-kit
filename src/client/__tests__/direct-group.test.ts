import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../index.js";

test("known group resolution reads fresh membership and members without other groups", async () => {
  const previous = globalThis.fetch;
  const calls: string[] = [];
  let name = "Japan";
  let memberName = "Alice";
  let allowed = true;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path === "/userGroups/user.json") return Response.json({ g: { member: "me" } });
    if (path === "/userGroups/user/g.json") return Response.json(allowed ? { member: "me" } : null);
    if (path === "/groups/g.json") return Response.json({ name, convertedToCurrency: "INR" });
    if (path === "/members/g.json") return Response.json({ me: { name: memberName } });
    throw Error(`Unexpected path: ${path}`);
  }) as typeof fetch;
  const token = `header.${Buffer.from(JSON.stringify({ sub: "user", exp: Date.now() / 1000 + 3600 })).toString("base64url")}.signature`;
  const client = createClient({ token, cacheSeconds: 0 });
  try {
    assert.equal((await client.withFreshReads(() => client.group("Japan"))).name, "Japan");
    calls.length = 0;
    memberName = "Renamed member";
    assert.equal(
      (await client.withFreshReads(() => client.group("Japan"))).members[0]?.name,
      memberName,
    );
    assert.deepEqual([...calls].sort(), [
      "/groups/g.json",
      "/members/g.json",
      "/userGroups/user/g.json",
    ]);
    calls.length = 0;
    assert.equal(await client.accountId(), "user");
    assert.equal(calls.length, 0);
    name = "Renamed group";
    await assert.rejects(
      client.withFreshReads(() => client.group("Japan")),
      /no group/,
    );
    allowed = false;
    await assert.rejects(
      client.withFreshReads(() => client.group("Japan")),
      /no longer belongs/,
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test("duplicate group names retain ordered list resolution on every operation", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === "/userGroups/user.json") return Response.json({ first: {}, second: {} });
    if (path.startsWith("/groups/")) return Response.json({ name: "Trip" });
    if (path.startsWith("/members/")) return Response.json({});
    throw Error(`Unexpected scoped lookup for ambiguous name: ${path}`);
  }) as typeof fetch;
  const token = `header.${Buffer.from(JSON.stringify({ sub: "user", exp: Date.now() / 1000 + 3600 })).toString("base64url")}.signature`;
  const client = createClient({ token, cacheSeconds: 0 });
  try {
    for (let round = 0; round < 3; round++)
      assert.equal((await client.withFreshReads(() => client.group("Trip"))).id, "first");
  } finally {
    globalThis.fetch = previous;
  }
});
