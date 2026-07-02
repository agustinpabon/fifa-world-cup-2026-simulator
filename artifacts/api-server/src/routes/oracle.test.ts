import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build as esbuild } from "esbuild";

import app from "../app.js";
import { DEFAULT_MODEL_CONFIG } from "../lib/elo.js";
import { createMatchContextService } from "../lib/match-context.js";
import { WC2026_TEAMS } from "../lib/worldcup2026.js";
import {
  NUM_SIMULATIONS,
  runSimulations,
  toPublishedSimulationResults,
  type SimResult,
} from "../lib/simulation.js";
import {
  initOracle,
  loadBestModelConfigOverrides,
  resetOracleForTests,
  seedReadyOracleForTests,
  setMatchContextServiceForTests,
  setSimulationRunnerForTests,
  setSimulationWorkerOptionsForTests,
} from "./oracle.js";

let server: Server;
let baseUrl: string;
let bundledWorkerDir: string | null = null;
let restoreBundledWorkerOptions: (() => void) | null = null;
const TEST_API_FOOTBALL_KEY = ["api", "football", "test", "token"].join("-");

before(async () => {
  bundledWorkerDir = await createTempDir("oracle-worker-bundle-");
  const bundledWorkerPath = join(bundledWorkerDir, "simulation.worker.mjs");

  await esbuild({
    entryPoints: [
      fileURLToPath(new URL("../lib/simulation.worker.ts", import.meta.url)),
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bundledWorkerPath,
    logLevel: "silent",
  });

  restoreBundledWorkerOptions = setSimulationWorkerOptionsForTests({
    workerUrl: pathToFileURL(bundledWorkerPath),
  });

  server = app.listen(0, "127.0.0.1");
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

  restoreBundledWorkerOptions?.();
  restoreBundledWorkerOptions = null;

  if (bundledWorkerDir) {
    await rm(bundledWorkerDir, { recursive: true, force: true });
    bundledWorkerDir = null;
  }
});

async function requestJson(
  method: string,
  path: string,
  payload: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function requestMalformedJson(
  method: string,
  path: string,
): Promise<Response> {
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

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolveDeferred: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve;
  });

  assert.ok(resolveDeferred);
  return { promise, resolve: resolveDeferred };
}

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeTinySnapshot(dir: string): Promise<string> {
  const snapshotPath = join(dir, "results.csv");
  const raw = [
    "date,home_team,away_team,home_score,away_score,tournament,city,country,neutral",
    "2024-01-01,Argentina,Brazil,2,1,Friendly,City,Country,TRUE",
    "2024-02-01,Brazil,Argentina,0,0,Friendly,City,Country,TRUE",
  ].join("\n");

  await writeFile(snapshotPath, raw, "utf8");
  return snapshotPath;
}

async function writeBestModelConfig(dir: string): Promise<string> {
  const configPath = join(dir, "best-model-config.json");

  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        generatedAt: "2026-06-30T00:00:00.000Z",
        candidatesEvaluated: 1,
        modelConfig: {
          variant: "elo-baseline",
          homeAdvantageElo: 25,
          useMarginOfVictoryElo: false,
          recentMetricHalfLifeYears: 1.5,
        },
        metrics: {
          matches: 2,
          windows: 1,
          brierScore: 0.5,
          logLoss: 0.75,
          accuracy: 0.5,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return configPath;
}

async function writeTempWorker(
  dir: string,
  fileName: string,
  source: string,
): Promise<URL> {
  const workerPath = join(dir, fileName);
  await writeFile(workerPath, source, "utf8");
  return pathToFileURL(workerPath);
}

async function expectValidationIssue(
  method: string,
  path: string,
  payload: unknown,
  expectedIssue: string,
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
    `Expected an issue containing "${expectedIssue}", got ${JSON.stringify(error.issues)}`,
  );
}

function expectOracleReadinessMeta(body: Record<string, unknown>): void {
  const meta = readMeta(body);
  const readiness = meta.readiness;
  assert.ok(
    readiness && typeof readiness === "object" && !Array.isArray(readiness),
  );
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
  assert.equal(validData.liveMatchesCount, 0);
  expectOracleReadinessMeta(validBody);

  await expectValidationIssue(
    "POST",
    "/api/oracle/live-match",
    {
      homeTeam: "Atlantis",
      awayTeam: "South Africa",
      homeScore: 1,
      awayScore: 0,
    },
    "Unknown team: Atlantis",
  );

  await expectValidationIssue(
    "POST",
    "/api/oracle/live-match",
    {
      homeTeam: "Mexico",
      awayTeam: "Mexico",
      homeScore: 1,
      awayScore: 0,
    },
    "Teams must be different",
  );

  await expectValidationIssue(
    "POST",
    "/api/oracle/live-match",
    {
      homeTeam: "Mexico",
      awayTeam: "South Africa",
      homeScore: 1.5,
      awayScore: 0,
    },
    "homeScore must be an integer",
  );

  await expectValidationIssue(
    "POST",
    "/api/oracle/live-match",
    {
      homeTeam: "Mexico",
      awayTeam: "South Africa",
      homeScore: -1,
      awayScore: 0,
    },
    "homeScore must be non-negative",
  );

  await expectValidationIssue(
    "POST",
    "/api/oracle/live-match",
    {
      homeTeam: "Mexico",
      awayTeam: "South Africa",
      homeScore: 100,
      awayScore: 0,
    },
    "homeScore must be 30 or less",
  );

  await expectValidationIssue(
    "POST",
    "/api/oracle/live-match",
    {
      homeTeam: "Mexico",
      awayTeam: "South Africa",
      homeScore: 1,
      awayScore: 0,
      penaltyWinner: "Mexico",
    },
    "Unrecognized key",
  );
});

test("POST /api/oracle/live-match rejects overriding an imported finished result", async () => {
  seedReadyOracleForTests({
    fixtureMatches: [
      {
        homeTeam: "Germany",
        awayTeam: "Paraguay",
        homeScore: 1,
        awayScore: 1,
        winnerTeam: "Paraguay",
        source: "espn",
        status: "finished",
      },
    ],
  });

  const response = await requestJson("POST", "/api/oracle/live-match", {
    homeTeam: "Germany",
    awayTeam: "Paraguay",
    homeScore: 2,
    awayScore: 0,
  });
  const body = await readJson(response);
  const error = readError(body);

  assert.equal(response.status, 409);
  assert.equal(error.code, "match_locked");

  resetOracleForTests();
});

test("POST /api/oracle/live-match accepts legacy overrides without storing them", async () => {
  resetOracleForTests();

  try {
    const firstResponse = await requestJson("POST", "/api/oracle/live-match", {
      homeTeam: "Mexico",
      awayTeam: "South Africa",
      homeScore: 1,
      awayScore: 0,
    });
    assert.equal(firstResponse.status, 200);
    assert.equal(readData(await readJson(firstResponse)).liveMatchesCount, 0);

    const secondResponse = await requestJson("POST", "/api/oracle/live-match", {
      homeTeam: "South Africa",
      awayTeam: "Mexico",
      homeScore: 3,
      awayScore: 2,
    });
    const secondBody = await readJson(secondResponse);
    const secondData = readData(secondBody);

    assert.equal(secondResponse.status, 200);
    assert.equal(secondData.liveMatchesCount, 0);

    const liveMatchesResponse = await requestGet("/api/oracle/live-matches");
    const liveMatches = readData(await readJson(liveMatchesResponse))
      .playedMatches as Array<Record<string, unknown>>;
    const mexicoSouthAfricaMatches = liveMatches.filter(
      (match) =>
        (match.homeTeam === "Mexico" && match.awayTeam === "South Africa") ||
        (match.homeTeam === "South Africa" && match.awayTeam === "Mexico"),
    );

    assert.equal(mexicoSouthAfricaMatches.length, 0);
  } finally {
    resetOracleForTests();
  }
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

  const squadsResponse = await requestGet("/api/oracle/squads");
  const squadsBody = await readJson(squadsResponse);
  const squadsData = readData(squadsBody);
  const squads = squadsData.squads as Array<Record<string, unknown>>;
  const mexicoSquad = squads.find((squad) => squad.team === "Mexico");
  const squadsExternalProvenance = squadsData.externalProvenance as Record<
    string,
    unknown
  >;
  assert.equal(squadsResponse.status, 200);
  assert.equal(typeof squadsData.version, "string");
  assert.equal(typeof squadsData.competition, "string");
  assert.equal(squadsExternalProvenance.provider, "local-snapshot");
  assert.equal(squadsExternalProvenance.loadedAt, null);
  assert.equal(squadsExternalProvenance.stale, false);
  assert.equal(squadsExternalProvenance.error, null);
  assert.ok(Array.isArray(squads));
  assert.ok(squads.length > 0);
  assert.ok(mexicoSquad);
  assert.equal(mexicoSquad.group, "A");
  assert.equal(mexicoSquad.code, "MEX");
  assert.ok(Array.isArray(mexicoSquad.players));
  assert.ok(
    mexicoSquad.completeness && typeof mexicoSquad.completeness === "object",
  );
  assert.ok(mexicoSquad.source && typeof mexicoSquad.source === "object");
  expectOracleReadinessMeta(squadsBody);

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

test("GET /api/oracle/match-context returns fixture weather context without affecting the model", async () => {
  resetOracleForTests();
  seedReadyOracleForTests({
    fixtureMatches: [
      {
        matchNumber: 901,
        homeTeam: "Mexico",
        awayTeam: "South Africa",
        homeScore: -1,
        awayScore: -1,
        stage: "Group Stage",
        source: "fixture",
        sourceId: "fixture:901",
        date: "2026-06-14",
        kickoffTimeEt: "15:00",
        status: "scheduled",
        group: "A",
        venue: "Toronto",
        region: "Eastern Region",
      },
    ],
  });
  const restoreMatchContextService = setMatchContextServiceForTests(
    createMatchContextService({
      now: () => new Date("2026-06-10T12:00:00.000Z"),
      fetchImpl: async () =>
        Response.json({
          hourly: {
            time: ["2026-06-14T15:00"],
            temperature_2m: [21.9],
            precipitation: [0.4],
            rain: [0.1],
            wind_speed_10m: [14.2],
            precipitation_probability: [30],
          },
        }),
    }),
  );

  try {
    const response = await requestGet(
      "/api/oracle/match-context?homeTeam=Mexico&awayTeam=South%20Africa",
    );
    const body = await readJson(response);
    const data = readData(body);
    const fixture = data.fixture as Record<string, unknown>;
    const venue = data.venue as Record<string, unknown>;
    const weather = data.weather as Record<string, unknown>;
    const forecast = weather.forecast as Record<string, unknown>;
    const provenance = weather.provenance as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(fixture.matchNumber, 901);
    assert.equal(fixture.venue, "Toronto");
    assert.equal(venue.stadium, "BMO Field");
    assert.equal(weather.status, "available");
    assert.equal(forecast.temperatureC, 21.9);
    assert.equal(forecast.precipitationMm, 0.4);
    assert.equal(forecast.rainMm, 0.1);
    assert.equal(forecast.windSpeed10mKph, 14.2);
    assert.equal(provenance.provider, "open-meteo");
    assert.equal(typeof provenance.loadedAt, "string");
    expectOracleReadinessMeta(body);
  } finally {
    restoreMatchContextService();
    resetOracleForTests();
  }
});

test("GET /api/oracle/squads hydrates API-Football squads without affecting simulation state", async () => {
  resetOracleForTests();
  const dir = await createTempDir("oracle-api-football-");
  const restoreRunner = setSimulationRunnerForTests(async () =>
    createMarkedSimResult("Argentina"),
  );

  try {
    const snapshotPath = await writeTinySnapshot(dir);

    await initOracle({
      maxAttempts: 0,
      snapshotPath,
      liveData: { provider: "disabled" },
      apiFootball: {
        apiKey: TEST_API_FOOTBALL_KEY,
        cacheTtlMs: 12 * 60 * 60_000,
        teams: ["Mexico"],
        fetchImpl: async (input) => {
          const url = new URL(input);

          if (url.pathname === "/teams") {
            return Response.json({
              errors: [],
              response: [{ team: { id: 1001, name: "Mexico", code: "MEX" } }],
            });
          }

          return Response.json({
            errors: [],
            response: [
              {
                team: { id: 1001, name: "Mexico" },
                players: [
                  {
                    id: 1,
                    name: "Guillermo Ochoa",
                    number: 13,
                    position: "Goalkeeper",
                  },
                ],
              },
            ],
          });
        },
      },
    });

    const statusBeforeResponse = await requestGet("/api/oracle/status");
    const statusBefore = readData(await readJson(statusBeforeResponse));
    const seedBefore = statusBefore.simulationSeed;

    const squadsResponse = await requestGet("/api/oracle/squads");
    const squadsData = readData(await readJson(squadsResponse));
    const externalProvenance = squadsData.externalProvenance as Record<
      string,
      unknown
    >;
    const squads = squadsData.squads as Array<Record<string, unknown>>;
    const mexicoSquad = squads.find((squad) => squad.team === "Mexico");
    assert.ok(mexicoSquad);
    const players = mexicoSquad.players as Array<Record<string, unknown>>;

    assert.equal(squadsResponse.status, 200);
    assert.equal(externalProvenance.provider, "api-football");
    assert.equal(externalProvenance.state, "fresh");
    assert.equal(externalProvenance.stale, false);
    assert.equal(externalProvenance.error, null);
    assert.match(
      String(externalProvenance.sourceEndpoint),
      /\/players\/squads$/,
    );
    assert.equal(players[0]?.name, "Guillermo Ochoa");

    const statusAfterResponse = await requestGet("/api/oracle/status");
    const statusAfter = readData(await readJson(statusAfterResponse));
    assert.equal(statusAfter.simulationSeed, seedBefore);
    assert.equal(statusAfter.recalculating, false);
  } finally {
    restoreRunner();
    resetOracleForTests();
    await rm(dir, { recursive: true, force: true });
  }
});

test("GET /api/oracle/status exposes an explicit error state when historical data loading fails", async () => {
  resetOracleForTests();

  await initOracle({
    fetchImpl: async () =>
      new Response("upstream unavailable", { status: 503 }),
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

test("initOracle loads best model config overrides from optimizer JSON on startup", async () => {
  resetOracleForTests();
  const dir = await createTempDir("oracle-best-model-");
  const restoreRunner = setSimulationRunnerForTests(async () =>
    createMarkedSimResult("Argentina"),
  );

  try {
    const snapshotPath = await writeTinySnapshot(dir);
    const bestModelConfigPath = await writeBestModelConfig(dir);

    await initOracle({
      maxAttempts: 0,
      snapshotPath,
      bestModelConfigPath,
      liveData: { provider: "disabled" },
    });

    const response = await requestGet("/api/oracle/status");
    const data = readData(await readJson(response));

    assert.equal(response.status, 200);
    assert.equal(data.ready, true);
    assert.equal(data.activeModel, "elo-baseline");
  } finally {
    restoreRunner();
    resetOracleForTests();
    await rm(dir, { recursive: true, force: true });
  }
});

test("initOracle keeps serving local fixtures when external live data fails and exposes provider metadata", async () => {
  resetOracleForTests();
  const dir = await createTempDir("oracle-live-data-");
  const restoreRunner = setSimulationRunnerForTests(async () =>
    createMarkedSimResult("Argentina"),
  );

  try {
    const snapshotPath = await writeTinySnapshot(dir);

    await initOracle({
      maxAttempts: 0,
      snapshotPath,
      liveData: {
        provider: "espn",
        timeoutMs: 100,
        refreshIntervalMs: 30_000,
        fetchImpl: async () =>
          new Response("upstream unavailable", { status: 503 }),
      },
    });

    const statusResponse = await requestGet("/api/oracle/status");
    const statusBody = await readJson(statusResponse);
    const statusData = readData(statusBody);
    const liveData = statusData.liveData as Record<string, unknown>;

    assert.equal(statusResponse.status, 200);
    assert.equal(statusData.ready, true);
    assert.equal(liveData.provider, "espn");
    assert.equal(liveData.state, "error");
    assert.equal(liveData.stale, true);
    assert.equal(liveData.cacheTtlMs, 30_000);
    assert.equal(typeof liveData.sourceUrl, "string");
    assert.equal(liveData.loadedAt, null);
    assert.equal(typeof liveData.error, "string");

    const liveMatchesResponse = await requestGet("/api/oracle/live-matches");
    const liveMatchesBody = await readJson(liveMatchesResponse);
    const liveMatchesData = readData(liveMatchesBody);
    const playedMatches = liveMatchesData.playedMatches as Array<
      Record<string, unknown>
    >;
    const source = liveMatchesData.source as Record<string, unknown>;
    const sourceMetadata = source.metadata as Record<string, unknown>;

    assert.equal(liveMatchesResponse.status, 200);
    assert.ok(playedMatches.length > 0);
    assert.ok(
      playedMatches.some(
        (match) =>
          match.homeTeam === "Mexico" && match.awayTeam === "South Africa",
      ),
    );
    assert.equal(source.provider, "espn");
    assert.equal(sourceMetadata.state, "error");
    assert.equal(sourceMetadata.stale, true);
    assert.equal(sourceMetadata.cacheTtlMs, 30_000);
  } finally {
    restoreRunner();
    resetOracleForTests();
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadBestModelConfigOverrides ignores a missing optimizer JSON file", async () => {
  const overrides = await loadBestModelConfigOverrides(
    "/definitely/missing/best-model-config.json",
  );

  assert.deepEqual(overrides, {});
});

test("loadBestModelConfigOverrides rejects invalid optimizer JSON values", async () => {
  const dir = await createTempDir("oracle-bad-model-");

  try {
    const configPath = join(dir, "best-model-config.json");
    await writeFile(
      configPath,
      JSON.stringify({ modelConfig: { homeAdvantageElo: "high" } }),
      "utf8",
    );

    await assert.rejects(
      () => loadBestModelConfigOverrides(configPath),
      /homeAdvantageElo must be a finite number/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadBestModelConfigOverrides rejects out-of-domain optimizer JSON values", async () => {
  const dir = await createTempDir("oracle-bad-model-domain-");

  try {
    const configPath = join(dir, "best-model-config.json");
    await writeFile(
      configPath,
      JSON.stringify({ modelConfig: { maxGoals: 0 } }),
      "utf8",
    );

    await assert.rejects(
      () => loadBestModelConfigOverrides(configPath),
      /maxGoals must be a positive integer/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
      return String((issue as Record<string, unknown>).message).includes(
        "seed must not be empty",
      );
    }),
  );
});

test("GET /api/oracle/simulation delegates seeded simulations to the worker", async () => {
  resetOracleForTests();
  const ratings = Object.fromEntries(
    WC2026_TEAMS.map((team) => [
      team.name,
      DEFAULT_MODEL_CONFIG.fallbackRating,
    ]),
  );
  seedReadyOracleForTests({
    ratings,
    simulationSeed: "cached-seed",
    simResult: createMarkedSimResult("Argentina"),
  });
  const restoreWorkerOptions = setSimulationWorkerOptionsForTests({
    simulationsRun: 1,
    timeoutMs: 5_000,
  });

  try {
    const response = await requestGet(
      "/api/oracle/simulation?seed=worker-success",
    );
    const data = readData(await readJson(response));
    const results = data.results as Array<Record<string, unknown>>;
    const expected = toPublishedSimulationResults(
      runSimulations(
        ratings,
        [],
        {},
        {
          seed: "worker-success",
          simulationsRun: 1,
          modelConfig: DEFAULT_MODEL_CONFIG,
        },
      ),
      ratings,
      NUM_SIMULATIONS,
      new Set(),
      DEFAULT_MODEL_CONFIG,
    );

    assert.equal(response.status, 200);
    assert.equal(data.simulationSeed, "worker-success");
    assert.deepEqual(results, expected);
  } finally {
    restoreWorkerOptions();
    resetOracleForTests();
  }
});

test("GET /api/oracle/simulation returns a controlled error when the worker crashes", async () => {
  resetOracleForTests();
  const dir = await createTempDir("oracle-worker-crash-");
  seedReadyOracleForTests({
    simulationSeed: "cached-seed",
    simResult: createMarkedSimResult("Argentina"),
  });

  const restoreWorkerOptions = setSimulationWorkerOptionsForTests({
    workerUrl: await writeTempWorker(
      dir,
      "crash-worker.mjs",
      'throw new Error("worker boom");\n',
    ),
    simulationsRun: 1,
    timeoutMs: 5_000,
  });

  try {
    const response = await requestGet("/api/oracle/simulation?seed=crash-test");
    const error = readError(await readJson(response));

    assert.equal(response.status, 503);
    assert.equal(error.code, "simulation_unavailable");
    assert.match(String(error.message), /could not be completed/i);

    const cachedResponse = await requestGet("/api/oracle/simulation");
    const cached = readData(await readJson(cachedResponse));
    const cachedResults = cached.results as Array<Record<string, unknown>>;
    assert.equal(cachedResponse.status, 200);
    assert.equal(cached.simulationSeed, "cached-seed");
    assert.equal(cachedResults[0]?.name, "Argentina");
  } finally {
    restoreWorkerOptions();
    resetOracleForTests();
    await rm(dir, { recursive: true, force: true });
  }
});

test("GET /api/oracle/simulation times out stalled worker runs without replacing cached results", async () => {
  resetOracleForTests();
  const dir = await createTempDir("oracle-worker-timeout-");
  seedReadyOracleForTests({
    simulationSeed: "cached-seed",
    simResult: createMarkedSimResult("Argentina"),
  });

  const restoreWorkerOptions = setSimulationWorkerOptionsForTests({
    workerUrl: await writeTempWorker(
      dir,
      "hanging-worker.mjs",
      [
        'import { parentPort } from "node:worker_threads";',
        'parentPort?.on("message", () => {});',
        "",
      ].join("\n"),
    ),
    simulationsRun: 1,
    timeoutMs: 25,
  });

  try {
    const response = await requestGet(
      "/api/oracle/simulation?seed=timeout-test",
    );
    const error = readError(await readJson(response));

    assert.equal(response.status, 503);
    assert.equal(error.code, "simulation_unavailable");
    assert.match(String(error.message), /could not be completed/i);

    const cachedResponse = await requestGet("/api/oracle/simulation");
    const cached = readData(await readJson(cachedResponse));
    const cachedResults = cached.results as Array<Record<string, unknown>>;
    assert.equal(cachedResponse.status, 200);
    assert.equal(cached.simulationSeed, "cached-seed");
    assert.equal(cachedResults[0]?.name, "Argentina");
  } finally {
    restoreWorkerOptions();
    resetOracleForTests();
    await rm(dir, { recursive: true, force: true });
  }
});

test("GET /api/oracle/simulation rejects ad hoc runs when the queue is saturated", async () => {
  resetOracleForTests();
  seedReadyOracleForTests({
    simulationSeed: "cached-seed",
    simResult: createMarkedSimResult("Argentina"),
  });

  const firstRunStarted = createDeferred<void>();
  const firstRun = createDeferred<SimResult>();
  let runnerCalls = 0;
  const restoreRunner = setSimulationRunnerForTests(async () => {
    runnerCalls += 1;
    firstRunStarted.resolve();
    return firstRun.promise;
  });
  const restoreWorkerOptions = setSimulationWorkerOptionsForTests({
    adHocConcurrency: 1,
    adHocQueueLimit: 0,
  });

  try {
    const firstResponsePromise = requestGet(
      "/api/oracle/simulation?seed=queue-one",
    );
    await firstRunStarted.promise;

    const secondResponse = await requestGet(
      "/api/oracle/simulation?seed=queue-two",
    );
    const secondError = readError(await readJson(secondResponse));

    assert.equal(secondResponse.status, 429);
    assert.equal(secondError.code, "simulation_capacity_exceeded");
    assert.equal(runnerCalls, 1);

    firstRun.resolve(createMarkedSimResult("Mexico"));
    const firstResponse = await firstResponsePromise;
    assert.equal(firstResponse.status, 200);
  } finally {
    restoreWorkerOptions();
    restoreRunner();
    firstRun.resolve(createMarkedSimResult("Mexico"));
    resetOracleForTests();
  }
});

test("GET /api/oracle/simulation keeps custom match overrides request-local", async () => {
  resetOracleForTests();
  seedReadyOracleForTests({
    simulationSeed: "cached-seed",
    simResult: createMarkedSimResult("Argentina"),
  });
  const runnerCalls: Array<
    Parameters<Parameters<typeof setSimulationRunnerForTests>[0]>[0]
  > = [];
  const restoreRunner = setSimulationRunnerForTests(async (snapshot) => {
    runnerCalls.push(snapshot);
    const mexicoOverride = snapshot.playedMatches.find(
      (match) =>
        match.homeTeam === "Mexico" && match.awayTeam === "South Africa",
    );

    return createMarkedSimResult(mexicoOverride ? "Mexico" : "Canada");
  });

  try {
    const mexicoScenario = encodeURIComponent(
      JSON.stringify([
        {
          homeTeam: "Mexico",
          awayTeam: "South Africa",
          homeScore: 3,
          awayScore: 0,
        },
      ]),
    );
    const canadaScenario = encodeURIComponent(
      JSON.stringify([
        {
          homeTeam: "Canada",
          awayTeam: "Morocco",
          homeScore: 0,
          awayScore: 2,
        },
      ]),
    );

    const [mexicoResponse, canadaResponse] = await Promise.all([
      requestGet(`/api/oracle/simulation?customMatches=${mexicoScenario}`),
      requestGet(`/api/oracle/simulation?customMatches=${canadaScenario}`),
    ]);
    const mexicoData = readData(await readJson(mexicoResponse));
    const canadaData = readData(await readJson(canadaResponse));
    const mexicoResults = mexicoData.results as Array<Record<string, unknown>>;
    const canadaResults = canadaData.results as Array<Record<string, unknown>>;

    assert.equal(mexicoResponse.status, 200);
    assert.equal(canadaResponse.status, 200);
    assert.equal(mexicoResults[0]?.name, "Mexico");
    assert.equal(canadaResults[0]?.name, "Canada");
    assert.equal(mexicoData.liveMatchesRecorded, 1);
    assert.equal(canadaData.liveMatchesRecorded, 1);
    assert.equal(runnerCalls.length, 2);
    assert.deepEqual(
      runnerCalls
        .map((call) =>
          call.playedMatches.map(
            (match) => `${match.homeTeam}-${match.awayTeam}`,
          ),
        )
        .sort(),
      [["Mexico-South Africa"], ["Canada-Morocco"]].sort(),
    );

    const liveMatchesResponse = await requestGet("/api/oracle/live-matches");
    const liveMatches = readData(await readJson(liveMatchesResponse))
      .playedMatches as Array<Record<string, unknown>>;
    const statusResponse = await requestGet("/api/oracle/status");
    const status = readData(await readJson(statusResponse));

    assert.equal(status.liveMatchesRecorded, 0);
    assert.equal(
      liveMatches.some((match) => match.source === "custom"),
      false,
    );
  } finally {
    restoreRunner();
    resetOracleForTests();
  }
});

test("POST /api/oracle/live-match accepts legacy overrides without storing or recalculating simulation", async () => {
  resetOracleForTests();
  seedReadyOracleForTests({
    lastUpdated: "2026-01-01T00:00:00.000Z",
    simulationSeed: "initial-seed",
    simResult: createMarkedSimResult("Argentina"),
  });
  const runnerCalls: Array<
    Parameters<Parameters<typeof setSimulationRunnerForTests>[0]>[0]
  > = [];
  const restoreRunner = setSimulationRunnerForTests(async (snapshot) => {
    runnerCalls.push(snapshot);
    return createMarkedSimResult("France");
  });

  try {
    const response = await requestJson("POST", "/api/oracle/live-match", {
      homeTeam: "Mexico",
      awayTeam: "South Africa",
      homeScore: 2,
      awayScore: 1,
    });

    assert.equal(response.status, 200);
    const body = await readJson(response);
    const data = readData(body);
    assert.equal(data.success, true);
    assert.equal(data.liveMatchesCount, 0);

    const statusResponse = await requestGet("/api/oracle/status");
    const status = readData(await readJson(statusResponse));
    assert.equal(status.liveMatchesRecorded, 0);
    assert.equal(status.recalculating, false);
    assert.equal(status.lastUpdated, "2026-01-01T00:00:00.000Z");
    assert.equal(status.recalculationError, null);

    const simulationResponse = await requestGet("/api/oracle/simulation");
    const simulation = readData(await readJson(simulationResponse));
    const results = simulation.results as Array<Record<string, unknown>>;
    assert.equal(simulation.simulationSeed, "initial-seed");
    assert.equal(simulation.liveMatchesRecorded, 0);
    assert.equal(results[0]?.name, "Argentina");
    assert.equal(runnerCalls.length, 0);

    const liveMatchesResponse = await requestGet("/api/oracle/live-matches");
    const liveMatches = readData(await readJson(liveMatchesResponse))
      .playedMatches as Array<Record<string, unknown>>;
    assert.equal(
      liveMatches.some((match) => match.source === "custom"),
      false,
    );
  } finally {
    restoreRunner();
    resetOracleForTests();
  }
});

test("consecutive legacy live-match updates do not pollute cached simulation results", async () => {
  resetOracleForTests();
  seedReadyOracleForTests({
    lastUpdated: "2026-01-01T00:00:00.000Z",
    simulationSeed: "initial-seed",
    simResult: createMarkedSimResult("Argentina"),
  });
  const runnerCalls: Array<
    Parameters<Parameters<typeof setSimulationRunnerForTests>[0]>[0]
  > = [];
  const restoreRunner = setSimulationRunnerForTests(async (snapshot) => {
    runnerCalls.push(snapshot);
    return createMarkedSimResult("France");
  });

  try {
    const firstResponse = await requestJson("POST", "/api/oracle/live-match", {
      homeTeam: "Mexico",
      awayTeam: "South Africa",
      homeScore: 1,
      awayScore: 0,
    });
    assert.equal(firstResponse.status, 200);

    const secondResponse = await requestJson("POST", "/api/oracle/live-match", {
      homeTeam: "Canada",
      awayTeam: "Morocco",
      homeScore: 0,
      awayScore: 2,
    });
    assert.equal(secondResponse.status, 200);

    const statusResponse = await requestGet("/api/oracle/status");
    const status = readData(await readJson(statusResponse));
    assert.equal(status.liveMatchesRecorded, 0);
    assert.equal(status.recalculating, false);

    const finalResponse = await requestGet("/api/oracle/simulation");
    const final = readData(await readJson(finalResponse));
    const finalResults = final.results as Array<Record<string, unknown>>;
    assert.equal(finalResults[0]?.name, "Argentina");
    assert.equal(final.simulationSeed, "initial-seed");
    assert.equal(final.liveMatchesRecorded, 0);
    assert.equal(runnerCalls.length, 0);
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

  await expectValidationIssue(
    "DELETE",
    "/api/oracle/live-match",
    {
      homeTeam: "Mexico",
    },
    "awayTeam",
  );

  await expectValidationIssue(
    "DELETE",
    "/api/oracle/live-match",
    {
      homeTeam: "Mexico",
      awayTeam: "Mexico",
    },
    "Teams must be different",
  );

  await expectValidationIssue(
    "DELETE",
    "/api/oracle/live-match",
    {
      homeTeam: "Mexico",
      awayTeam: "Atlantis",
    },
    "Unknown team: Atlantis",
  );

  await expectValidationIssue(
    "DELETE",
    "/api/oracle/live-match",
    {
      homeTeam: "Mexico",
      awayTeam: "South Africa",
      reason: "mistake",
    },
    "Unrecognized key",
  );
});

test("DELETE /api/oracle/live-match removes an existing override when teams are inverted", async () => {
  resetOracleForTests();

  try {
    const postResponse = await requestJson("POST", "/api/oracle/live-match", {
      homeTeam: "Mexico",
      awayTeam: "South Africa",
      homeScore: 1,
      awayScore: 0,
    });
    assert.equal(postResponse.status, 200);

    const deleteResponse = await requestJson(
      "DELETE",
      "/api/oracle/live-match",
      {
        homeTeam: "South Africa",
        awayTeam: "Mexico",
      },
    );
    const deleteBody = await readJson(deleteResponse);
    const deleteData = readData(deleteBody);

    assert.equal(deleteResponse.status, 200);
    assert.equal(deleteData.liveMatchesCount, 0);

    const liveMatchesResponse = await requestGet("/api/oracle/live-matches");
    const liveMatches = readData(await readJson(liveMatchesResponse))
      .playedMatches as Array<Record<string, unknown>>;

    assert.equal(
      liveMatches.some(
        (match) =>
          (match.homeTeam === "Mexico" && match.awayTeam === "South Africa") ||
          (match.homeTeam === "South Africa" && match.awayTeam === "Mexico"),
      ),
      false,
    );
  } finally {
    resetOracleForTests();
  }
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
  assert.ok(validData.experimentalModifiers);
  assert.equal(
    (validData.experimentalModifiers as Record<string, unknown>).enabled,
    false,
  );

  await expectValidationIssue(
    "POST",
    "/api/oracle/predict-match",
    {
      homeTeam: "Brazil",
    },
    "awayTeam",
  );

  await expectValidationIssue(
    "POST",
    "/api/oracle/predict-match",
    {
      homeTeam: "Brazil",
      awayTeam: "Brazil",
    },
    "Teams must be different",
  );

  await expectValidationIssue(
    "POST",
    "/api/oracle/predict-match",
    {
      homeTeam: "Brazil",
      awayTeam: "Atlantis",
    },
    "Unknown team: Atlantis",
  );

  await expectValidationIssue(
    "POST",
    "/api/oracle/predict-match",
    {
      homeTeam: "Brazil",
      awayTeam: "Morocco",
      neutralSite: true,
    },
    "Unrecognized key",
  );

  const invalidFlagResponse = await requestJson(
    "POST",
    "/api/oracle/predict-match?experimentalModifiers=maybe",
    {
      homeTeam: "Brazil",
      awayTeam: "Morocco",
    },
  );
  const invalidFlagBody = await readJson(invalidFlagResponse);
  const invalidFlagError = readError(invalidFlagBody);

  assert.equal(invalidFlagResponse.status, 400);
  assert.equal(invalidFlagError.code, "invalid_request");
  assert.ok(
    JSON.stringify(invalidFlagError.issues).includes("experimentalModifiers"),
  );
});

test("POST /api/oracle/predict-match reports explicit experimental modifier opt-in", async () => {
  resetOracleForTests();
  seedReadyOracleForTests({
    ratings: {
      Brazil: 1500,
      Morocco: 1500,
    },
  });

  try {
    const response = await requestJson(
      "POST",
      "/api/oracle/predict-match?experimentalModifiers=true",
      {
        homeTeam: "Brazil",
        awayTeam: "Morocco",
      },
    );
    const data = readData(await readJson(response));
    const experimentalModifiers = data.experimentalModifiers as Record<
      string,
      unknown
    >;

    assert.equal(response.status, 200);
    assert.equal(experimentalModifiers.enabled, true);
    assert.deepEqual(experimentalModifiers.applied, []);
    assert.equal(experimentalModifiers.ignoredCount, 0);
  } finally {
    resetOracleForTests();
  }
});

test("POST /api/oracle/predict-match applies venue context fields", async () => {
  resetOracleForTests();
  seedReadyOracleForTests({
    ratings: {
      Brazil: 1500,
      Morocco: 1500,
    },
  });

  try {
    const neutralResponse = await requestJson(
      "POST",
      "/api/oracle/predict-match",
      {
        homeTeam: "Brazil",
        awayTeam: "Morocco",
        neutral: true,
        isHomeA: false,
        isHomeB: false,
      },
    );
    const teamOneHomeResponse = await requestJson(
      "POST",
      "/api/oracle/predict-match",
      {
        homeTeam: "Brazil",
        awayTeam: "Morocco",
        neutral: false,
        isHomeA: true,
        isHomeB: false,
      },
    );
    const teamTwoHomeResponse = await requestJson(
      "POST",
      "/api/oracle/predict-match",
      {
        homeTeam: "Brazil",
        awayTeam: "Morocco",
        neutral: false,
        isHomeA: false,
        isHomeB: true,
      },
    );

    assert.equal(neutralResponse.status, 200);
    assert.equal(teamOneHomeResponse.status, 200);
    assert.equal(teamTwoHomeResponse.status, 200);

    const neutral = readData(await readJson(neutralResponse));
    const teamOneHome = readData(await readJson(teamOneHomeResponse));
    const teamTwoHome = readData(await readJson(teamTwoHomeResponse));

    assert.ok(Number(teamOneHome.homeWinPct) > Number(neutral.homeWinPct));
    assert.ok(Number(teamTwoHome.awayWinPct) > Number(neutral.awayWinPct));
    assert.equal(teamOneHome.homeWinPct, teamTwoHome.awayWinPct);
  } finally {
    resetOracleForTests();
  }
});

test("POST /api/oracle/predict-match applies custom match overrides without mutating global state", async () => {
  resetOracleForTests();
  seedReadyOracleForTests({
    ratings: {
      Mexico: 1500,
      "South Africa": 1500,
    },
  });

  try {
    const mexicoWinResponse = await requestJson(
      "POST",
      "/api/oracle/predict-match",
      {
        homeTeam: "Mexico",
        awayTeam: "South Africa",
        customMatches: [
          {
            homeTeam: "Mexico",
            awayTeam: "South Africa",
            homeScore: 2,
            awayScore: 0,
          },
        ],
      },
    );
    const mexicoLossResponse = await requestJson(
      "POST",
      "/api/oracle/predict-match",
      {
        homeTeam: "Mexico",
        awayTeam: "South Africa",
        customMatches: [
          {
            homeTeam: "South Africa",
            awayTeam: "Mexico",
            homeScore: 1,
            awayScore: 0,
          },
        ],
      },
    );
    const mexicoWin = readData(await readJson(mexicoWinResponse));
    const mexicoLoss = readData(await readJson(mexicoLossResponse));

    assert.equal(mexicoWinResponse.status, 200);
    assert.equal(mexicoLossResponse.status, 200);
    assert.equal(mexicoWin.homeWinPct, 100);
    assert.equal(mexicoWin.awayWinPct, 0);
    assert.equal(mexicoWin.mostLikelyScore, "2-0");
    assert.equal(mexicoLoss.homeWinPct, 0);
    assert.equal(mexicoLoss.awayWinPct, 100);
    assert.equal(mexicoLoss.mostLikelyScore, "0-1");

    const liveMatchesResponse = await requestGet("/api/oracle/live-matches");
    const liveMatches = readData(await readJson(liveMatchesResponse))
      .playedMatches as Array<Record<string, unknown>>;
    const statusResponse = await requestGet("/api/oracle/status");
    const status = readData(await readJson(statusResponse));

    assert.equal(status.liveMatchesRecorded, 0);
    assert.equal(
      liveMatches.some((match) => match.source === "custom"),
      false,
    );
  } finally {
    resetOracleForTests();
  }
});

test("POST /api/oracle/predict-match ignores custom overrides for locked external results", async () => {
  resetOracleForTests();
  seedReadyOracleForTests({
    ratings: {
      Mexico: 1500,
      "South Africa": 1500,
    },
    liveDataMatches: [
      {
        homeTeam: "Mexico",
        awayTeam: "South Africa",
        homeScore: 0,
        awayScore: 1,
        source: "espn",
        status: "finished",
      },
    ],
  });

  try {
    const response = await requestJson("POST", "/api/oracle/predict-match", {
      homeTeam: "Mexico",
      awayTeam: "South Africa",
      customMatches: [
        {
          homeTeam: "Mexico",
          awayTeam: "South Africa",
          homeScore: 9,
          awayScore: 0,
        },
      ],
    });
    const data = readData(await readJson(response));

    assert.equal(response.status, 200);
    assert.equal(data.homeWinPct, 0);
    assert.equal(data.drawPct, 0);
    assert.equal(data.awayWinPct, 100);
    assert.equal(data.mostLikelyScore, "0-1");
  } finally {
    resetOracleForTests();
  }
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
  const body = (await response.json()) as {
    error: { code: string; message: string };
  };
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
  const body = (await response.json()) as {
    error: { code: string; message: string };
  };
  assert.equal(body.error.code, "cors_not_allowed");
  assert.equal(
    body.error.message,
    "Request origin is not allowed by CORS policy",
  );

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
