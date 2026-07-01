import assert from "node:assert/strict";
import test from "node:test";

import { createModelConfig } from "./config.js";
import { computeRatingsAndTeamMetrics, summarizeStrengthMetrics, type RatingMatchRow } from "./ratings.js";

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

const teams = [
  { name: "Target", csvName: "Target" },
  { name: "Peer", csvName: "Peer" },
  { name: "Elite", csvName: "Elite" },
  { name: "Weak", csvName: "Weak" },
  { name: "Flash", csvName: "Flash" },
  { name: "Opponent", csvName: "Opponent" },
];

test("rating center, fallback, and strength factor are aligned at neutral one", () => {
  const { teamMetrics } = computeRatingsAndTeamMetrics([], [{ name: "New Team", csvName: "New Team" }], {
    referenceYear: 2026,
  });

  assert.equal(teamMetrics["New Team"]?.elo, 1500);
  assert.equal(teamMetrics["New Team"]?.attackStrength, 1);
  assert.equal(teamMetrics["New Team"]?.defenseStrength, 1);
});

test("model config defaults recent strength metric half-life to two years", () => {
  assert.equal(createModelConfig().recentMetricHalfLifeYears, 2);
});

test("strength metrics give matches one half-life ago half the statistical weight of current matches", () => {
  const samples = new Map([
    [
      "Target",
      [
        {
          date: "2026-06-30",
          adjustedScored: 2,
          adjustedConceded: 1,
          adjustedWeight: 1,
        },
        {
          date: "2024-06-30",
          adjustedScored: 8,
          adjustedConceded: 5,
          adjustedWeight: 1,
        },
      ],
    ],
  ]);
  const metrics = summarizeStrengthMetrics(samples, "Target", "2026-06-30", 1500, {
    goalsPerTeamBaseline: 1,
    maxRecentGoalBlend: 1,
    recentMetricHalfLifeYears: 2,
    recentMetricPriorWeight: 0,
    recentMetricWindowYears: 8,
    strengthMin: 0,
    strengthMax: 10,
  });

  assert.ok(Math.abs(metrics.attackStrength - 4) < 1e-12);
  assert.ok(Math.abs(metrics.defenseStrength - 7 / 3) < 1e-12);
});

test("team metrics reward goals scored against stronger opponents at match time", () => {
  const { teamMetrics } = computeRatingsAndTeamMetrics(
    [
      match("2024-01-01", "Elite", "Weak", 5, 0, "FIFA World Cup"),
      match("2024-02-01", "Elite", "Weak", 4, 0, "FIFA World Cup"),
      match("2024-03-01", "Elite", "Weak", 5, 0, "FIFA World Cup"),
      match("2025-01-01", "Target", "Elite", 3, 0, "FIFA World Cup"),
      match("2025-02-01", "Target", "Elite", 2, 0, "FIFA World Cup"),
      match("2025-03-01", "Target", "Elite", 2, 0, "FIFA World Cup"),
      match("2025-01-02", "Peer", "Weak", 1, 0, "Friendly"),
      match("2025-02-02", "Peer", "Weak", 1, 0, "Friendly"),
      match("2025-03-02", "Peer", "Weak", 1, 0, "Friendly"),
    ],
    teams,
    { referenceYear: 2026 }
  );

  assert.ok(
    teamMetrics.Target.attackStrength > teamMetrics.Peer.attackStrength,
    `expected Target attack ${teamMetrics.Target.attackStrength} to exceed Peer attack ${teamMetrics.Peer.attackStrength}`
  );
});

test("team metrics shrink small-sample goal spikes instead of maxing out immediately", () => {
  const { teamMetrics } = computeRatingsAndTeamMetrics(
    [match("2026-01-01", "Flash", "Opponent", 12, 0, "Friendly")],
    teams,
    { referenceYear: 2026 }
  );

  assert.ok(teamMetrics.Flash.attackStrength < 1.5);
  assert.ok(teamMetrics.Opponent.defenseStrength < 1.5);
});
