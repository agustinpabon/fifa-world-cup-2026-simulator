import assert from "node:assert/strict";
import test from "node:test";

import { createModelConfig } from "./config.js";
import {
  applyMatchToRatingState,
  computeRatingsAndTeamMetrics,
  createEmptyRatingState,
  summarizeStrengthMetrics,
  type RatingMatchRow,
  type RatingState,
} from "./ratings.js";

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

function ratingDeltaForHome(matchInput: RatingMatchRow, state: RatingState = createEmptyRatingState()): number {
  const next = applyMatchToRatingState(state, matchInput, {
    homeAdvantageElo: 0,
    marginOfVictoryEloScalingConstant: 2200,
    referenceYear: 2026,
    useMarginOfVictoryElo: true,
  });

  return (next.ratings.get(matchInput.homeTeam) ?? 1500) - (state.ratings.get(matchInput.homeTeam) ?? 1500);
}

function assertAlmostEqual(actual: number, expected: number, tolerance = 1e-12): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

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

test("margin of victory Elo increases rating changes for wider wins against the same opponent", () => {
  const narrowWinDelta = ratingDeltaForHome(match("2026-01-01", "Target", "Opponent", 1, 0));
  const wideWinDelta = ratingDeltaForHome(match("2026-01-01", "Target", "Opponent", 5, 0));

  assert.ok(
    wideWinDelta > narrowWinDelta,
    `expected 5-0 delta ${wideWinDelta} to exceed 1-0 delta ${narrowWinDelta}`
  );
});

test("margin of victory Elo rating changes follow the log-scaled multiplier ratio", () => {
  const narrowWinDelta = ratingDeltaForHome(match("2026-01-01", "Target", "Opponent", 1, 0));
  const wideWinDelta = ratingDeltaForHome(match("2026-01-01", "Target", "Opponent", 5, 0));
  const expectedRatio = Math.log(6) / Math.log(2);

  assertAlmostEqual(wideWinDelta / narrowWinDelta, expectedRatio);
});

test("margin of victory Elo keeps draw multipliers at one", () => {
  const state: RatingState = {
    ratings: new Map([
      ["Target", 1600],
      ["Opponent", 1500],
    ]),
    samples: new Map(),
  };
  const draw = match("2026-01-01", "Target", "Opponent", 1, 1);
  const enabledDelta = ratingDeltaForHome(draw, state);
  const disabledState = applyMatchToRatingState(state, draw, {
    homeAdvantageElo: 0,
    referenceYear: 2026,
    useMarginOfVictoryElo: false,
  });
  const disabledDelta = (disabledState.ratings.get(draw.homeTeam) ?? 1500) - (state.ratings.get(draw.homeTeam) ?? 1500);

  assertAlmostEqual(enabledDelta, disabledDelta);
});
