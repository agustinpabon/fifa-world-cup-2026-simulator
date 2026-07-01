import assert from "node:assert/strict";
import test from "node:test";
import { predictMatch } from "@workspace/oracle-model";

import {
  calculateProbabilityUncertainty,
  createSeededRng,
  getPlayedKnockoutWinner,
  matchProbabilities,
  rankGroupStandingsByFifaCriteria,
  rankThirdPlacedTeamsByFifaCriteria,
  runSimulations,
  toPublishedSimulationResults,
  type GroupMatchScore,
  type GroupStanding,
  type SimResult,
} from "./simulation.js";
import { WC2026_TEAMS, type WCTeam } from "./worldcup2026.js";

function team(name: string): WCTeam {
  return {
    name,
    csvName: name,
    code: name.slice(0, 3).padEnd(3, "_").toUpperCase(),
    group: "A",
    flagEmoji: "",
  };
}

function standing(name: string, points: number, gf: number, ga: number, elo = 1500): GroupStanding {
  return {
    team: team(name),
    elo,
    points,
    gf,
    ga,
    gd: gf - ga,
  };
}

function match(homeTeam: string, awayTeam: string, homeScore: number, awayScore: number): GroupMatchScore {
  return { homeTeam, awayTeam, homeScore, awayScore };
}

function rankedNames(standings: readonly GroupStanding[]): string[] {
  return standings.map((entry) => entry.team.name);
}

function buildRatings(): Record<string, number> {
  return Object.fromEntries(WC2026_TEAMS.map((entry) => [entry.name, 1500]));
}

function assertAlmostEqual(actual: number, expected: number, tolerance = 1e-12): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

function assertNormalized(probabilities: { pWinA: number; pDraw: number; pWinB: number }): void {
  assertAlmostEqual(probabilities.pWinA + probabilities.pDraw + probabilities.pWinB, 1);
}

test("match probabilities are deterministic and symmetric for evenly matched neutral teams", () => {
  const first = matchProbabilities(1500, 1500, 1, undefined, undefined, false, false, true, { random: () => 0 });
  const second = matchProbabilities(1500, 1500, 100_000, undefined, undefined, false, false, true, {
    random: () => 0.99,
  });

  assert.deepEqual(first, second);
  assertAlmostEqual(first.pWinA, first.pWinB);
  assertNormalized(first);
  assert.match(first.mostLikelyScore, /^\d+-\d+$/);
});

test("match probabilities identify a clear favorite from the exact score matrix", () => {
  const favorite = matchProbabilities(1900, 1500);
  const mirrored = matchProbabilities(1500, 1900);
  const [mostLikelyHomeGoals, mostLikelyAwayGoals] = favorite.mostLikelyScore.split("-").map(Number);

  assertNormalized(favorite);
  assert.ok(favorite.pWinA > 0.6, `Expected clear favorite win probability, got ${favorite.pWinA}`);
  assert.ok(favorite.pWinB < 0.2, `Expected underdog win probability below 20%, got ${favorite.pWinB}`);
  assert.ok(favorite.xgA > favorite.xgB);
  assert.ok(mostLikelyHomeGoals > mostLikelyAwayGoals);
  assertAlmostEqual(favorite.pWinA, mirrored.pWinB);
  assertAlmostEqual(favorite.pWinB, mirrored.pWinA);
  assertAlmostEqual(favorite.pDraw, mirrored.pDraw);
});

test("match probabilities remain valid with attack and defense multipliers", () => {
  const probabilities = matchProbabilities(
    1650,
    1580,
    undefined,
    { elo: 1650, attackStrength: 1.42, defenseStrength: 0.74 },
    { elo: 1580, attackStrength: 0.88, defenseStrength: 1.21 }
  );

  assertNormalized(probabilities);
  for (const probability of [probabilities.pWinA, probabilities.pDraw, probabilities.pWinB]) {
    assert.ok(probability >= 0);
    assert.ok(probability <= 1);
  }
  assert.ok(probabilities.xgA > 0);
  assert.ok(probabilities.xgB > 0);
});

test("production match probabilities use the shared oracle-model predictor", () => {
  const metricsA = { elo: 1650, attackStrength: 1.12, defenseStrength: 0.91 };
  const metricsB = { elo: 1580, attackStrength: 1.04, defenseStrength: 0.96 };
  const production = matchProbabilities(
    1650,
    1580,
    undefined,
    metricsA,
    metricsB,
    true,
    false,
    false,
    {},
    { variant: "elo-poisson-strength", drawRate: 0.25 }
  );
  const shared = predictMatch({
    ratingA: 1650,
    ratingB: 1580,
    metricsA,
    metricsB,
    neutral: false,
    isHomeA: true,
    isHomeB: false,
    modelConfig: { variant: "elo-poisson-strength", drawRate: 0.25 },
  });

  assertAlmostEqual(production.pWinA, shared.probabilities.pWinA);
  assertAlmostEqual(production.pDraw, shared.probabilities.pDraw);
  assertAlmostEqual(production.pWinB, shared.probabilities.pWinB);
  assert.equal(production.mostLikelyScore, shared.mostLikelyScore);
});

test("match probabilities mirror non-neutral home advantage for team two", () => {
  const teamOneHome = matchProbabilities(
    1500,
    1500,
    undefined,
    undefined,
    undefined,
    true,
    false,
    false
  );
  const teamTwoHome = matchProbabilities(
    1500,
    1500,
    undefined,
    undefined,
    undefined,
    false,
    true,
    false
  );

  assertAlmostEqual(teamOneHome.pWinA, teamTwoHome.pWinB);
  assertAlmostEqual(teamOneHome.pWinB, teamTwoHome.pWinA);
  assertAlmostEqual(teamOneHome.pDraw, teamTwoHome.pDraw);
  assertAlmostEqual(teamOneHome.xgA, teamTwoHome.xgB);
  assertAlmostEqual(teamOneHome.xgB, teamTwoHome.xgA);
});

test("played knockout winner honors penalty or provider winner when scores are level", () => {
  assert.equal(
    getPlayedKnockoutWinner("Germany", "Paraguay", {
      homeTeam: "Germany",
      awayTeam: "Paraguay",
      homeScore: 1,
      awayScore: 1,
      winnerTeam: "Paraguay",
      status: "finished",
      source: "espn",
    }),
    "Paraguay"
  );
});

test("played knockout winner falls back to scoreline for completed non-draws", () => {
  assert.equal(
    getPlayedKnockoutWinner("Germany", "Paraguay", {
      homeTeam: "Germany",
      awayTeam: "Paraguay",
      homeScore: 2,
      awayScore: 0,
      status: "finished",
      source: "espn",
    }),
    "Germany"
  );
});

test("FIFA group ranking orders by points first", () => {
  const ranked = rankGroupStandingsByFifaCriteria(
    [standing("Alpha", 6, 3, 1), standing("Bravo", 7, 2, 0), standing("Charlie", 3, 1, 2)],
    [],
    { fallbackSeed: "points" }
  );

  assert.deepEqual(rankedNames(ranked), ["Bravo", "Alpha", "Charlie"]);
});

test("FIFA group ranking applies head-to-head before overall goal difference and goals scored", () => {
  const matches = [
    match("Alpha", "Bravo", 1, 0),
    match("Alpha", "Charlie", 0, 3),
    match("Alpha", "Delta", 3, 0),
    match("Bravo", "Charlie", 4, 0),
    match("Bravo", "Delta", 2, 0),
    match("Charlie", "Delta", 0, 0),
  ];
  const ranked = rankGroupStandingsByFifaCriteria(
    [
      standing("Alpha", 6, 4, 3, 1200),
      standing("Bravo", 6, 6, 1, 2000),
      standing("Charlie", 4, 3, 4),
      standing("Delta", 1, 0, 5),
    ],
    matches,
    { fallbackSeed: "head-to-head" }
  );

  assert.deepEqual(rankedNames(ranked).slice(0, 2), ["Alpha", "Bravo"]);
});

test("FIFA group ranking uses overall goal difference after tied head-to-head criteria", () => {
  const matches = [
    match("Alpha", "Bravo", 1, 1),
    match("Alpha", "Charlie", 2, 0),
    match("Alpha", "Delta", 0, 0),
    match("Bravo", "Charlie", 1, 0),
    match("Bravo", "Delta", 1, 1),
    match("Charlie", "Delta", 0, 0),
  ];
  const ranked = rankGroupStandingsByFifaCriteria(
    [
      standing("Alpha", 5, 3, 1),
      standing("Bravo", 5, 3, 2),
      standing("Charlie", 1, 0, 3),
      standing("Delta", 3, 1, 1),
    ],
    matches,
    { fallbackSeed: "goal-difference" }
  );

  assert.deepEqual(rankedNames(ranked).slice(0, 2), ["Alpha", "Bravo"]);
});

test("FIFA group ranking uses goals scored after tied points, head-to-head, and goal difference", () => {
  const matches = [
    match("Alpha", "Bravo", 0, 0),
    match("Alpha", "Charlie", 4, 3),
    match("Alpha", "Delta", 0, 1),
    match("Bravo", "Charlie", 2, 1),
    match("Bravo", "Delta", 1, 2),
    match("Charlie", "Delta", 0, 0),
  ];
  const ranked = rankGroupStandingsByFifaCriteria(
    [
      standing("Alpha", 4, 4, 4),
      standing("Bravo", 4, 3, 3),
      standing("Charlie", 1, 4, 6),
      standing("Delta", 7, 3, 1),
    ],
    matches,
    { fallbackSeed: "goals-scored" }
  );

  assert.deepEqual(rankedNames(ranked).slice(1, 3), ["Alpha", "Bravo"]);
});

test("unmodeled late FIFA tiebreakers are deterministic and do not use Elo", () => {
  const tied = [
    standing("Alpha", 3, 0, 0, 1000),
    standing("Bravo", 3, 0, 0, 2000),
    standing("Charlie", 3, 0, 0, 1400),
  ];
  const matches = [
    match("Alpha", "Bravo", 0, 0),
    match("Alpha", "Charlie", 0, 0),
    match("Bravo", "Charlie", 0, 0),
  ];
  const first = rankGroupStandingsByFifaCriteria(tied, matches, { fallbackSeed: "unmodeled" });
  const second = rankGroupStandingsByFifaCriteria(tied, matches, { fallbackSeed: "unmodeled" });
  const eloSwapped = rankGroupStandingsByFifaCriteria(
    [standing("Alpha", 3, 0, 0, 2000), standing("Bravo", 3, 0, 0, 1000), standing("Charlie", 3, 0, 0, 1400)],
    matches,
    { fallbackSeed: "unmodeled" }
  );

  assert.deepEqual(rankedNames(first), rankedNames(second));
  assert.deepEqual(rankedNames(first), rankedNames(eloSwapped));
});

test("third-place ranking has a seedable fallback and does not use Elo", () => {
  const first = rankThirdPlacedTeamsByFifaCriteria(
    [standing("Group A Third", 4, 2, 2, 1000), standing("Group B Third", 4, 2, 2, 2000)],
    { random: createSeededRng("third-place") }
  );
  const second = rankThirdPlacedTeamsByFifaCriteria(
    [standing("Group A Third", 4, 2, 2, 2000), standing("Group B Third", 4, 2, 2, 1000)],
    { random: createSeededRng("third-place") }
  );

  assert.deepEqual(rankedNames(first), rankedNames(second));
});

test("tournament simulations are reproducible for a fixed seed", () => {
  const first = runSimulations(buildRatings(), [], undefined, {
    seed: "stable-debug-seed",
    simulationsRun: 3,
  });
  const second = runSimulations(buildRatings(), [], undefined, {
    seed: "stable-debug-seed",
    simulationsRun: 3,
  });

  assert.deepEqual(first, second);
});

test("tournament simulations can use an injected RNG", () => {
  let calls = 0;
  const result = runSimulations(buildRatings(), [], undefined, {
    simulationsRun: 1,
    random: () => {
      calls += 1;
      return 0.42;
    },
  });

  assert.equal(Object.values(result.titles).reduce((total, count) => total + count, 0), 1);
  assert.ok(calls > 0);
});

test("probability uncertainty uses binomial standard error and bounded confidence intervals", () => {
  const uncertainty = calculateProbabilityUncertainty(25, 10_000);

  assertAlmostEqual(uncertainty.standardErrorPct, 0.43);
  assertAlmostEqual(uncertainty.confidenceIntervalLowPct, 24.15);
  assertAlmostEqual(uncertainty.confidenceIntervalHighPct, 25.85);

  const nearZero = calculateProbabilityUncertainty(0.02, 10_000);
  assert.equal(nearZero.confidenceIntervalLowPct, 0);

  const nearFull = calculateProbabilityUncertainty(99.98, 10_000);
  assert.equal(nearFull.confidenceIntervalHighPct, 100);
});

test("published simulation results include uncertainty for each probability", () => {
  const simResult: SimResult = {
    titles: {},
    finals: {},
    semiFinals: {},
    quarterFinals: {},
    roundOf16: {},
    groupWins: {},
    groupAdvances: {},
  };

  for (const team of WC2026_TEAMS) {
    simResult.titles[team.name] = team.name === "Argentina" ? 2500 : 0;
    simResult.finals[team.name] = 0;
    simResult.semiFinals[team.name] = 0;
    simResult.quarterFinals[team.name] = 0;
    simResult.roundOf16[team.name] = 0;
    simResult.groupWins[team.name] = 0;
    simResult.groupAdvances[team.name] = 0;
  }

  const argentina = toPublishedSimulationResults(simResult, buildRatings(), 10_000).find(
    (teamResult) => teamResult.name === "Argentina"
  );

  assert.ok(argentina);
  assert.equal(argentina.titlePct, 25);
  assertAlmostEqual(argentina.uncertainty.titlePct.standardErrorPct, 0.43);
  assertAlmostEqual(argentina.uncertainty.titlePct.confidenceIntervalLowPct, 24.15);
  assertAlmostEqual(argentina.uncertainty.titlePct.confidenceIntervalHighPct, 25.85);
});
