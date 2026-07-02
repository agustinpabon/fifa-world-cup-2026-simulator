import assert from "node:assert/strict";
import test from "node:test";

import {
  createExternalDataProvider,
  fetchJsonWithTimeout,
  type FetchLike,
} from "./external-data.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("fetchJsonWithTimeout aborts a slow external fetch", async () => {
  let aborted = false;
  const fetchImpl: FetchLike = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(new Error("fetch aborted"));
        },
        { once: true }
      );
    });

  await assert.rejects(
    () => fetchJsonWithTimeout(fetchImpl, "https://example.com/live.json", 10),
    /timed out after 10ms/i
  );
  assert.equal(aborted, true);
});

test("external data provider reuses cached data before cache TTL expires", async () => {
  let loadCount = 0;
  const provider = createExternalDataProvider({
    provider: "espn",
    sourceUrl: "https://example.com/live.json",
    cacheTtlMs: 60_000,
    fallbackData: { value: 0 },
    load: async () => ({
      data: { value: ++loadCount },
      loadedAt: "2026-07-01T00:00:00.000Z",
    }),
  });

  const first = await provider.read();
  const second = await provider.read();

  assert.equal(loadCount, 1);
  assert.deepEqual(first.data, { value: 1 });
  assert.deepEqual(second.data, { value: 1 });
  assert.equal(second.provenance.state, "fresh");
  assert.equal(second.provenance.stale, false);
  assert.equal(second.provenance.error, null);
});

test("external data provider serves stale cached data when a refresh fails", async () => {
  let shouldFail = false;
  const provider = createExternalDataProvider({
    provider: "espn",
    sourceUrl: "https://example.com/live.json",
    cacheTtlMs: 1,
    fallbackData: { value: 0 },
    load: async () => {
      if (shouldFail) {
        throw new Error("scoreboard unavailable");
      }

      return {
        data: { value: 7 },
        loadedAt: "2026-07-01T00:00:00.000Z",
      };
    },
  });

  await provider.read();
  await delay(5);
  shouldFail = true;

  const snapshot = await provider.read();

  assert.deepEqual(snapshot.data, { value: 7 });
  assert.equal(snapshot.provenance.loadedAt, "2026-07-01T00:00:00.000Z");
  assert.equal(snapshot.provenance.state, "stale");
  assert.equal(snapshot.provenance.stale, true);
  assert.equal(snapshot.provenance.fallback, "stale-cache");
  assert.equal(snapshot.provenance.error, "scoreboard unavailable");
});

test("external data provider falls back to local data when the initial load fails", async () => {
  const provider = createExternalDataProvider({
    provider: "espn",
    sourceUrl: "https://example.com/live.json",
    cacheTtlMs: 30_000,
    fallbackData: { value: 99 },
    load: async () => {
      throw new Error("provider offline");
    },
  });

  const snapshot = await provider.read();

  assert.deepEqual(snapshot.data, { value: 99 });
  assert.equal(snapshot.provenance.loadedAt, null);
  assert.equal(snapshot.provenance.state, "error");
  assert.equal(snapshot.provenance.stale, true);
  assert.equal(snapshot.provenance.fallback, "local-data");
  assert.equal(snapshot.provenance.error, "provider offline");
});
