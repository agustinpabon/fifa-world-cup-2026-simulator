import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  HistoricalDataLoadError,
  competitionMetricWeight,
  computeRatingsAndTeamMetrics,
  loadHistoricalDataset,
  type RatingMatchRow,
} from "./elo.js";

function match(
  date: string,
  homeTeam: string,
  awayTeam: string,
  homeScore: number,
  awayScore: number,
  tournament = "Friendly",
  neutral = true
): RatingMatchRow {
  return { date, homeTeam, awayTeam, homeScore, awayScore, tournament, neutral };
}

const metricTeams = [
  { name: "Target", csvName: "Target" },
  { name: "Peer", csvName: "Peer" },
  { name: "Elite", csvName: "Elite" },
  { name: "Weak", csvName: "Weak" },
  { name: "Flash", csvName: "Flash" },
  { name: "Opponent", csvName: "Opponent" },
];

const remoteCsv = [
  "date,home_team,away_team,home_score,away_score,tournament,city,country,neutral",
  "2024-01-01,Remote A,Remote B,2,1,Friendly,City,Country,TRUE",
  "2024-02-01,Remote B,Remote A,0,0,Friendly,City,Country,TRUE",
].join("\n");

const snapshotCsv = [
  "date,home_team,away_team,home_score,away_score,tournament,city,country,neutral",
  "2023-01-01,Snapshot A,Snapshot B,1,0,Friendly,City,Country,TRUE",
  "2023-02-01,Snapshot B,Snapshot A,3,2,Friendly,City,Country,TRUE",
].join("\n");

function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function writeSnapshot(raw = snapshotCsv): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "oracle-snapshot-"));
  const path = join(dir, "results.csv");
  await writeFile(path, raw);
  return path;
}

test("competition metric weights distinguish major tournaments from friendlies", () => {
  assert.ok(competitionMetricWeight("FIFA World Cup") > competitionMetricWeight("FIFA World Cup qualification"));
  assert.ok(competitionMetricWeight("FIFA World Cup qualification") > competitionMetricWeight("Friendly"));
});

test("team metrics reward goals scored against stronger opponents at match time", () => {
  const { teamMetrics } = computeRatingsAndTeamMetrics(
    [
      match("2024-01-01", "Elite", "Weak", 5, 0, "FIFA World Cup"),
      match("2024-02-01", "Elite", "Weak", 4, 0, "FIFA World Cup"),
      match("2025-01-01", "Target", "Elite", 1, 0, "Friendly"),
      match("2025-01-02", "Peer", "Weak", 1, 0, "Friendly"),
    ],
    metricTeams,
    { referenceYear: 2026, initialRating: 1500 }
  );

  assert.ok(
    teamMetrics.Target.attackStrength > teamMetrics.Peer.attackStrength,
    `expected Target attack ${teamMetrics.Target.attackStrength} to exceed Peer attack ${teamMetrics.Peer.attackStrength}`
  );
});

test("team metrics shrink small-sample goal spikes instead of maxing out immediately", () => {
  const { teamMetrics } = computeRatingsAndTeamMetrics(
    [match("2026-01-01", "Flash", "Opponent", 12, 0, "Friendly")],
    metricTeams,
    { referenceYear: 2026, initialRating: 1500 }
  );

  assert.ok(teamMetrics.Flash.attackStrength < 1.5);
  assert.ok(teamMetrics.Opponent.defenseStrength < 1.5);
});

test("historical dataset loader uses remote CSV with date, source, and hash metadata", async () => {
  let requestCount = 0;

  const dataset = await loadHistoricalDataset({
    fetchImpl: async () => {
      requestCount += 1;
      return new Response(remoteCsv);
    },
    maxAttempts: 3,
    snapshotPath: await writeSnapshot(),
    timeoutMs: 100,
  });

  assert.equal(requestCount, 1);
  assert.equal(dataset.rows.length, 2);
  assert.equal(dataset.metadata.source, "remote");
  assert.equal(dataset.metadata.date, "2024-02-01");
  assert.equal(dataset.metadata.hash, sha256(remoteCsv));
  assert.equal(
    dataset.metadata.remoteUrl,
    "https://raw.githubusercontent.com/martj42/international_results/master/results.csv"
  );
});

test("historical dataset loader retries timed-out remote fetches and falls back to snapshot", async () => {
  let requestCount = 0;
  let abortCount = 0;

  const dataset = await loadHistoricalDataset({
    fetchImpl: async (_input, init) => {
      requestCount += 1;

      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            abortCount += 1;
            reject(new Error("aborted by test"));
          },
          { once: true }
        );
      });
    },
    maxAttempts: 2,
    snapshotPath: await writeSnapshot(),
    timeoutMs: 1,
  });

  assert.equal(requestCount, 2);
  assert.equal(abortCount, 2);
  assert.equal(dataset.rows.length, 2);
  assert.equal(dataset.metadata.source, "snapshot");
  assert.equal(dataset.metadata.date, "2023-02-01");
  assert.equal(dataset.metadata.hash, sha256(snapshotCsv));
  assert.match(dataset.metadata.fallbackReason ?? "", /timed out/i);
});

test("historical dataset loader uses the packaged snapshot when remote fetch fails", async () => {
  const dataset = await loadHistoricalDataset({
    fetchImpl: async () => {
      throw new Error("network disabled by test");
    },
    maxAttempts: 1,
    timeoutMs: 100,
  });

  assert.equal(dataset.metadata.source, "snapshot");
  assert.ok(dataset.rows.length > 40_000);
  assert.equal(
    dataset.metadata.hash,
    "df6a30676640fc647f2af51d387765996f75c7cda10d70d7c81ef9180c23df08"
  );
  assert.match(dataset.metadata.fallbackReason ?? "", /network disabled/i);
});

test("historical dataset loader reports an explicit error when remote and snapshot loading fail", async () => {
  await assert.rejects(
    () =>
      loadHistoricalDataset({
        fetchImpl: async () => new Response("upstream unavailable", { status: 503 }),
        maxAttempts: 1,
        snapshotPath: "/definitely/missing/results.csv",
        timeoutMs: 100,
      }),
    (error) => {
      assert.ok(error instanceof HistoricalDataLoadError);
      assert.equal(error.code, "HISTORICAL_DATA_LOAD_FAILED");
      assert.match(error.message, /could not be loaded/i);
      return true;
    }
  );
});
