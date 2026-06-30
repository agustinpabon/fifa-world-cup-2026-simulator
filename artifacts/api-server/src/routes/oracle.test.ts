import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import app from "../app.js";
import { WC2026_TEAMS } from "../lib/worldcup2026.js";
import type { SimResult } from "../lib/simulation.js";
import {
  initOracle,
  resetOracleForTests,
  seedReadyOracleForTests,
  setSimulationRunnerForTests,
} from "./oracle.js";

let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

async function requestJson(method: string, path: string, payload: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function requestMalformedJson(method: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
}

async function requestGet(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

async function requestPost(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: "POST" });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function readData(body: Record<string, unknown>): Record<string, unknown> {
  const data = body.data;
  assert.ok(data && typeof data === "object" && !Array.isArray(data));
  return data as Record<string, unknown>;
}

function readMeta(body: Record<string, unknown>): Record<string, unknown> {
  const meta = body.meta;
  assert.ok(meta && typeof meta === "object" && !Array.isArray(meta));
  return meta as Record<string, unknown>;
}

function readError(body: Record<string, unknown>): Record<string, unknown> {
  const error = body.error;
  assert.ok(error && typeof error === "object" && !Array.isArray(error));
  return error as Record<string, unknown>;
}

function createMarkedSimResult(champion: string): SimResult {
  const counts = Object.fromEntries(WC2026_TEAMS.map((team) => [team.name, 0]));

  return {
    titles: { ...counts, [champion]: 10_000 },
    finals: { ...counts, [champion]: 10_000 },
    semiFinals: { ...counts, [champion]: 10_000 },
    quarterFinals: { ...counts, [champion]: 10_000 },
    roundOf16: { ...counts, [champion]: 10_000 },
    groupWins: { ...counts, [champion]: 10_000 },
    groupAdvances: { ...counts, [champion]: 10_000 },
  };
}

function createDeferredSimulationRunner() {
  type RunnerCall = Parameters<Parameters<typeof setSimulationRunnerForTests>[0]>[0];
  const calls: RunnerCall[] = [];
  const resolvers: Array<(result: SimResult) => void> = [];

  return {
    calls,
    runner(snapshot: RunnerCall): Promise<SimResult> {
      calls.push(snapshot);

      return new Promise<SimResult>((resolve) => {
        resolvers.push(resolve);
      });
    },
    resolveNext(result: SimResult): void {
      const resolve = resolvers.shift();
      assert.ok(resolve, "Expected a pending simulation runner call");
      resolve(result);
    },
  };
}

async function waitForCondition(
  assertion: () => boolean | Promise<boolean>,
  label: string
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 1_000) {
    if (await assertion()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.fail(`Timed out waiting for ${label}`);
}

async function expectSettledStatus(): Promise<Record<string, unknown>> {
  let latest: Record<string, unknown> | undefined;

  await waitForCondition(async () => {
    const response = await requestGet("/api/oracle/status");
    latest = readData(await readJson(response));
    return latest.recalculating === false;
  }, "recalculation to settle");

  assert.ok(latest);
  return latest;
}

async function expectValidationIssue(
  method: string,
  path: string,
  payload: unknown,
  expectedIssue: string
): Promise<void> {
  const response = await requestJson(method, path, payload);
  const body = await readJson(response);
  const error = readError(body);

  assert.equal(response.status, 400);
  assert.equal(error.code, "invalid_request");
  assert.equal(error.message, "Invalid request body");
  assert.ok(Array.isArray(error.issues));
  assert.ok(
    error.issues.some((issue) => {
      assert.ok(issue && typeof issue === "object");
      const issueObject = issue as Record<string, unknown>;
      return (
        String(issueObject.path ?? "").includes(expectedIssue) ||
        String(issueObject.message).includes(expectedIssue)
      );
    }),
    `Expected an issue containing "${expectedIssue}", got ${JSON.stringify(error.issues)}`
  );
}

function expectOracleReadinessMeta(body: Record<string, unknown>): void {
  const meta = readMeta(body);
  const readiness = meta.readiness;
  assert.ok(readiness && typeof readiness === "object" && !Array.isArray(readiness));
  assert.equal(typeof (readiness as Record<string, unknown>).ready, "boolean");
  assert.equal(typeof (readiness as Record<string, unknown>).message, "string");
}

test("POST /api/oracle/live-match validates valid and invalid payloads", async () => {
  const validResponse = await requestJson("POST", "/api/oracle/live-match", {
    homeTeam: "Mexico",
    awayTeam: "South Africa",
    homeScore: 2,
    awayScore: 1,
  });
  const validBody = await readJson(validResponse);
  const validData = readData(validBody);

  assert.equal(validResponse.status, 200);
  assert.equal(validData.success, true);
  assert.equal(validData.liveMatchesCount, 1);
  expectOracleReadinessMeta(validBody);

  await expectValidationIssue("POST", "/api/oracle/live-match", {
    homeTeam: "Atlantis",
    awayTeam: "South Africa",
    homeScore: 1,
    awayScore: 0,
  }, "Unknown team: Atlantis");

  await expectValidationIssue("POST", "/api/oracle/live-match", {
    homeTeam: "Mexico",
    awayTeam: "Mexico",
    homeScore: 1,
    awayScore: 0,
  }, "Teams must be different");

  await expectValidationIssue("POST", "/api/oracle/live-match", {
    homeTeam: "Mexico",
    awayTeam: "South Africa",
    homeScore: 1.5,
    awayScore: 0,
  }, "homeScore must be an integer");

  await expectValidationIssue("POST", "/api/oracle/live-match", {
    homeTeam: "Mexico",
    awayTeam: "South Africa",
    homeScore: -1,
    awayScore: 0,
  }, "homeScore must be non-negative");

  await expectValidationIssue("POST", "/api/oracle/live-match", {
    homeTeam: "Mexico",
    awayTeam: "South Africa",
    homeScore: 100,
    awayScore: 0,
  }, "homeScore must be 30 or less");

  await expectValidationIssue("POST", "/api/oracle/live-match", {
    homeTeam: "Mexico",
    awayTeam: "South Africa",
    homeScore: 1,
    awayScore: 0,
    penaltyWinner: "Mexico",
  }, "Unrecognized key");
});

test("GET /api/oracle/status exposes simulation seed metadata", async () => {
  const response = await requestGet("/api/oracle/status");
  const body = await readJson(response);
  const data = readData(body);

  assert.equal(response.status, 200);
  assert.equal(typeof data.simulationSeed, "string");
  assert.ok(String(data.simulationSeed).length > 0);
  expectOracleReadinessMeta(body);
});

test("main API endpoints return success envelopes", async () => {
  const healthResponse = await requestGet("/api/healthz");
  const healthBody = await readJson(healthResponse);
  assert.equal(healthResponse.status, 200);
  assert.equal(readData(healthBody).status, "ok");

  const teamsResponse = await requestGet("/api/oracle/teams");
  const teamsBody = await readJson(teamsResponse);
  assert.equal(teamsResponse.status, 200);
  assert.ok(Array.isArray(readData(teamsBody).teams));
  expectOracleReadinessMeta(teamsBody);

  const liveMatchesResponse = await requestGet("/api/oracle/live-matches");
  const liveMatchesBody = await readJson(liveMatchesResponse);
  assert.equal(liveMatchesResponse.status, 200);
  assert.ok(Array.isArray(readData(liveMatchesBody).playedMatches));
  expectOracleReadinessMeta(liveMatchesBody);

  const clearResponse = await requestPost("/api/oracle/live-matches/clear");
  const clearBody = await readJson(clearResponse);
  assert.equal(clearResponse.status, 200);
  assert.equal(readData(clearBody).success, true);
  expectOracleReadinessMeta(clearBody);
});

test("GET /api/oracle/status exposes an explicit error state when historical data loading fails", async () => {
  resetOracleForTests();

  await initOracle({
    fetchImpl: async () => new Response("upstream unavailable", { status: 503 }),
    maxAttempts: 1,
    snapshotPath: "/definitely/missing/results.csv",
    timeoutMs: 100,
  });

  const response = await requestGet("/api/oracle/status");
  const body = await readJson(response);
  const data = readData(body);
  const meta = readMeta(body);
  const readiness = meta.readiness as Record<string, unknown>;
  const error = data.error as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(data.ready, false);
  assert.equal(data.state, "error");
  assert.equal(readiness.ready, false);
  assert.equal(readiness.state, "error");
  assert.equal(error.code, "HISTORICAL_DATA_LOAD_FAILED");
  assert.equal(typeof error.message, "string");
  assert.match(String(data.message), /could not be loaded/i);

  resetOracleForTests();
});

test("GET /api/oracle/simulation accepts an optional seed", async () => {
  const response = await requestGet("/api/oracle/simulation?seed=debug-seed");
  const body = await readJson(response);
  const data = readData(body);
  const uncertainty = data.uncertainty as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(data.simulationSeed, "debug-seed");
  assert.equal(uncertainty.method, "binomial_standard_error");
  assert.equal(uncertainty.confidenceLevel, 0.95);
  assert.equal(typeof uncertainty.maxStandardErrorPct, "number");
  expectOracleReadinessMeta(body);

  const invalidResponse = await requestGet("/api/oracle/simulation?seed=");
  const invalidBody = await readJson(invalidResponse);
  const invalidError = readError(invalidBody);

  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidError.code, "invalid_request");
  assert.ok(Array.isArray(invalidError.issues));
  assert.ok(
    invalidError.issues.some((issue) => {
      assert.ok(issue && typeof issue === "object");
      return String((issue as Record<string, unknown>).message).includes("seed must not be empty");
    })
  );
});

test("POST /api/oracle/live-match enqueues recalculation without awaiting it", async () => {
  resetOracleForTests();
  seedReadyOracleForTests({
    lastUpdated: "2026-01-01T00:00:00.000Z",
    simulationSeed: "initial-seed",
    simResult: createMarkedSimResult("Argentina"),
  });
  const deferredRunner = createDeferredSimulationRunner();
  const restoreRunner = setSimulationRunnerForTests(deferredRunner.runner);

  try {
    const response = await Promise.race([
      requestJson("POST", "/api/oracle/live-match", {
        homeTeam: "Mexico",
        awayTeam: "South Africa",
        homeScore: 2,
        awayScore: 1,
      }),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);

    if (response === "timeout") {
      assert.fail("POST /api/oracle/live-match waited for recalculation to finish");
    }

    assert.equal(response.status, 200);
    const body = await readJson(response);
    const data = readData(body);
    assert.equal(data.success, true);
    assert.equal(data.liveMatchesCount, 1);

    const statusResponse = await requestGet("/api/oracle/status");
    const status = readData(await readJson(statusResponse));
    assert.equal(status.recalculating, true);
    assert.equal(status.lastUpdated, "2026-01-01T00:00:00.000Z");
    assert.equal(status.recalculationError, null);

    const simulationResponse = await requestGet("/api/oracle/simulation");
    const simulation = readData(await readJson(simulationResponse));
    const results = simulation.results as Array<Record<string, unknown>>;
    assert.equal(simulation.simulationSeed, "initial-seed");
    assert.equal(results[0]?.name, "Argentina");

    await waitForCondition(() => deferredRunner.calls.length === 1, "recalculation runner to start");
    deferredRunner.resolveNext(createMarkedSimResult("France"));

    await expectSettledStatus();

    const updatedResponse = await requestGet("/api/oracle/simulation");
    const updated = readData(await readJson(updatedResponse));
    const updatedResults = updated.results as Array<Record<string, unknown>>;
    assert.equal(updatedResults[0]?.name, "France");
    assert.notEqual(updated.simulationSeed, "initial-seed");
  } finally {
    restoreRunner();
    resetOracleForTests();
  }
});

test("simulation recalculation discards stale results across consecutive updates", async () => {
  resetOracleForTests();
  seedReadyOracleForTests({
    lastUpdated: "2026-01-01T00:00:00.000Z",
    simulationSeed: "initial-seed",
    simResult: createMarkedSimResult("Argentina"),
  });
  const deferredRunner = createDeferredSimulationRunner();
  const restoreRunner = setSimulationRunnerForTests(deferredRunner.runner);

  try {
    const firstResponse = await requestJson("POST", "/api/oracle/live-match", {
      homeTeam: "Mexico",
      awayTeam: "South Africa",
      homeScore: 1,
      awayScore: 0,
    });
    assert.equal(firstResponse.status, 200);
    await waitForCondition(() => deferredRunner.calls.length === 1, "first recalculation to start");
    const firstSeed = deferredRunner.calls[0]?.seed;

    const secondResponse = await requestJson("POST", "/api/oracle/live-match", {
      homeTeam: "Canada",
      awayTeam: "Morocco",
      homeScore: 0,
      awayScore: 2,
    });
    assert.equal(secondResponse.status, 200);

    deferredRunner.resolveNext(createMarkedSimResult("Brazil"));
    await waitForCondition(() => deferredRunner.calls.length === 2, "second recalculation to start");

    const interimResponse = await requestGet("/api/oracle/simulation");
    const interim = readData(await readJson(interimResponse));
    const interimResults = interim.results as Array<Record<string, unknown>>;
    assert.equal(interimResults[0]?.name, "Argentina");

    deferredRunner.resolveNext(createMarkedSimResult("France"));
    await expectSettledStatus();

    const finalResponse = await requestGet("/api/oracle/simulation");
    const final = readData(await readJson(finalResponse));
    const finalResults = final.results as Array<Record<string, unknown>>;
    assert.equal(finalResults[0]?.name, "France");
    assert.notEqual(final.simulationSeed, "initial-seed");
    assert.notEqual(final.simulationSeed, firstSeed);
  } finally {
    restoreRunner();
    resetOracleForTests();
  }
});

test("DELETE /api/oracle/live-match validates valid and invalid payloads", async () => {
  const validResponse = await requestJson("DELETE", "/api/oracle/live-match", {
    homeTeam: "Mexico",
    awayTeam: "South Africa",
  });
  const validBody = await readJson(validResponse);
  const validData = readData(validBody);

  assert.equal(validResponse.status, 200);
  assert.equal(validData.success, true);
  assert.equal(validData.liveMatchesCount, 0);

  await expectValidationIssue("DELETE", "/api/oracle/live-match", {
    homeTeam: "Mexico",
  }, "awayTeam");

  await expectValidationIssue("DELETE", "/api/oracle/live-match", {
    homeTeam: "Mexico",
    awayTeam: "Mexico",
  }, "Teams must be different");

  await expectValidationIssue("DELETE", "/api/oracle/live-match", {
    homeTeam: "Mexico",
    awayTeam: "Atlantis",
  }, "Unknown team: Atlantis");

  await expectValidationIssue("DELETE", "/api/oracle/live-match", {
    homeTeam: "Mexico",
    awayTeam: "South Africa",
    reason: "mistake",
  }, "Unrecognized key");
});

test("POST /api/oracle/predict-match validates valid and invalid payloads", async () => {
  const validResponse = await requestJson("POST", "/api/oracle/predict-match", {
    homeTeam: "Brazil",
    awayTeam: "Morocco",
  });
  const validBody = await readJson(validResponse);
  const validData = readData(validBody);

  assert.equal(validResponse.status, 200);
  assert.equal(validData.homeTeam, "Brazil");
  assert.equal(validData.awayTeam, "Morocco");
  assert.equal(typeof validData.homeWinPct, "number");

  await expectValidationIssue("POST", "/api/oracle/predict-match", {
    homeTeam: "Brazil",
  }, "awayTeam");

  await expectValidationIssue("POST", "/api/oracle/predict-match", {
    homeTeam: "Brazil",
    awayTeam: "Brazil",
  }, "Teams must be different");

  await expectValidationIssue("POST", "/api/oracle/predict-match", {
    homeTeam: "Brazil",
    awayTeam: "Atlantis",
  }, "Unknown team: Atlantis");

  await expectValidationIssue("POST", "/api/oracle/predict-match", {
    homeTeam: "Brazil",
    awayTeam: "Morocco",
    neutralSite: true,
  }, "Unrecognized key");
});

test("mutable oracle endpoints return a JSON envelope for malformed JSON", async () => {
  const response = await requestMalformedJson("POST", "/api/oracle/live-match");
  const body = await readJson(response);
  const error = readError(body);

  assert.equal(response.status, 400);
  assert.equal(error.code, "malformed_json");
  assert.equal(error.message, "Malformed JSON payload");
  assert.ok(Array.isArray(error.issues));
});

test("POST /api/oracle/live-match rejects bodies exceeding size limits with 413", async () => {
  const hugePayload = {
    homeTeam: "Argentina",
    awayTeam: "Canada",
    homeScore: 1,
    awayScore: 0,
    padding: "x".repeat(15000), // 15kb (exceeds 10kb limit)
  };

  const response = await fetch(`${baseUrl}/api/oracle/live-match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(hugePayload),
  });

  assert.equal(response.status, 413);
  const body = (await response.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, "payload_too_large");
  assert.equal(body.error.message, "Request payload too large");
});

test("CORS origin checking is active", async () => {
  // Non-localhost origin in development/test should be blocked
  const response = await fetch(`${baseUrl}/api/oracle/teams`, {
    headers: {
      Origin: "http://malicious.com",
    },
  });

  assert.equal(response.status, 403);
  const body = (await response.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, "cors_not_allowed");
  assert.equal(body.error.message, "Request origin is not allowed by CORS policy");

  // Localhost origin should be allowed
  const allowedResponse = await fetch(`${baseUrl}/api/oracle/teams`, {
    headers: {
      Origin: "http://localhost:5173",
    },
  });
  assert.equal(allowedResponse.status, 200);
});

test("mutable endpoints include rate limit headers", async () => {
  const { resetRateLimits } = await import("../middlewares/rate-limiter.js");
  resetRateLimits();

  const response = await fetch(`${baseUrl}/api/oracle/live-match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      homeTeam: "Argentina",
      awayTeam: "Canada",
      homeScore: 2,
      awayScore: 0,
    }),
  });

  assert.ok(response.headers.get("x-ratelimit-limit"));
  assert.ok(response.headers.get("x-ratelimit-remaining"));
  assert.ok(response.headers.get("x-ratelimit-reset"));
});
