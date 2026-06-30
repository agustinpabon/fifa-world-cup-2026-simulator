import { WC2026_GROUPS, WC2026_TEAMS, type WCGroup, type WCTeam } from "./worldcup2026.js";
import { type EloRatings, type TeamMetrics, HOST_BOOST } from "./elo.js";
import {
  buildMatchesFromPreviousWinners,
  buildRoundOf32Matches,
  FINAL_MATCHES,
  GROUP_IDS,
  QUARTER_FINAL_MATCHES,
  ROUND_OF_16_MATCHES,
  SEMI_FINAL_MATCHES,
  type GroupId,
  type KnockoutMatch,
} from "./tournament-format.js";

export const NUM_SIMULATIONS = 10_000;
export const DEFAULT_SIMULATION_SEED = "world-cup-oracle-simulation-v1";
const BASE_XG = 1.25; // average goals per team per game
const ELO_SCALE = 400; // Elo scale factor
const DIXON_COLES_RHO = -0.06;
const SCORE_MATRIX_MAX_GOALS = 10; // Exact match predictions normalize the truncated 0..10 score grid.

export type Rng = () => number;
export type SimulationSeed = string | number;

export interface RandomSourceOptions {
  random?: Rng;
  seed?: SimulationSeed;
}

export interface SimulationOptions extends RandomSourceOptions {
  simulationsRun?: number;
}

// ---------- Dixon-Coles & Math helpers ----------

function poissonSample(lambda: number, random: Rng): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= random();
  } while (p > L);
  return k - 1;
}

function poissonProbability(lambda: number, goals: number): number {
  if (goals < 0 || !Number.isInteger(goals)) return 0;
  if (lambda <= 0) return goals === 0 ? 1 : 0;

  let probability = Math.exp(-lambda);
  for (let index = 1; index <= goals; index++) {
    probability *= lambda / index;
  }

  return probability;
}

function dixonColesAdjustment(
  lambda: number,
  mu: number,
  goalsA: number,
  goalsB: number,
  rho = DIXON_COLES_RHO
): number {
  if (goalsA === 0 && goalsB === 0) return 1.0 - lambda * mu * rho;
  if (goalsA === 1 && goalsB === 0) return 1.0 + mu * rho;
  if (goalsA === 0 && goalsB === 1) return 1.0 + lambda * rho;
  if (goalsA === 1 && goalsB === 1) return 1.0 - rho;

  return 1.0;
}

function dixonColesAcceptanceWeight(
  lambda: number,
  mu: number,
  goalsA: number,
  goalsB: number,
  rho = DIXON_COLES_RHO
): number {
  return Math.max(0, Math.min(1, dixonColesAdjustment(lambda, mu, goalsA, goalsB, rho)));
}

// Dixon-Coles score sampling adjusting low-score draws (0-0, 1-1, 1-0, 0-1)
function dixonColesSample(
  lambda: number,
  mu: number,
  random: Rng,
  rho = DIXON_COLES_RHO
): { goalsA: number; goalsB: number } {
  for (let attempt = 0; attempt < 50; attempt++) {
    const ga = poissonSample(lambda, random);
    const gb = poissonSample(mu, random);

    const tau = dixonColesAcceptanceWeight(lambda, mu, ga, gb, rho);

    if (random() < tau) {
      return { goalsA: ga, goalsB: gb };
    }
  }
  return { goalsA: poissonSample(lambda, random), goalsB: poissonSample(mu, random) };
}

function expectedGoals(
  eloA: number,
  eloB: number,
  metricsA?: TeamMetrics,
  metricsB?: TeamMetrics,
  isHomeA = false,
  isHomeB = false
): { xgA: number; xgB: number } {
  const effectiveEloA = eloA + (isHomeA ? HOST_BOOST : 0);
  const effectiveEloB = eloB + (isHomeB ? HOST_BOOST : 0);

  const diff = (effectiveEloA - effectiveEloB) / ELO_SCALE;
  const mult = Math.pow(10, diff);
  const ratio = Math.min(Math.max(Math.sqrt(mult), 0.15), 6.5);
  const total = BASE_XG * 2;
  let xgA = (total * ratio) / (1 + ratio);
  let xgB = total - xgA;

  if (metricsA && metricsB) {
    xgA = xgA * metricsA.attackStrength * metricsB.defenseStrength;
    xgB = xgB * metricsB.attackStrength * metricsA.defenseStrength;
  }

  return { xgA: Math.max(0.05, xgA), xgB: Math.max(0.05, xgB) };
}

interface ScoreProbability {
  goalsA: number;
  goalsB: number;
  probability: number;
}

function buildScoreProbabilityMatrix(lambda: number, mu: number): ScoreProbability[] {
  const rawCells: ScoreProbability[] = [];
  let rawMass = 0;

  for (let goalsA = 0; goalsA <= SCORE_MATRIX_MAX_GOALS; goalsA++) {
    const probabilityA = poissonProbability(lambda, goalsA);

    for (let goalsB = 0; goalsB <= SCORE_MATRIX_MAX_GOALS; goalsB++) {
      const rawProbability =
        probabilityA *
        poissonProbability(mu, goalsB) *
        dixonColesAcceptanceWeight(lambda, mu, goalsA, goalsB);
      rawCells.push({ goalsA, goalsB, probability: rawProbability });
      rawMass += rawProbability;
    }
  }

  if (rawMass <= 0) {
    throw new Error("Score probability matrix has no probability mass");
  }

  return rawCells.map((cell) => ({
    ...cell,
    probability: cell.probability / rawMass,
  }));
}

export interface PlayedMatch {
  matchNumber?: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  stage?: string;
  source?: "fixture" | "official" | "custom";
  sourceId?: string;
  date?: string;
  kickoffTimeEt?: string;
  status?: "scheduled" | "live" | "finished";
  group?: string;
  venue?: string;
  region?: string;
}

function simulateMatch(
  eloA: number,
  eloB: number,
  playedMatch?: PlayedMatch,
  metricsA?: TeamMetrics,
  metricsB?: TeamMetrics,
  isHomeA = false,
  isHomeB = false,
  random: Rng = createSeededRng(DEFAULT_SIMULATION_SEED)
): { goalsA: number; goalsB: number } {
  if (playedMatch) {
    return { goalsA: playedMatch.homeScore, goalsB: playedMatch.awayScore };
  }
  const { xgA, xgB } = expectedGoals(eloA, eloB, metricsA, metricsB, isHomeA, isHomeB);
  return dixonColesSample(xgA, xgB, random);
}

// Win/draw/loss probabilities from a normalized exact score matrix.
// The trials and random options arguments are kept for compatibility with older callers.
export function matchProbabilities(
  eloA: number,
  eloB: number,
  _trials?: number,
  metricsA?: TeamMetrics,
  metricsB?: TeamMetrics,
  isHomeA = false,
  isHomeB = false,
  _options: RandomSourceOptions = {}
): { pWinA: number; pDraw: number; pWinB: number; xgA: number; xgB: number; mostLikelyScore: string } {
  const { xgA, xgB } = expectedGoals(eloA, eloB, metricsA, metricsB, isHomeA, isHomeB);
  const matrix = buildScoreProbabilityMatrix(xgA, xgB);
  let pWinA = 0;
  let pDraw = 0;
  let pWinB = 0;
  let matrixXgA = 0;
  let matrixXgB = 0;
  let mostLikelyCell = matrix[0];

  for (const cell of matrix) {
    matrixXgA += cell.goalsA * cell.probability;
    matrixXgB += cell.goalsB * cell.probability;

    if (cell.goalsA > cell.goalsB) {
      pWinA += cell.probability;
    } else if (cell.goalsA < cell.goalsB) {
      pWinB += cell.probability;
    } else {
      pDraw += cell.probability;
    }

    if (cell.probability > mostLikelyCell.probability) {
      mostLikelyCell = cell;
    }
  }

  return {
    pWinA,
    pDraw,
    pWinB,
    xgA: Math.round(matrixXgA * 100) / 100,
    xgB: Math.round(matrixXgB * 100) / 100,
    mostLikelyScore: `${mostLikelyCell.goalsA}-${mostLikelyCell.goalsB}`,
  };
}

// ---------- Group stage ----------

export interface GroupStanding {
  team: WCTeam;
  elo: number;
  points: number;
  gf: number;
  ga: number;
  gd: number;
}

export interface GroupMatchScore {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

interface FifaRankingOptions extends RandomSourceOptions {
  fallbackSeed?: string;
}

interface HeadToHeadMetrics {
  points: number;
  gf: number;
  ga: number;
  gd: number;
}

const DEFAULT_TIEBREAKER_SEED = "world-cup-oracle-2026-fifa-tiebreakers-v1";

export const FIFA_TIEBREAKER_MODEL_NOTES = [
  "Implemented for same-group ranking: points, head-to-head points, head-to-head goal difference, head-to-head goals scored, overall goal difference, and overall goals scored.",
  "Implemented for ranking third-place teams: points, overall goal difference, and overall goals scored.",
  "Not modeled: FIFA team conduct score and most recent FIFA Men's World Ranking. Remaining ties use a seeded random fallback; Elo is never used as an official tiebreaker.",
] as const;

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRng(seed: string | number): Rng {
  let state = hashSeed(String(seed)) || 0x6d2b79f5;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createRandomSource(options: RandomSourceOptions, defaultSeed: SimulationSeed): Rng {
  return options.random ?? createSeededRng(options.seed ?? defaultSeed);
}

function getSimulationCount(options: SimulationOptions): number {
  const simulationsRun = options.simulationsRun ?? NUM_SIMULATIONS;

  if (!Number.isInteger(simulationsRun) || simulationsRun <= 0) {
    throw new Error("simulationsRun must be a positive integer");
  }

  return simulationsRun;
}

function byTeamName(a: GroupStanding, b: GroupStanding): number {
  return a.team.name.localeCompare(b.team.name);
}

function getFallbackSeed(standings: readonly GroupStanding[], options: FifaRankingOptions, context: string): string {
  const standingKey = [...standings]
    .sort(byTeamName)
    .map((standing) => `${standing.team.name}:${standing.points}:${standing.gd}:${standing.gf}:${standing.ga}`)
    .join("|");
  return `${options.fallbackSeed ?? DEFAULT_TIEBREAKER_SEED}:${context}:${standingKey}`;
}

function drawSeededOrder(
  standings: readonly GroupStanding[],
  options: FifaRankingOptions,
  context: string
): GroupStanding[] {
  const rng = options.random ?? createSeededRng(getFallbackSeed(standings, options, context));
  const drawsByTeam = new Map<string, number>();

  for (const standing of [...standings].sort(byTeamName)) {
    drawsByTeam.set(standing.team.name, rng());
  }

  return [...standings].sort((a, b) => {
    const drawDiff = (drawsByTeam.get(a.team.name) ?? 0) - (drawsByTeam.get(b.team.name) ?? 0);
    if (drawDiff !== 0) return drawDiff;
    return byTeamName(a, b);
  });
}

function groupByCriterion(
  standings: readonly GroupStanding[],
  valueForStanding: (standing: GroupStanding) => number
): GroupStanding[][] {
  const groupsByValue = new Map<number, GroupStanding[]>();

  for (const standing of standings) {
    const value = valueForStanding(standing);
    groupsByValue.set(value, [...(groupsByValue.get(value) ?? []), standing]);
  }

  return [...groupsByValue.entries()]
    .sort(([valueA], [valueB]) => valueB - valueA)
    .map(([, group]) => [...group]);
}

function buildHeadToHeadMetrics(
  standings: readonly GroupStanding[],
  matches: readonly GroupMatchScore[]
): Map<string, HeadToHeadMetrics> {
  const teamNames = new Set(standings.map((standing) => standing.team.name));
  const metrics = new Map<string, HeadToHeadMetrics>(
    standings.map((standing) => [standing.team.name, { points: 0, gf: 0, ga: 0, gd: 0 }])
  );

  for (const match of matches) {
    if (!teamNames.has(match.homeTeam) || !teamNames.has(match.awayTeam)) {
      continue;
    }

    const home = metrics.get(match.homeTeam);
    const away = metrics.get(match.awayTeam);
    if (!home || !away) continue;

    home.gf += match.homeScore;
    home.ga += match.awayScore;
    away.gf += match.awayScore;
    away.ga += match.homeScore;
    home.gd = home.gf - home.ga;
    away.gd = away.gf - away.ga;

    if (match.homeScore > match.awayScore) {
      home.points += 3;
    } else if (match.awayScore > match.homeScore) {
      away.points += 3;
    } else {
      home.points += 1;
      away.points += 1;
    }
  }

  return metrics;
}

function rankByHeadToHeadBuckets(
  standings: readonly GroupStanding[],
  matches: readonly GroupMatchScore[]
): GroupStanding[][] {
  if (standings.length <= 1) {
    return [[...standings]];
  }

  const metrics = buildHeadToHeadMetrics(standings, matches);
  const criteria: Array<(standing: GroupStanding) => number> = [
    (standing) => metrics.get(standing.team.name)?.points ?? 0,
    (standing) => metrics.get(standing.team.name)?.gd ?? 0,
    (standing) => metrics.get(standing.team.name)?.gf ?? 0,
  ];

  for (const criterion of criteria) {
    const buckets = groupByCriterion(standings, criterion);
    if (buckets.length > 1) {
      return buckets.flatMap((bucket) =>
        bucket.length === 1 ? [bucket] : rankByHeadToHeadBuckets(bucket, matches)
      );
    }
  }

  return [[...standings]];
}

function rankByOverallCriteria(
  standings: readonly GroupStanding[],
  options: FifaRankingOptions,
  context: string
): GroupStanding[] {
  const criteria: Array<(standing: GroupStanding) => number> = [
    (standing) => standing.gd,
    (standing) => standing.gf,
  ];

  let buckets: GroupStanding[][] = [[...standings]];

  for (const criterion of criteria) {
    buckets = buckets.flatMap((bucket) => (bucket.length === 1 ? [bucket] : groupByCriterion(bucket, criterion)));
  }

  return buckets.flatMap((bucket, index) =>
    bucket.length === 1 ? bucket : drawSeededOrder(bucket, options, `${context}:unmodeled:${index}`)
  );
}

export function rankGroupStandingsByFifaCriteria(
  standings: readonly GroupStanding[],
  matches: readonly GroupMatchScore[],
  options: FifaRankingOptions = {}
): GroupStanding[] {
  const pointBuckets = groupByCriterion(standings, (standing) => standing.points);

  return pointBuckets.flatMap((bucket, index) => {
    if (bucket.length === 1) return bucket;

    const headToHeadBuckets = rankByHeadToHeadBuckets(bucket, matches);
    return headToHeadBuckets.flatMap((headToHeadBucket, headToHeadIndex) =>
      headToHeadBucket.length === 1
        ? headToHeadBucket
        : rankByOverallCriteria(headToHeadBucket, options, `group:${index}:head-to-head:${headToHeadIndex}`)
    );
  });
}

export function rankThirdPlacedTeamsByFifaCriteria(
  standings: readonly GroupStanding[],
  options: FifaRankingOptions = {}
): GroupStanding[] {
  return groupByCriterion(standings, (standing) => standing.points).flatMap((bucket, index) =>
    bucket.length === 1 ? bucket : rankByOverallCriteria(bucket, options, `third-place:${index}`)
  );
}

function simulateGroup(
  group: WCGroup,
  ratings: EloRatings,
  playedMatches: PlayedMatch[] = [],
  teamMetrics?: Record<string, TeamMetrics>,
  rankingOptions: FifaRankingOptions = {}
): GroupStanding[] {
  const standings: GroupStanding[] = group.teams.map((t) => ({
    team: t,
    elo: ratings[t.name] ?? 1000,
    points: 0,
    gf: 0,
    ga: 0,
    gd: 0,
  }));
  const standingsByName = new Map(standings.map((standing) => [standing.team.name, standing]));
  const groupMatchScores: GroupMatchScore[] = [];
  const random = rankingOptions.random ?? createSeededRng(`${DEFAULT_SIMULATION_SEED}:group:${group.id}`);

  for (const fixture of group.fixtures) {
    const home = standingsByName.get(fixture.homeTeam);
    const away = standingsByName.get(fixture.awayTeam);
    if (!home || !away) {
      throw new Error(`Fixture ${fixture.matchNumber} references teams outside Group ${group.id}`);
    }

    const played = playedMatches.find(
      (m) =>
        (m.homeTeam === fixture.homeTeam && m.awayTeam === fixture.awayTeam) ||
        (m.homeTeam === fixture.awayTeam && m.awayTeam === fixture.homeTeam)
    );

    let goalsHome: number;
    let goalsAway: number;

    if (played) {
      if (played.homeTeam === fixture.homeTeam) {
        goalsHome = played.homeScore;
        goalsAway = played.awayScore;
      } else {
        goalsHome = played.awayScore;
        goalsAway = played.homeScore;
      }
    } else {
      const { isHomeA, isHomeB } = getHomeStatus(home.team.name, away.team.name, "group");
      const sim = simulateMatch(
        home.elo,
        away.elo,
        undefined,
        teamMetrics?.[home.team.name],
        teamMetrics?.[away.team.name],
        isHomeA,
        isHomeB,
        random
      );
      goalsHome = sim.goalsA;
      goalsAway = sim.goalsB;
    }

    home.gf += goalsHome;
    home.ga += goalsAway;
    away.gf += goalsAway;
    away.ga += goalsHome;
    home.gd = home.gf - home.ga;
    away.gd = away.gf - away.ga;

    groupMatchScores.push({
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      homeScore: goalsHome,
      awayScore: goalsAway,
    });

    if (goalsHome > goalsAway) {
      home.points += 3;
    } else if (goalsAway > goalsHome) {
      away.points += 3;
    } else {
      home.points += 1;
      away.points += 1;
    }
  }

  return rankGroupStandingsByFifaCriteria(standings, groupMatchScores, rankingOptions);
}

// ---------- Knockout ----------

function simulateKnockout(
  a: WCTeam,
  b: WCTeam,
  eloA: number,
  eloB: number,
  playedMatches: PlayedMatch[] = [],
  teamMetrics?: Record<string, TeamMetrics>,
  stage: "R32" | "R16" | "QF" | "SF" | "F" = "R32",
  random: Rng = createSeededRng(DEFAULT_SIMULATION_SEED)
): boolean {
  const played = playedMatches.find(
    (m) =>
      (m.homeTeam === a.name && m.awayTeam === b.name) ||
      (m.homeTeam === b.name && m.awayTeam === a.name)
  );

  if (played) {
    if (played.homeTeam === a.name) {
      if (played.homeScore > played.awayScore) return true;
      if (played.awayScore > played.homeScore) return false;
    } else {
      if (played.awayScore > played.homeScore) return true;
      if (played.homeScore > played.awayScore) return false;
    }
  }

  const metricsA = teamMetrics?.[a.name];
  const metricsB = teamMetrics?.[b.name];
  const { isHomeA, isHomeB } = getHomeStatus(a.name, b.name, stage);
  const { goalsA, goalsB } = simulateMatch(eloA, eloB, undefined, metricsA, metricsB, isHomeA, isHomeB, random);
  if (goalsA > goalsB) return true;
  if (goalsB > goalsA) return false;
  const penEdge = Math.min(0.6, 0.5 + (eloA - eloB) / 2000);
  return random() < penEdge;
}

function simulateKnockoutRound(
  matches: readonly KnockoutMatch[],
  ratings: EloRatings,
  playedMatches: PlayedMatch[] = [],
  teamMetrics?: Record<string, TeamMetrics>,
  random: Rng = createSeededRng(DEFAULT_SIMULATION_SEED)
): Map<number, WCTeam> {
  const winners = new Map<number, WCTeam>();

  for (const match of matches) {
    const aWins = simulateKnockout(
      match.home,
      match.away,
      ratings[match.home.name] ?? 1000,
      ratings[match.away.name] ?? 1000,
      playedMatches,
      teamMetrics,
      match.stage,
      random
    );
    winners.set(match.matchNumber, aWins ? match.home : match.away);
  }

  return winners;
}

function assertCompleteGroupMap(
  teamsByGroup: Partial<Record<GroupId, WCTeam>>,
  label: string
): asserts teamsByGroup is Record<GroupId, WCTeam> {
  const missingGroups = GROUP_IDS.filter((group) => !teamsByGroup[group]);
  if (missingGroups.length > 0) {
    throw new Error(`${label} missing groups: ${missingGroups.join(", ")}`);
  }
}

// ---------- Full tournament ----------

export interface SimResult {
  titles: Record<string, number>;
  finals: Record<string, number>;
  semiFinals: Record<string, number>;
  quarterFinals: Record<string, number>;
  roundOf16: Record<string, number>;
  groupWins: Record<string, number>;
  groupAdvances: Record<string, number>;
}

export interface PublishedSimulationResult {
  name: string;
  code: string;
  group: string;
  flagEmoji: string;
  elo: number;
  titlePct: number;
  finalPct: number;
  semiFinalPct: number;
  quarterFinalPct: number;
  roundOf16Pct: number;
  groupWinPct: number;
  groupAdvancePct: number;
  uncertainty: PublishedSimulationUncertainty;
}

export interface ProbabilityUncertainty {
  standardErrorPct: number;
  confidenceIntervalLowPct: number;
  confidenceIntervalHighPct: number;
}

export interface PublishedSimulationUncertainty {
  titlePct: ProbabilityUncertainty;
  finalPct: ProbabilityUncertainty;
  semiFinalPct: ProbabilityUncertainty;
  quarterFinalPct: ProbabilityUncertainty;
  roundOf16Pct: ProbabilityUncertainty;
  groupWinPct: ProbabilityUncertainty;
  groupAdvancePct: ProbabilityUncertainty;
}

export interface SimulationUncertaintyMetadata {
  method: "binomial_standard_error";
  confidenceLevel: number;
  zScore: number;
  maxStandardErrorPct: number;
  description: string;
}

function toPercent(count: number | undefined, simulationsRun: number): number {
  if (simulationsRun <= 0) {
    return 0;
  }

  return Math.round(((count ?? 0) / simulationsRun) * 1000) / 10;
}

const SIMULATION_CONFIDENCE_LEVEL = 0.95;
const SIMULATION_Z_SCORE = 1.96;

function roundProbabilityPct(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampProbabilityPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function calculateProbabilityUncertainty(
  probabilityPct: number,
  simulationsRun: number,
  zScore = SIMULATION_Z_SCORE
): ProbabilityUncertainty {
  const boundedProbabilityPct = clampProbabilityPct(probabilityPct);

  if (simulationsRun <= 0) {
    return {
      standardErrorPct: 0,
      confidenceIntervalLowPct: roundProbabilityPct(boundedProbabilityPct),
      confidenceIntervalHighPct: roundProbabilityPct(boundedProbabilityPct),
    };
  }

  const probability = boundedProbabilityPct / 100;
  const standardErrorPct = Math.sqrt((probability * (1 - probability)) / simulationsRun) * 100;
  const marginPct = zScore * standardErrorPct;

  return {
    standardErrorPct: roundProbabilityPct(standardErrorPct),
    confidenceIntervalLowPct: roundProbabilityPct(clampProbabilityPct(boundedProbabilityPct - marginPct)),
    confidenceIntervalHighPct: roundProbabilityPct(clampProbabilityPct(boundedProbabilityPct + marginPct)),
  };
}

export function getSimulationUncertaintyMetadata(simulationsRun: number): SimulationUncertaintyMetadata {
  const maxStandardErrorPct = simulationsRun > 0 ? Math.sqrt(0.25 / simulationsRun) * 100 : 0;

  return {
    method: "binomial_standard_error",
    confidenceLevel: SIMULATION_CONFIDENCE_LEVEL,
    zScore: SIMULATION_Z_SCORE,
    maxStandardErrorPct: roundProbabilityPct(maxStandardErrorPct),
    description:
      "Monte Carlo uncertainty is estimated as binomial standard error for each displayed probability.",
  };
}

function toProbabilityUncertainty(
  count: number | undefined,
  simulationsRun: number
): ProbabilityUncertainty {
  return calculateProbabilityUncertainty(toPercent(count, simulationsRun), simulationsRun);
}

export function toPublishedSimulationResults(
  simResult: SimResult,
  ratings: EloRatings = {},
  simulationsRun = NUM_SIMULATIONS
): PublishedSimulationResult[] {
  const { titles, finals, semiFinals, quarterFinals, roundOf16, groupWins, groupAdvances } = simResult;

  return WC2026_TEAMS.map((team) => ({
    name: team.name,
    code: team.code,
    group: team.group,
    flagEmoji: team.flagEmoji,
    elo: ratings[team.name] ?? 1000,
    titlePct: toPercent(titles[team.name], simulationsRun),
    finalPct: toPercent(finals[team.name], simulationsRun),
    semiFinalPct: toPercent(semiFinals[team.name], simulationsRun),
    quarterFinalPct: toPercent(quarterFinals[team.name], simulationsRun),
    roundOf16Pct: toPercent(roundOf16[team.name], simulationsRun),
    groupWinPct: toPercent(groupWins[team.name], simulationsRun),
    groupAdvancePct: toPercent(groupAdvances[team.name], simulationsRun),
    uncertainty: {
      titlePct: toProbabilityUncertainty(titles[team.name], simulationsRun),
      finalPct: toProbabilityUncertainty(finals[team.name], simulationsRun),
      semiFinalPct: toProbabilityUncertainty(semiFinals[team.name], simulationsRun),
      quarterFinalPct: toProbabilityUncertainty(quarterFinals[team.name], simulationsRun),
      roundOf16Pct: toProbabilityUncertainty(roundOf16[team.name], simulationsRun),
      groupWinPct: toProbabilityUncertainty(groupWins[team.name], simulationsRun),
      groupAdvancePct: toProbabilityUncertainty(groupAdvances[team.name], simulationsRun),
    },
  })).sort((a, b) => b.titlePct - a.titlePct);
}

export function runSimulations(
  ratings: EloRatings,
  playedMatches: PlayedMatch[] = [],
  teamMetrics?: Record<string, TeamMetrics>,
  options: SimulationOptions = {}
): SimResult {
  const simulationsRun = getSimulationCount(options);
  const random = createRandomSource(options, DEFAULT_SIMULATION_SEED);
  const result: SimResult = {
    titles: {},
    finals: {},
    semiFinals: {},
    quarterFinals: {},
    roundOf16: {},
    groupWins: {},
    groupAdvances: {},
  };

  const allNames = WC2026_TEAMS.map((t) => t.name);
  for (const n of allNames) {
    result.titles[n] = 0;
    result.finals[n] = 0;
    result.semiFinals[n] = 0;
    result.quarterFinals[n] = 0;
    result.roundOf16[n] = 0;
    result.groupWins[n] = 0;
    result.groupAdvances[n] = 0;
  }

  for (let sim = 0; sim < simulationsRun; sim++) {
    // Group stage: all 12 groups
    const groupResults: GroupStanding[][] = [];
    const groupWinnersMap: Partial<Record<GroupId, WCTeam>> = {};
    const groupRunnersMap: Partial<Record<GroupId, WCTeam>> = {};

    for (const group of WC2026_GROUPS) {
      const standings = simulateGroup(group, ratings, playedMatches, teamMetrics, {
        random,
        fallbackSeed: `${DEFAULT_TIEBREAKER_SEED}:simulation:${sim}:group:${group.id}`,
      });
      groupResults.push(standings);
      groupWinnersMap[group.id] = standings[0].team;
      groupRunnersMap[group.id] = standings[1].team;
    }

    const thirdPlacers: GroupStanding[] = [];

    for (const standings of groupResults) {
      const winner = standings[0];
      const second = standings[1];
      const third = standings[2];
      result.groupWins[winner.team.name]++;
      result.groupAdvances[winner.team.name]++;
      result.groupAdvances[second.team.name]++;
      thirdPlacers.push(third);
    }

    const best8thirds = rankThirdPlacedTeamsByFifaCriteria(thirdPlacers, {
      random,
      fallbackSeed: `${DEFAULT_TIEBREAKER_SEED}:simulation:${sim}:third-place`,
    }).slice(0, 8);
    for (const t of best8thirds) {
      result.groupAdvances[t.team.name]++;
    }

    assertCompleteGroupMap(groupWinnersMap, "Group winners");
    assertCompleteGroupMap(groupRunnersMap, "Group runners-up");

    const thirdPlaceTeamsByGroup = Object.fromEntries(
      best8thirds.map((standing) => [standing.team.group, standing.team])
    ) as Partial<Record<GroupId, WCTeam>>;

    const r32Matches = buildRoundOf32Matches(groupWinnersMap, groupRunnersMap, thirdPlaceTeamsByGroup);
    const r32Winners = simulateKnockoutRound(r32Matches, ratings, playedMatches, teamMetrics, random);
    for (const team of r32Winners.values()) result.roundOf16[team.name]++;

    const r16Matches = buildMatchesFromPreviousWinners(ROUND_OF_16_MATCHES, r32Winners);
    const r16Winners = simulateKnockoutRound(r16Matches, ratings, playedMatches, teamMetrics, random);
    for (const team of r16Winners.values()) result.quarterFinals[team.name]++;

    const quarterFinalMatches = buildMatchesFromPreviousWinners(QUARTER_FINAL_MATCHES, r16Winners);
    const quarterFinalWinners = simulateKnockoutRound(quarterFinalMatches, ratings, playedMatches, teamMetrics, random);
    for (const team of quarterFinalWinners.values()) result.semiFinals[team.name]++;

    const semiFinalMatches = buildMatchesFromPreviousWinners(SEMI_FINAL_MATCHES, quarterFinalWinners);
    const semiFinalWinners = simulateKnockoutRound(semiFinalMatches, ratings, playedMatches, teamMetrics, random);
    for (const team of semiFinalWinners.values()) result.finals[team.name]++;

    const finalMatches = buildMatchesFromPreviousWinners(FINAL_MATCHES, semiFinalWinners);
    const finalWinners = simulateKnockoutRound(finalMatches, ratings, playedMatches, teamMetrics, random);
    const champion = finalWinners.get(FINAL_MATCHES[0].matchNumber);
    if (!champion) {
      throw new Error("Final did not produce a champion");
    }
    result.titles[champion.name]++;
  }

  return result;
}

export function getHomeStatus(
  teamNameA: string,
  teamNameB: string,
  stage: "group" | "R32" | "R16" | "QF" | "SF" | "F" | "neutral"
): { isHomeA: boolean; isHomeB: boolean } {
  let isHomeA = false;
  let isHomeB = false;

  if (stage === "group" || stage === "R32" || stage === "R16") {
    // In group stage, R32, and R16, host teams play in their respective countries
    if (teamNameA === "USA" || teamNameA === "Mexico" || teamNameA === "Canada") isHomeA = true;
    if (teamNameB === "USA" || teamNameB === "Mexico" || teamNameB === "Canada") isHomeB = true;
  } else if (stage === "QF" || stage === "SF" || stage === "F") {
    // From QF onwards, all matches are played in the USA, so only USA plays at home
    if (teamNameA === "USA") isHomeA = true;
    if (teamNameB === "USA") isHomeB = true;
  }

  // If both teams are marked as home, make it neutral
  if (isHomeA && isHomeB) {
    isHomeA = false;
    isHomeB = false;
  }

  return { isHomeA, isHomeB };
}
