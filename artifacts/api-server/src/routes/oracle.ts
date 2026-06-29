import { Router } from "express";
import { computeEloRatings, getWCTeamRatings, type TeamMetrics } from "../lib/elo.js";
import { runSimulations, matchProbabilities, type SimResult, type PlayedMatch } from "../lib/simulation.js";
import { WC2026_TEAMS, getTeamByName } from "../lib/worldcup2026.js";

const router = Router();

// ---- In-memory cache ----
interface OracleCache {
  ready: boolean;
  matchCount: number;
  ratings: Record<string, number>;
  teamMetrics: Record<string, TeamMetrics>;
  simResult: SimResult | null;
  playedMatches: PlayedMatch[];
}

const cache: OracleCache = {
  ready: false,
  matchCount: 0,
  ratings: {},
  teamMetrics: {},
  simResult: null,
  playedMatches: [],
};

// ---- Initialize on startup ----
export async function initOracle(): Promise<void> {
  try {
    const { ratings: allRatings, teamMetrics, matchCount } = await computeEloRatings();
    const wcRatings = getWCTeamRatings(allRatings);
    cache.matchCount = matchCount;
    cache.ratings = wcRatings;
    cache.teamMetrics = teamMetrics;

    const simResult = runSimulations(wcRatings, cache.playedMatches, cache.teamMetrics);
    cache.simResult = simResult;
    cache.ready = true;
  } catch (err) {
    console.error("Oracle init failed:", err);
  }
}

// ---- Routes ----

router.get("/oracle/status", (req, res) => {
  res.json({
    ready: cache.ready,
    matchesLoaded: cache.matchCount,
    teamsRated: Object.keys(cache.ratings).length,
    simulationsRun: cache.ready ? 10_000 : 0,
    liveMatchesRecorded: cache.playedMatches.length,
    message: cache.ready
      ? "Oracle ready. Dixon-Coles & Monte Carlo simulations active."
      : "Loading historical match data and computing Elo ratings...",
  });
});

router.post("/oracle/live-match", (req, res) => {
  const { homeTeam, awayTeam, homeScore, awayScore } = req.body as {
    homeTeam?: string;
    awayTeam?: string;
    homeScore?: number;
    awayScore?: number;
  };

  if (!homeTeam || !awayTeam || homeScore === undefined || awayScore === undefined) {
    return res.status(400).json({ error: "homeTeam, awayTeam, homeScore and awayScore are required" });
  }

  const home = getTeamByName(homeTeam);
  const away = getTeamByName(awayTeam);

  if (!home || !away) {
    return res.status(400).json({ error: "Invalid team name provided" });
  }

  // Record live match
  cache.playedMatches = cache.playedMatches.filter(
    (m) => !(m.homeTeam === homeTeam && m.awayTeam === awayTeam)
  );
  cache.playedMatches.push({ homeTeam, awayTeam, homeScore, awayScore });

  // Recalculate simulation with updated live state
  cache.simResult = runSimulations(cache.ratings, cache.playedMatches, cache.teamMetrics);

  return res.json({
    success: true,
    message: `Recorded live match: ${homeTeam} ${homeScore} - ${awayScore} ${awayTeam}`,
    liveMatchesCount: cache.playedMatches.length,
  });
});

router.delete("/oracle/live-match", (req, res) => {
  const { homeTeam, awayTeam } = req.body as { homeTeam?: string; awayTeam?: string };

  if (!homeTeam || !awayTeam) {
    return res.status(400).json({ error: "homeTeam and awayTeam are required" });
  }

  cache.playedMatches = cache.playedMatches.filter(
    (m) => !(m.homeTeam === homeTeam && m.awayTeam === awayTeam)
  );

  // Recalculate simulation with updated live state
  cache.simResult = runSimulations(cache.ratings, cache.playedMatches, cache.teamMetrics);

  return res.json({
    success: true,
    liveMatchesCount: cache.playedMatches.length,
  });
});

router.get("/oracle/live-matches", (req, res) => {
  return res.json({
    playedMatches: cache.playedMatches,
  });
});

router.post("/oracle/live-matches/clear", (req, res) => {
  cache.playedMatches = [];
  cache.simResult = runSimulations(cache.ratings, cache.playedMatches, cache.teamMetrics);

  return res.json({
    success: true,
    message: "All live matches cleared",
  });
});

router.get("/oracle/teams", (req, res) => {
  const teams = WC2026_TEAMS.map((t) => ({
    name: t.name,
    code: t.code,
    elo: cache.ratings[t.name] ?? 1000,
    group: t.group,
    flagEmoji: t.flagEmoji,
    attackStrength: cache.teamMetrics[t.name]?.attackStrength ?? 1.0,
    defenseStrength: cache.teamMetrics[t.name]?.defenseStrength ?? 1.0,
  })).sort((a, b) => b.elo - a.elo);

  res.json({ teams });
});

router.get("/oracle/simulation", (req, res) => {
  if (!cache.ready || !cache.simResult) {
    return res.json({ results: [], simulationsRun: 0, liveMatchesRecorded: 0 });
  }

  const { titles, finals, semiFinals, quarterFinals, roundOf16, groupWins, groupAdvances } =
    cache.simResult;
  const N = 10_000;

  const results = WC2026_TEAMS.map((t) => ({
    name: t.name,
    code: t.code,
    group: t.group,
    flagEmoji: t.flagEmoji,
    elo: cache.ratings[t.name] ?? 1000,
    titlePct: Math.round(((titles[t.name] ?? 0) / N) * 1000) / 10,
    finalPct: Math.round(((finals[t.name] ?? 0) / N) * 1000) / 10,
    semiFinalPct: Math.round(((semiFinals[t.name] ?? 0) / N) * 1000) / 10,
    quarterFinalPct: Math.round(((quarterFinals[t.name] ?? 0) / N) * 1000) / 10,
    roundOf16Pct: Math.round(((roundOf16[t.name] ?? 0) / N) * 1000) / 10,
    groupWinPct: Math.round(((groupWins[t.name] ?? 0) / N) * 1000) / 10,
    groupAdvancePct: Math.round(((groupAdvances[t.name] ?? 0) / N) * 1000) / 10,
  })).sort((a, b) => b.titlePct - a.titlePct);

  return res.json({ results, simulationsRun: N, liveMatchesRecorded: cache.playedMatches.length });
});

router.post("/oracle/predict-match", (req, res) => {
  const { homeTeam, awayTeam } = req.body as { homeTeam?: string; awayTeam?: string };

  if (!homeTeam || !awayTeam) {
    return res.status(400).json({ error: "homeTeam and awayTeam are required" });
  }

  const home = getTeamByName(homeTeam);
  const away = getTeamByName(awayTeam);

  if (!home) return res.status(400).json({ error: `Unknown team: ${homeTeam}` });
  if (!away) return res.status(400).json({ error: `Unknown team: ${awayTeam}` });
  if (homeTeam === awayTeam) return res.status(400).json({ error: "Teams must be different" });

  const eloHome = cache.ratings[homeTeam] ?? 1000;
  const eloAway = cache.ratings[awayTeam] ?? 1000;
  const metricsHome = cache.teamMetrics[homeTeam];
  const metricsAway = cache.teamMetrics[awayTeam];

  const { pWinA, pDraw, pWinB, xgA, xgB, mostLikelyScore } = matchProbabilities(
    eloHome,
    eloAway,
    50_000,
    metricsHome,
    metricsAway
  );

  res.json({
    homeTeam,
    awayTeam,
    homeWinPct: Math.round(pWinA * 1000) / 10,
    drawPct: Math.round(pDraw * 1000) / 10,
    awayWinPct: Math.round(pWinB * 1000) / 10,
    homeExpectedGoals: xgA,
    awayExpectedGoals: xgB,
    mostLikelyScore,
    homeElo: eloHome,
    awayElo: eloAway,
    homeAttackStrength: metricsHome?.attackStrength ?? 1.0,
    homeDefenseStrength: metricsHome?.defenseStrength ?? 1.0,
    awayAttackStrength: metricsAway?.attackStrength ?? 1.0,
    awayDefenseStrength: metricsAway?.defenseStrength ?? 1.0,
  });

  return;
});

export default router;

