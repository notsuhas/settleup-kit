import assert from "node:assert/strict";
import { test } from "node:test";
import { Cache } from "../cache.js";

test("scopes reuse reads, isolate concurrent calls, invalidate writes and recover from failures", async () => {
  const cache = new Cache(0);
  let reads = 0;
  const read = () => cache.get("group:one", async () => ++reads);
  await Promise.all(
    [1, 2].map(() =>
      cache.scope(async () => {
        const first = await read();
        assert.equal(await cache.scope(read), first);
      }),
    ),
  );
  assert.equal(reads, 2);
  await cache.scope(async () => {
    const first = await read();
    cache.invalidate("group:");
    assert.equal(await read(), first + 1);
    cache.clear();
    assert.equal(await read(), first + 2);
    await assert.rejects(
      cache.get("failure", async () => {
        throw new Error("offline");
      }),
    );
    assert.equal(await cache.get("failure", async () => "recovered"), "recovered");
  });
  assert.equal(await read(), 6);
});
