import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import express from "express";
import { rateLimiter, resetRateLimits } from "./rate-limiter.js";
import type { AddressInfo } from "node:net";

beforeEach(() => {
  resetRateLimits();
});

test("rateLimiter allows requests under limit and blocks requests over limit", async () => {
  const app = express();
  app.use(
    rateLimiter({
      windowMs: 5000,
      max: 2,
      message: "Limit hit",
    })
  );
  app.get("/test", (_req, res) => {
    res.send("ok");
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/test`;

  try {
    // 1st request - ok
    const res1 = await fetch(url);
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(await res1.text(), "ok");
    assert.strictEqual(res1.headers.get("x-ratelimit-limit"), "2");
    assert.strictEqual(res1.headers.get("x-ratelimit-remaining"), "1");

    // 2nd request - ok
    const res2 = await fetch(url);
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get("x-ratelimit-remaining"), "0");

    // 3rd request - blocked
    const res3 = await fetch(url);
    assert.strictEqual(res3.status, 429);
    const body3 = (await res3.json()) as { error: { code: string; message: string } };
    assert.strictEqual(body3.error.code, "rate_limit_exceeded");
    assert.strictEqual(body3.error.message, "Limit hit");
    assert.ok(res3.headers.get("retry-after"));
  } finally {
    server.close();
  }
});
