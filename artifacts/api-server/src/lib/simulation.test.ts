import assert from "node:assert/strict";
import test from "node:test";
import { buildScoreProbabilityMatrix, predictMatch } from "@workspace/oracle-model";

import {
  ACCLIMATIZATION_REST_DAYS,
  ALTITUDE_ELO_PENALTY,
  ALTITUDE_REFERENCE_EXCESS_METERS,
  HIGH_ALTITUDE_THRESHOLD_METERS,
  TRAVEL_FATIGUE_DISTANCE_CAP_KM,
  TRAVEL_FATIGUE_DISTANCE_REFERENCE_KM,
  TRAVEL_FATIGUE_ELO_PENALTY,
  TRAVEL_FATIGUE_REST_DECAY_RATE,
  applyMatchContextRatingAdjustments,
  calculateAltitudeEloAdjustment,
  calculateProbabilityUncertainty,
  calculateTravelDistanceKm,
  calculateTravelFatigueAdjustment,
  createSeededRng,
  getPlayedKnockoutWinner,
  matchProbabilities,
  rankGroupStandingsByFifaCriteria,
  rankThirdPlacedTeamsByFifaCriteria,
  runSimulations,
  simulateKnockout,
  toPublishedSimulationResults,
  type GroupMatchScore,
  type GroupStanding,
  type SimResult,
} from "./simulation.js";
import { WC2026_TEAMS, getHostVenueByName, type WCTeam } from "./worldcup2026.js";

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

function sequenceRng(values: readonly number[]): () => number {
  let index = 0;

  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error(`RNG sequence exhausted after ${index} draws`);
    }
    index += 1;
    return value;
  };
}

function scriptedRng(values: readonly number[], fallback = 0.9): () => number {
  let index = 0;

  return () => {
    const value = values[index] ?? fallback;
    index += 1;
    return value;
  };
}

function randomValueForScore(
  matrix: readonly { goalsA: number; goalsB: number; probability: number }[],
  goalsA: number,
  goalsB: number
): number {
  let cumulative = 0;

  for (const cell of matrix) {
    const start = cumulative;
    cumulative += cell.probability;

    if (cell.goalsA === goalsA && cell.goalsB === goalsB) {
      return start + cell.probability / 2;
    }
  }

  throw new Error(`No ${goalsA}-${goalsB} score cell found`);
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

function expectedTravelFatiguePenalty(distanceKm: number, restDays: number): number {
  return (
    TRAVEL_FATIGUE_ELO_PENALTY *
    (Math.min(distanceKm, TRAVEL_FATIGUE_DISTANCE_CAP_KM) / TRAVEL_FATIGUE_DISTANCE_REFERENCE_KM) *
    Math.exp(-TRAVEL_FATIGUE_REST_DECAY_RATE * restDays)
  );
}

function expectedAltitudePenalty(altitudeMeters: number, acclimatizationDays: number): number {
  const altitudeExcessMeters = Math.max(0, altitudeMeters - HIGH_ALTITUDE_THRESHOLD_METERS);
  const acclimatizationFactor = Math.max(0, 1 - acclimatizationDays / ACCLIMATIZATION_REST_DAYS);

  return ALTITUDE_ELO_PENALTY * (altitudeExcessMeters / ALTITUDE_REFERENCE_EXCESS_METERS) * acclimatizationFactor;
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

test("match probabilities apply high-altitude venue penalties to non-acclimatized teams", () => {
  const neutral = matchProbabilities(1500, 1500, undefined, undefined, undefined, false, false, true);
  const mexicoCity = matchProbabilities(
    1500,
    1500,
    undefined,
    undefined,
    undefined,
    false,
    false,
    true,
    {},
    undefined,
    {
      teamNameA: "Mexico",
      teamNameB: "South Africa",
      venue: "Mexico City",
      matchDate: "2026-06-11",
    }
  );

  assert.ok(HIGH_ALTITUDE_THRESHOLD_METERS < 2240);
  assert.equal(ALTITUDE_ELO_PENALTY, -50);
  assert.ok(mexicoCity.pWinA > neutral.pWinA);
  assert.ok(mexicoCity.pWinB < neutral.pWinB);
});

test("altitude adjustment exempts high-altitude home nations and acclimatized teams", () => {
  const mexicoCity = getHostVenueByName("Mexico City");
  assert.ok(mexicoCity);

  const mexicoCityFreshArrivalPenalty = expectedAltitudePenalty(mexicoCity.altitudeMeters, 0);
  const freshArrival = applyMatchContextRatingAdjustments({
    ratingA: 1500,
    ratingB: 1500,
    teamNameA: "Mexico",
    teamNameB: "South Africa",
    venue: mexicoCity.name,
    matchDate: "2026-06-11",
  });
  const acclimatized = applyMatchContextRatingAdjustments({
    ratingA: 1500,
    ratingB: 1500,
    teamNameA: "Mexico",
    teamNameB: "South Africa",
    venue: mexicoCity.name,
    matchDate: "2026-06-18",
    acclimatizationDaysB: ACCLIMATIZATION_REST_DAYS,
  });

  assert.equal(freshArrival.ratingA, 1500);
  assertAlmostEqual(freshArrival.ratingB, 1500 + mexicoCityFreshArrivalPenalty);
  assert.equal(acclimatized.ratingB, 1500);
});

test("altitude adjustment scales with altitude excess and partial acclimatization", () => {
  const guadalajara = getHostVenueByName("Guadalajara");
  const mexicoCity = getHostVenueByName("Mexico City");
  assert.ok(guadalajara);
  assert.ok(mexicoCity);

  assert.equal(HIGH_ALTITUDE_THRESHOLD_METERS, 1000);
  assert.equal(ALTITUDE_REFERENCE_EXCESS_METERS, 1240);
  assertAlmostEqual(
    calculateAltitudeEloAdjustment("South Africa", guadalajara, { acclimatizationDays: 0 }),
    expectedAltitudePenalty(guadalajara.altitudeMeters, 0)
  );
  assertAlmostEqual(
    calculateAltitudeEloAdjustment("South Africa", mexicoCity, { acclimatizationDays: 2 }),
    expectedAltitudePenalty(mexicoCity.altitudeMeters, 2)
  );
  assertAlmostEqual(
    calculateAltitudeEloAdjustment("South Africa", mexicoCity, { acclimatizationDays: 8 }),
    0
  );
});

test("travel fatigue scales with distance and decays with rest days", () => {
  const vancouver = getHostVenueByName("Vancouver");
  const miami = getHostVenueByName("Miami");
  assert.ok(vancouver);
  assert.ok(miami);

  const distanceKm = calculateTravelDistanceKm(vancouver, miami);
  const distantVenue = {
    ...miami,
    name: "Distant Test Venue",
    latitude: -vancouver.latitude,
    longitude: vancouver.longitude + 180,
  };
  const cappedDistanceKm = calculateTravelDistanceKm(vancouver, distantVenue);
  const threeRestDaysPenalty = expectedTravelFatiguePenalty(distanceKm, 3);
  const sixRestDaysPenalty = expectedTravelFatiguePenalty(distanceKm, 6);
  const cappedDistancePenalty = expectedTravelFatiguePenalty(cappedDistanceKm, 0);

  assert.ok(distanceKm < TRAVEL_FATIGUE_DISTANCE_CAP_KM);
  assert.ok(cappedDistanceKm > TRAVEL_FATIGUE_DISTANCE_CAP_KM);
  assert.equal(TRAVEL_FATIGUE_DISTANCE_REFERENCE_KM, 2500);
  assert.equal(TRAVEL_FATIGUE_DISTANCE_CAP_KM, 5000);
  assert.equal(TRAVEL_FATIGUE_REST_DECAY_RATE, 0.2);
  assert.equal(TRAVEL_FATIGUE_ELO_PENALTY, -30);
  assertAlmostEqual(
    calculateTravelFatigueAdjustment(
      { lastVenue: "Vancouver", lastMatchDate: "2026-06-27" },
      miami,
      "2026-07-01"
    ),
    threeRestDaysPenalty
  );
  assertAlmostEqual(
    calculateTravelFatigueAdjustment(
      { lastVenue: "Vancouver", lastMatchDate: "2026-06-27" },
      miami,
      "2026-07-04"
    ),
    sixRestDaysPenalty
  );
  assert.ok(Math.abs(sixRestDaysPenalty) < Math.abs(threeRestDaysPenalty));
  assertAlmostEqual(
    calculateTravelFatigueAdjustment(
      { lastVenue: "Vancouver", lastMatchDate: "2026-06-27" },
      distantVenue,
      "2026-06-28"
    ),
    cappedDistancePenalty
  );
  assertAlmostEqual(
    cappedDistancePenalty,
    TRAVEL_FATIGUE_ELO_PENALTY * (TRAVEL_FATIGUE_DISTANCE_CAP_KM / TRAVEL_FATIGUE_DISTANCE_REFERENCE_KM)
  );
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

test("drawn knockout matches can be resolved by extra-time goals for either team", () => {
  const modelConfig = { variant: "elo-poisson" as const, maxGoals: 5 };
  const alpha = team("Alpha");
  const bravo = team("Bravo");
  const fullTimePrediction = predictMatch({
    ratingA: 1700,
    ratingB: 1500,
    modelConfig,
  });
  const extraTimeMatrix = buildScoreProbabilityMatrix(fullTimePrediction.xgA / 3, fullTimePrediction.xgB / 3, {
    maxGoals: modelConfig.maxGoals,
  });
  const fullTimeDraw = randomValueForScore(fullTimePrediction.scoreMatrix, 0, 0);
  const extraTimeAlphaGoal = randomValueForScore(extraTimeMatrix, 1, 0);
  const extraTimeBravoGoal = randomValueForScore(extraTimeMatrix, 0, 1);

  assert.equal(
    simulateKnockout(
      alpha,
      bravo,
      1700,
      1500,
      [],
      undefined,
      "R32",
      sequenceRng([fullTimeDraw, extraTimeAlphaGoal]),
      modelConfig
    ),
    true
  );
  assert.equal(
    simulateKnockout(
      alpha,
      bravo,
      1700,
      1500,
      [],
      undefined,
      "R32",
      sequenceRng([fullTimeDraw, extraTimeBravoGoal]),
      modelConfig
    ),
    false
  );
});

test("drawn knockout matches use Elo-biased penalty shootouts after extra time", () => {
  const modelConfig = { variant: "elo-poisson" as const, maxGoals: 5 };
  const alpha = team("Alpha");
  const bravo = team("Bravo");
  const eloA = 1800;
  const eloB = 1600;
  const fullTimePrediction = predictMatch({
    ratingA: eloA,
    ratingB: eloB,
    modelConfig,
  });
  const extraTimeMatrix = buildScoreProbabilityMatrix(fullTimePrediction.xgA / 3, fullTimePrediction.xgB / 3, {
    maxGoals: modelConfig.maxGoals,
  });
  const fullTimeDraw = randomValueForScore(fullTimePrediction.scoreMatrix, 0, 0);
  const extraTimeDraw = randomValueForScore(extraTimeMatrix, 0, 0);
  const penaltyDraw = 0.55;
  const shootoutWinProbabilityA = 1 / (1 + 10 ** ((eloB - eloA) / 800));

  assert.ok(penaltyDraw > 0.5);
  assert.ok(penaltyDraw < shootoutWinProbabilityA);
  assert.equal(
    simulateKnockout(
      alpha,
      bravo,
      eloA,
      eloB,
      [],
      undefined,
      "R32",
      sequenceRng([fullTimeDraw, extraTimeDraw, penaltyDraw]),
      modelConfig
    ),
    true
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
