import {
  WC2026_GROUPS,
  WC2026_TEAMS,
  getHostVenueByName,
  type WCHostVenue,
  type WCGroup,
  type WCTeam,
} from "./worldcup2026.js";
import {
  DEFAULT_MODEL_CONFIG,
  createModelConfig,
  predictMatch,
  sampleMatchScore,
  type MatchPrediction,
  type ModelConfig,
} from "@workspace/oracle-model";
import { type EloRatings, type TeamMetrics } from "./elo.js";
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
export const HIGH_ALTITUDE_THRESHOLD_METERS = 1200;
export const ALTITUDE_ELO_PENALTY = -50;
export const ACCLIMATIZATION_REST_DAYS = 5;

export type Rng = () => number;
export type SimulationSeed = string | number;

export interface RandomSourceOptions {
  random?: Rng;
  seed?: SimulationSeed;
}

export interface SimulationOptions extends RandomSourceOptions {
  simulationsRun?: number;
  modelConfig?: Partial<ModelConfig>;
}

export interface PlayedMatch {
  matchNumber?: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  stage?: string;
  source?: "fixture" | "official" | "espn" | "custom";
  sourceId?: string;
  date?: string;
  kickoffTimeEt?: string;
  status?: "scheduled" | "live" | "finished";
  statusDetail?: string;
  group?: string;
  venue?: string;
  region?: string;
  winnerTeam?: string;
}

export interface TeamTravelState {
  lastVenue: string;
  lastMatchDate: string;
}

export interface MatchContextRatingInput {
  ratingA: number;
  ratingB: number;
  teamNameA?: string;
  teamNameB?: string;
  venue?: string;
  matchDate?: string;
  travelStateA?: TeamTravelState;
  travelStateB?: TeamTravelState;
  acclimatizationDaysA?: number;
  acclimatizationDaysB?: number;
}

export interface MatchContextRatingAdjustments {
  altitude: number;
}

export interface MatchContextRatingResult {
  ratingA: number;
  ratingB: number;
  adjustmentsA: MatchContextRatingAdjustments;
  adjustmentsB: MatchContextRatingAdjustments;
}

export type MatchPredictionContext = Omit<MatchContextRatingInput, "ratingA" | "ratingB">;

function parseUtcDate(date: string): number | null {
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);

  return Number.isNaN(timestamp) ? null : timestamp;
}

function calculateRestDaysSinceLastMatch(previousDate: string, matchDate: string): number | null {
  const previousTimestamp = parseUtcDate(previousDate);
  const matchTimestamp = parseUtcDate(matchDate);

  if (previousTimestamp === null || matchTimestamp === null) {
    return null;
  }

  const daysBetween = Math.floor((matchTimestamp - previousTimestamp) / 86_400_000);

  return Math.max(0, daysBetween - 1);
}

function isHighAltitudeVenue(venue: WCHostVenue): boolean {
  return venue.altitudeMeters > HIGH_ALTITUDE_THRESHOLD_METERS;
}

function isHighAltitudeHomeNation(teamName: string | undefined, venue: WCHostVenue): boolean {
  return teamName === "Mexico" && venue.country === "Mexico" && isHighAltitudeVenue(venue);
}

function hasSufficientAltitudeAcclimatization(
  venue: WCHostVenue,
  matchDate: string | undefined,
  travelState: TeamTravelState | undefined,
  acclimatizationDays: number | undefined
): boolean {
  if (!isHighAltitudeVenue(venue)) {
    return true;
  }

  if (acclimatizationDays !== undefined) {
    return acclimatizationDays >= ACCLIMATIZATION_REST_DAYS;
  }

  if (!matchDate || !travelState) {
    return false;
  }

  const lastVenue = getHostVenueByName(travelState.lastVenue);
  const restDays = calculateRestDaysSinceLastMatch(travelState.lastMatchDate, matchDate);

  return Boolean(lastVenue && isHighAltitudeVenue(lastVenue) && restDays !== null && restDays >= ACCLIMATIZATION_REST_DAYS);
}

export function calculateAltitudeEloAdjustment(
  teamName: string | undefined,
  venue: WCHostVenue,
  options: {
    matchDate?: string;
    travelState?: TeamTravelState;
    acclimatizationDays?: number;
  } = {}
): number {
  if (!isHighAltitudeVenue(venue)) {
    return 0;
  }

  if (isHighAltitudeHomeNation(teamName, venue)) {
    return 0;
  }

  if (
    hasSufficientAltitudeAcclimatization(
      venue,
      options.matchDate,
      options.travelState,
      options.acclimatizationDays
    )
  ) {
    return 0;
  }

  return ALTITUDE_ELO_PENALTY;
}

export function applyMatchContextRatingAdjustments(input: MatchContextRatingInput): MatchContextRatingResult {
  const venue = input.venue ? getHostVenueByName(input.venue) : undefined;
  const altitudeA = venue
    ? calculateAltitudeEloAdjustment(input.teamNameA, venue, {
        matchDate: input.matchDate,
        travelState: input.travelStateA,
        acclimatizationDays: input.acclimatizationDaysA,
      })
    : 0;
  const altitudeB = venue
    ? calculateAltitudeEloAdjustment(input.teamNameB, venue, {
        matchDate: input.matchDate,
        travelState: input.travelStateB,
        acclimatizationDays: input.acclimatizationDaysB,
      })
    : 0;

  return {
    ratingA: input.ratingA + altitudeA,
    ratingB: input.ratingB + altitudeB,
    adjustmentsA: {
      altitude: altitudeA,
    },
    adjustmentsB: {
      altitude: altitudeB,
    },
  };
}

function simulateMatch(
  eloA: number,
  eloB: number,
  playedMatch?: PlayedMatch,
  metricsA?: TeamMetrics,
  metricsB?: TeamMetrics,
  isHomeA = false,
  isHomeB = false,
  random: Rng = createSeededRng(DEFAULT_SIMULATION_SEED),
  modelConfig: Partial<ModelConfig> = DEFAULT_MODEL_CONFIG,
  matchContext: MatchPredictionContext = {}
): { goalsA: number; goalsB: number } {
  if (playedMatch) {
    return { goalsA: playedMatch.homeScore, goalsB: playedMatch.awayScore };
  }

  const adjustedRatings = applyMatchContextRatingAdjustments({
    ratingA: eloA,
    ratingB: eloB,
    ...matchContext,
  });

  return sampleMatchScore(
    {
      ratingA: adjustedRatings.ratingA,
      ratingB: adjustedRatings.ratingB,
      metricsA,
      metricsB,
      neutral: true,
      isHomeA,
      isHomeB,
      modelConfig,
    },
    random
  );
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
  neutral = true,
  _options: RandomSourceOptions = {},
  modelConfig: Partial<ModelConfig> = DEFAULT_MODEL_CONFIG,
  matchContext: MatchPredictionContext = {}
): { pWinA: number; pDraw: number; pWinB: number; xgA: number; xgB: number; mostLikelyScore: string } {
  const adjustedRatings = applyMatchContextRatingAdjustments({
    ratingA: eloA,
    ratingB: eloB,
    ...matchContext,
  });
  const teamBHasNonNeutralHomeAdvantage = neutral === false && isHomeB && !isHomeA;
  const prediction = teamBHasNonNeutralHomeAdvantage
    ? predictMatch({
        ratingA: adjustedRatings.ratingB,
        ratingB: adjustedRatings.ratingA,
        metricsA: metricsB,
        metricsB: metricsA,
        neutral,
        isHomeA: true,
        isHomeB: false,
        modelConfig,
      })
    : predictMatch({
        ratingA: adjustedRatings.ratingA,
        ratingB: adjustedRatings.ratingB,
        metricsA,
        metricsB,
        neutral,
        isHomeA,
        isHomeB,
        modelConfig,
      });

  return teamBHasNonNeutralHomeAdvantage
    ? summarizeMirroredMatchPrediction(prediction)
    : summarizeMatchPrediction(prediction);
}

function summarizeMatchPrediction(
  prediction: MatchPrediction
): { pWinA: number; pDraw: number; pWinB: number; xgA: number; xgB: number; mostLikelyScore: string } {
  return {
    pWinA: prediction.probabilities.pWinA,
    pDraw: prediction.probabilities.pDraw,
    pWinB: prediction.probabilities.pWinB,
    xgA: prediction.xgA,
    xgB: prediction.xgB,
    mostLikelyScore: prediction.mostLikelyScore,
  };
}

function summarizeMirroredMatchPrediction(
  prediction: MatchPrediction
): { pWinA: number; pDraw: number; pWinB: number; xgA: number; xgB: number; mostLikelyScore: string } {
  return {
    pWinA: prediction.probabilities.pWinB,
    pDraw: prediction.probabilities.pDraw,
    pWinB: prediction.probabilities.pWinA,
    xgA: prediction.xgB,
    xgB: prediction.xgA,
    mostLikelyScore: reverseScoreline(prediction.mostLikelyScore),
  };
}

function reverseScoreline(scoreline: string): string {
  const [goalsA, goalsB] = scoreline.split("-");
  return `${goalsB}-${goalsA}`;
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
  rankingOptions: FifaRankingOptions = {},
  modelConfig: Partial<ModelConfig> = DEFAULT_MODEL_CONFIG
): GroupStanding[] {
  const resolvedModelConfig = createModelConfig(modelConfig);
  const standings: GroupStanding[] = group.teams.map((t) => ({
    team: t,
    elo: ratings[t.name] ?? resolvedModelConfig.fallbackRating,
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
      const { isHomeA, isHomeB } = getHomeStatus(home.team.name, away.team.name, "group", fixture.venue);
      const sim = simulateMatch(
        home.elo,
        away.elo,
        undefined,
        teamMetrics?.[home.team.name],
        teamMetrics?.[away.team.name],
        isHomeA,
        isHomeB,
        random,
        resolvedModelConfig,
        {
          teamNameA: home.team.name,
          teamNameB: away.team.name,
          venue: fixture.venue,
          matchDate: fixture.date,
        }
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
  random: Rng = createSeededRng(DEFAULT_SIMULATION_SEED),
  modelConfig: Partial<ModelConfig> = DEFAULT_MODEL_CONFIG
): boolean {
  const played = playedMatches.find(
    (m) =>
      (m.homeTeam === a.name && m.awayTeam === b.name) ||
      (m.homeTeam === b.name && m.awayTeam === a.name)
  );

  if (played) {
    const winner = getPlayedKnockoutWinner(a.name, b.name, played);
    if (winner) return winner === a.name;
  }

  const metricsA = teamMetrics?.[a.name];
  const metricsB = teamMetrics?.[b.name];
  const { isHomeA, isHomeB } = getHomeStatus(a.name, b.name, stage);
  const { goalsA, goalsB } = simulateMatch(
    eloA,
    eloB,
    undefined,
    metricsA,
    metricsB,
    isHomeA,
    isHomeB,
    random,
    modelConfig
  );
  if (goalsA > goalsB) return true;
  if (goalsB > goalsA) return false;
  return random() < 0.5;
}

export function getPlayedKnockoutWinner(
  teamA: string,
  teamB: string,
  played: PlayedMatch
): string | null {
  if (played.winnerTeam === teamA || played.winnerTeam === teamB) {
    return played.winnerTeam;
  }

  if (played.homeTeam === teamA) {
    if (played.homeScore > played.awayScore) return teamA;
    if (played.awayScore > played.homeScore) return teamB;
  } else if (played.homeTeam === teamB) {
    if (played.homeScore > played.awayScore) return teamB;
    if (played.awayScore > played.homeScore) return teamA;
  }

  return null;
}

function simulateKnockoutRound(
  matches: readonly KnockoutMatch[],
  ratings: EloRatings,
  playedMatches: PlayedMatch[] = [],
  teamMetrics?: Record<string, TeamMetrics>,
  random: Rng = createSeededRng(DEFAULT_SIMULATION_SEED),
  modelConfig: Partial<ModelConfig> = DEFAULT_MODEL_CONFIG
): Map<number, WCTeam> {
  const resolvedModelConfig = createModelConfig(modelConfig);
  const winners = new Map<number, WCTeam>();

  for (const match of matches) {
    const aWins = simulateKnockout(
      match.home,
      match.away,
      ratings[match.home.name] ?? resolvedModelConfig.fallbackRating,
      ratings[match.away.name] ?? resolvedModelConfig.fallbackRating,
      playedMatches,
      teamMetrics,
      match.stage,
      random,
      resolvedModelConfig
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
  eliminated: boolean;
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
  simulationsRun = NUM_SIMULATIONS,
  eliminatedTeams: ReadonlySet<string> = new Set(),
  modelConfig: Partial<ModelConfig> = DEFAULT_MODEL_CONFIG
): PublishedSimulationResult[] {
  const resolvedModelConfig = createModelConfig(modelConfig);
  const { titles, finals, semiFinals, quarterFinals, roundOf16, groupWins, groupAdvances } = simResult;

  return WC2026_TEAMS.map((team) => {
    const eliminated = eliminatedTeams.has(team.name);
    const titleCount = eliminated ? 0 : titles[team.name];
    const finalCount = eliminated ? 0 : finals[team.name];
    const semiFinalCount = eliminated ? 0 : semiFinals[team.name];
    const quarterFinalCount = eliminated ? 0 : quarterFinals[team.name];
    const roundOf16Count = eliminated ? 0 : roundOf16[team.name];
    const groupWinCount = eliminated ? 0 : groupWins[team.name];
    const groupAdvanceCount = eliminated ? 0 : groupAdvances[team.name];

    return {
      name: team.name,
      code: team.code,
      group: team.group,
      flagEmoji: team.flagEmoji,
      elo: ratings[team.name] ?? resolvedModelConfig.fallbackRating,
      titlePct: toPercent(titleCount, simulationsRun),
      finalPct: toPercent(finalCount, simulationsRun),
      semiFinalPct: toPercent(semiFinalCount, simulationsRun),
      quarterFinalPct: toPercent(quarterFinalCount, simulationsRun),
      roundOf16Pct: toPercent(roundOf16Count, simulationsRun),
      groupWinPct: toPercent(groupWinCount, simulationsRun),
      groupAdvancePct: toPercent(groupAdvanceCount, simulationsRun),
      eliminated,
      uncertainty: {
        titlePct: toProbabilityUncertainty(titleCount, simulationsRun),
        finalPct: toProbabilityUncertainty(finalCount, simulationsRun),
        semiFinalPct: toProbabilityUncertainty(semiFinalCount, simulationsRun),
        quarterFinalPct: toProbabilityUncertainty(quarterFinalCount, simulationsRun),
        roundOf16Pct: toProbabilityUncertainty(roundOf16Count, simulationsRun),
        groupWinPct: toProbabilityUncertainty(groupWinCount, simulationsRun),
        groupAdvancePct: toProbabilityUncertainty(groupAdvanceCount, simulationsRun),
      },
    };
  }).sort((a, b) => b.titlePct - a.titlePct);
}

export function runSimulations(
  ratings: EloRatings,
  playedMatches: PlayedMatch[] = [],
  teamMetrics?: Record<string, TeamMetrics>,
  options: SimulationOptions = {}
): SimResult {
  const simulationsRun = getSimulationCount(options);
  const random = createRandomSource(options, DEFAULT_SIMULATION_SEED);
  const modelConfig = createModelConfig(options.modelConfig);
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
      }, modelConfig);
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
    const r32Winners = simulateKnockoutRound(r32Matches, ratings, playedMatches, teamMetrics, random, modelConfig);
    for (const team of r32Winners.values()) result.roundOf16[team.name]++;

    const r16Matches = buildMatchesFromPreviousWinners(ROUND_OF_16_MATCHES, r32Winners);
    const r16Winners = simulateKnockoutRound(r16Matches, ratings, playedMatches, teamMetrics, random, modelConfig);
    for (const team of r16Winners.values()) result.quarterFinals[team.name]++;

    const quarterFinalMatches = buildMatchesFromPreviousWinners(QUARTER_FINAL_MATCHES, r16Winners);
    const quarterFinalWinners = simulateKnockoutRound(
      quarterFinalMatches,
      ratings,
      playedMatches,
      teamMetrics,
      random,
      modelConfig
    );
    for (const team of quarterFinalWinners.values()) result.semiFinals[team.name]++;

    const semiFinalMatches = buildMatchesFromPreviousWinners(SEMI_FINAL_MATCHES, quarterFinalWinners);
    const semiFinalWinners = simulateKnockoutRound(
      semiFinalMatches,
      ratings,
      playedMatches,
      teamMetrics,
      random,
      modelConfig
    );
    for (const team of semiFinalWinners.values()) result.finals[team.name]++;

    const finalMatches = buildMatchesFromPreviousWinners(FINAL_MATCHES, semiFinalWinners);
    const finalWinners = simulateKnockoutRound(finalMatches, ratings, playedMatches, teamMetrics, random, modelConfig);
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
  stage: "group" | "R32" | "R16" | "QF" | "SF" | "F" | "neutral",
  venue?: string
): { isHomeA: boolean; isHomeB: boolean } {
  let isHomeA = false;
  let isHomeB = false;

  if (venue) {
    isHomeA = isHostTeamInVenueCountry(teamNameA, venue);
    isHomeB = isHostTeamInVenueCountry(teamNameB, venue);
  } else if (stage === "group" || stage === "R32" || stage === "R16") {
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

const VENUE_HOST_COUNTRY = new Map<string, "Canada" | "Mexico" | "United States">([
  ["Toronto", "Canada"],
  ["Vancouver", "Canada"],
  ["Mexico City", "Mexico"],
  ["Guadalajara", "Mexico"],
  ["Monterrey", "Mexico"],
  ["Atlanta", "United States"],
  ["Boston", "United States"],
  ["Dallas", "United States"],
  ["Houston", "United States"],
  ["Kansas City", "United States"],
  ["Los Angeles", "United States"],
  ["Miami", "United States"],
  ["New York New Jersey", "United States"],
  ["Philadelphia", "United States"],
  ["San Francisco Bay Area", "United States"],
  ["Seattle", "United States"],
]);

function isHostTeamInVenueCountry(teamName: string, venue: string): boolean {
  const country = VENUE_HOST_COUNTRY.get(venue);

  return (
    (teamName === "Canada" && country === "Canada") ||
    (teamName === "Mexico" && country === "Mexico") ||
    (teamName === "USA" && country === "United States")
  );
}
