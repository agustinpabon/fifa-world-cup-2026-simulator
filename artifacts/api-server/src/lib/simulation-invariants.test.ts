import assert from "node:assert/strict";
import test from "node:test";

import {
  NUM_SIMULATIONS,
  runSimulations,
  toPublishedSimulationResults,
  type SimResult,
} from "./simulation.js";
import { WC2026_TEAMS } from "./worldcup2026.js";

const EXPECTED_ROUND_TOTALS: ReadonlyArray<[keyof SimResult, number]> = [
  ["titles", NUM_SIMULATIONS],
  ["finals", NUM_SIMULATIONS * 2],
  ["semiFinals", NUM_SIMULATIONS * 4],
  ["quarterFinals", NUM_SIMULATIONS * 8],
  ["roundOf16", NUM_SIMULATIONS * 16],
  ["groupWins", NUM_SIMULATIONS * 12],
  ["groupAdvances", NUM_SIMULATIONS * 32],
];

const PUBLISHED_PERCENT_FIELDS = [
  "titlePct",
  "finalPct",
  "semiFinalPct",
  "quarterFinalPct",
  "roundOf16Pct",
  "groupWinPct",
  "groupAdvancePct",
] as const;

let cachedResult: SimResult | undefined;

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function buildRatings(): Record<string, number> {
  return Object.fromEntries(WC2026_TEAMS.map((team) => [team.name, 1500]));
}

function getSimulationResult(): SimResult {
  cachedResult ??= runSimulations(buildRatings());
  return cachedResult;
}

function sumCounts(countsByTeam: Record<string, number>): number {
  return Object.values(countsByTeam).reduce((total, count) => total + count, 0);
}

test("simulation records exactly one champion per tournament run", () => {
  const result = getSimulationResult();

  assert.equal(sumCounts(result.titles), NUM_SIMULATIONS);
});

test("simulation aggregate round totals match the 48-team tournament format", () => {
  const result = getSimulationResult();

  for (const [bucket, expectedTotal] of EXPECTED_ROUND_TOTALS) {
    assert.equal(sumCounts(result[bucket]), expectedTotal, `${bucket} should total ${expectedTotal}`);
  }
});

test("simulation result buckets include every qualified team and no extras", () => {
  const result = getSimulationResult();
  const expectedTeams = sorted(WC2026_TEAMS.map((team) => team.name));

  for (const bucket of Object.keys(result) as Array<keyof SimResult>) {
    assert.deepEqual(sorted(Object.keys(result[bucket])), expectedTeams, `${bucket} should contain all teams`);
  }
});

test("published simulation probabilities stay between 0 and 100", () => {
  const rows = toPublishedSimulationResults(getSimulationResult(), buildRatings(), NUM_SIMULATIONS);

  assert.equal(rows.length, WC2026_TEAMS.length);

  for (const row of rows) {
    for (const field of PUBLISHED_PERCENT_FIELDS) {
      assert.ok(row[field] >= 0, `${row.name} ${field} should be non-negative`);
      assert.ok(row[field] <= 100, `${row.name} ${field} should be at most 100`);
    }
  }
});
