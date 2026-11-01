import assert from "node:assert/strict";
import { test } from "node:test";
import { request } from "../http.js";

test("GET retries transient network failures including timeouts", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (async () => {
      calls++;
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as typeof fetch;
    await assert.rejects(request("https://example.test/groups/g1.json"));
    assert.equal(calls, 4);
    calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new DOMException("This operation was aborted", "AbortError");
    }) as typeof fetch;
    await assert.rejects(request("https://example.test/groups/g1.json"));
    assert.equal(calls, 4);
  } finally {
    globalThis.fetch = original;
  }
});

test("uncertain writes do not automatically append a second expense", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (async () => {
      calls++;
      throw new TypeError("committed but response lost");
    }) as typeof fetch;
    await assert.rejects(
      request("https://example.test/transactions/group.json", {
        method: "POST",
        body: { amount: 10 },
      }),
    );
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json({ error: "unavailable" }, { status: 503 });
    }) as typeof fetch;
    await assert.rejects(
      request("https://example.test/transactions/group.json", {
        method: "POST",
        body: { amount: 10 },
      }),
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
