import { WC2026_TEAMS, GROUPS, type WCTeam } from "./worldcup2026.js";
import type { EloRatings } from "./elo.js";

const NUM_SIMULATIONS = 10_000;
const BASE_XG = 1.25; // average goals per team per game
const ELO_SCALE = 400; // Elo scale factor

// ---------- Dixon-Coles & Math helpers ----------

function poissonSample(lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

// Dixon-Coles score sampling adjusting low-score draws (0-0, 1-1, 1-0, 0-1)
function dixonColesSample(lambda: number, mu: number, rho = -0.06): { goalsA: number; goalsB: number } {
  // Rejection sampling or probability grid for common scores
  for (let attempt = 0; attempt < 50; attempt++) {
    const ga = poissonSample(lambda);
    const gb = poissonSample(mu);

    let tau = 1.0;
    if (ga === 0 && gb === 0) tau = 1.0 - lambda * mu * rho;
    else if (ga === 1 && gb === 0) tau = 1.0 + mu * rho;
    else if (ga === 0 && gb === 1) tau = 1.0 + lambda * rho;
    else if (ga === 1 && gb === 1) tau = 1.0 - rho;

    if (Math.random() < Math.max(0, Math.min(1, tau))) {
      return { goalsA: ga, goalsB: gb };
    }
  }
  return { goalsA: poissonSample(lambda), goalsB: poissonSample(mu) };
}

function expectedGoals(eloA: number, eloB: number): { xgA: number; xgB: number } {
  const diff = (eloA - eloB) / ELO_SCALE;
  const mult = Math.pow(10, diff);
  // Dynamic scaling without severe artificial truncation (allows dominant teams to reflect true xG superiority)
  const ratio = Math.min(Math.max(Math.sqrt(mult), 0.15), 6.5);
  const total = BASE_XG * 2;
  const xgA = (total * ratio) / (1 + ratio);
  const xgB = total - xgA;
  return { xgA, xgB };
}

export interface PlayedMatch {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  stage?: string;
}

function simulateMatch(
  eloA: number,
  eloB: number,
  playedMatch?: PlayedMatch
): { goalsA: number; goalsB: number } {
  if (playedMatch) {
    return { goalsA: playedMatch.homeScore, goalsB: playedMatch.awayScore };
  }
  const { xgA, xgB } = expectedGoals(eloA, eloB);
  return dixonColesSample(xgA, xgB);
}

// Win/draw/loss probabilities via Monte Carlo
export function matchProbabilities(
  eloA: number,
  eloB: number,
  trials = 50_000
): { pWinA: number; pDraw: number; pWinB: number; xgA: number; xgB: number; mostLikelyScore: string } {
  const { xgA, xgB } = expectedGoals(eloA, eloB);
  let winA = 0;
  let draw = 0;
  let winB = 0;
  const scoreFreq: Record<string, number> = {};

  for (let i = 0; i < trials; i++) {
    const { goalsA: ga, goalsB: gb } = dixonColesSample(xgA, xgB);
    const key = `${ga}-${gb}`;
    scoreFreq[key] = (scoreFreq[key] ?? 0) + 1;
    if (ga > gb) winA++;
    else if (ga < gb) winB++;
    else draw++;
  }

  const topScore = Object.entries(scoreFreq).sort((a, b) => b[1] - a[1])[0];

  return {
    pWinA: winA / trials,
    pDraw: draw / trials,
    pWinB: winB / trials,
    xgA: Math.round(xgA * 100) / 100,
    xgB: Math.round(xgB * 100) / 100,
    mostLikelyScore: topScore ? topScore[0] : "1-1",
  };
}

// ---------- Group stage ----------

interface GroupStanding {
  team: WCTeam;
  elo: number;
  points: number;
  gf: number;
  ga: number;
  gd: number;
}

function simulateGroup(
  groupTeams: WCTeam[],
  ratings: EloRatings,
  playedMatches: PlayedMatch[] = []
): GroupStanding[] {
  const standings: GroupStanding[] = groupTeams.map((t) => ({
    team: t,
    elo: ratings[t.name] ?? 1000,
    points: 0,
    gf: 0,
    ga: 0,
    gd: 0,
  }));

  // Round-robin: each pair plays once
  for (let i = 0; i < standings.length; i++) {
    for (let j = i + 1; j < standings.length; j++) {
      const a = standings[i];
      const b = standings[j];
      const played = playedMatches.find(
        (m) =>
          (m.homeTeam === a.team.name && m.awayTeam === b.team.name) ||
          (m.homeTeam === b.team.name && m.awayTeam === a.team.name)
      );

      let goalsA: number;
      let goalsB: number;

      if (played) {
        if (played.homeTeam === a.team.name) {
          goalsA = played.homeScore;
          goalsB = played.awayScore;
        } else {
          goalsA = played.awayScore;
          goalsB = played.homeScore;
        }
      } else {
        const sim = simulateMatch(a.elo, b.elo);
        goalsA = sim.goalsA;
        goalsB = sim.goalsB;
      }

      a.gf += goalsA;
      a.ga += goalsB;
      b.gf += goalsB;
      b.ga += goalsA;
      a.gd = a.gf - a.ga;
      b.gd = b.gf - b.ga;
      if (goalsA > goalsB) {
        a.points += 3;
      } else if (goalsB > goalsA) {
        b.points += 3;
      } else {
        a.points += 1;
        b.points += 1;
      }
    }
  }

  // Sort: points > gd > gf
  standings.sort((a, b) =>
    b.points !== a.points
      ? b.points - a.points
      : b.gd !== a.gd
      ? b.gd - a.gd
      : b.gf - a.gf
  );

  return standings;
}

// ---------- Knockout ----------

function simulateKnockout(eloA: number, eloB: number): boolean {
  const { goalsA, goalsB } = simulateMatch(eloA, eloB);
  if (goalsA > goalsB) return true;
  if (goalsB > goalsA) return false;
  const penEdge = Math.min(0.6, 0.5 + (eloA - eloB) / 2000);
  return Math.random() < penEdge;
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

export function runSimulations(ratings: EloRatings, playedMatches: PlayedMatch[] = []): SimResult {
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

  for (let sim = 0; sim < NUM_SIMULATIONS; sim++) {
    // Group stage: all 12 groups
    const groupResults: GroupStanding[][] = [];
    const groupWinnersMap: Record<string, WCTeam> = {};
    const groupRunnersMap: Record<string, WCTeam> = {};

    for (const group of GROUPS) {
      const groupTeams = WC2026_TEAMS.filter((t) => t.group === group);
      const standings = simulateGroup(groupTeams, ratings, playedMatches);
      groupResults.push(standings);
      groupWinnersMap[group] = standings[0].team;
      groupRunnersMap[group] = standings[1].team;
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

    thirdPlacers.sort((a, b) =>
      b.points !== a.points
        ? b.points - a.points
        : b.gd !== a.gd
        ? b.gd - a.gd
        : b.gf - a.gf
    );

    const best8thirds = thirdPlacers.slice(0, 8);
    for (const t of best8thirds) {
      result.groupAdvances[t.team.name]++;
    }

    // Build structured Round of 32 pairs following FIFA 48-team bracket principles
    // Pair 12 group winners, 12 runners-up, and 8 best thirds without duplicates
    const r32Matches: [WCTeam, WCTeam][] = [
      [groupWinnersMap["A"], groupRunnersMap["B"]],
      [groupWinnersMap["B"], groupRunnersMap["A"]],
      [groupWinnersMap["K"], groupRunnersMap["L"]],
      [groupWinnersMap["L"], groupRunnersMap["K"]],
      [groupWinnersMap["C"], best8thirds[0].team],
      [groupWinnersMap["D"], best8thirds[1].team],
      [groupWinnersMap["E"], best8thirds[2].team],
      [groupWinnersMap["F"], best8thirds[3].team],
      [groupWinnersMap["G"], best8thirds[4].team],
      [groupWinnersMap["H"], best8thirds[5].team],
      [groupWinnersMap["I"], best8thirds[6].team],
      [groupWinnersMap["J"], best8thirds[7].team],
      [groupRunnersMap["C"], groupRunnersMap["D"]],
      [groupRunnersMap["E"], groupRunnersMap["F"]],
      [groupRunnersMap["G"], groupRunnersMap["H"]],
      [groupRunnersMap["I"], groupRunnersMap["J"]],
    ];

    // Round of 32 → 16 teams
    const r16: WCTeam[] = [];
    for (const [a, b] of r32Matches) {
      const aWins = simulateKnockout(ratings[a.name] ?? 1000, ratings[b.name] ?? 1000);
      r16.push(aWins ? a : b);
    }

    for (const t of r16) result.roundOf16[t.name]++;

    // Quarter-finals: 16 → 8
    const qf: WCTeam[] = [];
    for (let i = 0; i < r16.length; i += 2) {
      const a = r16[i];
      const b = r16[i + 1];
      const aWins = simulateKnockout(ratings[a.name] ?? 1000, ratings[b.name] ?? 1000);
      qf.push(aWins ? a : b);
    }

    for (const t of qf) result.quarterFinals[t.name]++;

    // Semi-finals: 8 → 4
    const sf: WCTeam[] = [];
    for (let i = 0; i < qf.length; i += 2) {
      const a = qf[i];
      const b = qf[i + 1];
      const aWins = simulateKnockout(ratings[a.name] ?? 1000, ratings[b.name] ?? 1000);
      sf.push(aWins ? a : b);
    }

    for (const t of sf) result.semiFinals[t.name]++;

    // Finals: 4 → 2
    const finalists: WCTeam[] = [];
    for (let i = 0; i < sf.length; i += 2) {
      const a = sf[i];
      const b = sf[i + 1];
      const aWins = simulateKnockout(ratings[a.name] ?? 1000, ratings[b.name] ?? 1000);
      finalists.push(aWins ? a : b);
    }

    for (const t of finalists) result.finals[t.name]++;

    // Final: 2 → 1 champion
    const [f1, f2] = finalists;
    const aWins = simulateKnockout(ratings[f1.name] ?? 1000, ratings[f2.name] ?? 1000);
    result.titles[(aWins ? f1 : f2).name]++;
  }

  return result;
}
