import { WC2026_TEAMS, GROUPS, type WCTeam } from "./worldcup2026.js";
import type { EloRatings } from "./elo.js";

const NUM_SIMULATIONS = 10_000;
const BASE_XG = 1.25; // average goals per team per game
const ELO_SCALE = 400; // Elo scale factor

// ---------- Math helpers ----------

function poissonSample(lambda: number): number {
  if (lambda <= 0) return 0;
  // Knuth algorithm
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

function expectedGoals(eloA: number, eloB: number): { xgA: number; xgB: number } {
  const diff = (eloA - eloB) / ELO_SCALE;
  // Convert Elo diff to multiplicative goal scaling
  const mult = Math.pow(10, diff); // A team x10 stronger would score ~10x more (capped below)
  const ratio = Math.min(Math.max(Math.sqrt(mult), 0.33), 3); // cap ratio
  // Share total goals ~2.5 between two teams
  const total = BASE_XG * 2;
  const xgA = (total * ratio) / (1 + ratio);
  const xgB = total - xgA;
  return { xgA, xgB };
}

function simulateMatch(
  eloA: number,
  eloB: number
): { goalsA: number; goalsB: number } {
  const { xgA, xgB } = expectedGoals(eloA, eloB);
  return { goalsA: poissonSample(xgA), goalsB: poissonSample(xgB) };
}

// Win/draw/loss probabilities via Monte Carlo (small sample for prediction)
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
    const ga = poissonSample(xgA);
    const gb = poissonSample(xgB);
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
  ratings: EloRatings
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
      const { goalsA, goalsB } = simulateMatch(a.elo, b.elo);
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
  // Returns true if A wins (can't draw - pens decide)
  const { goalsA, goalsB } = simulateMatch(eloA, eloB);
  if (goalsA > goalsB) return true;
  if (goalsB > goalsA) return false;
  // Penalties: 50/50 slight edge to better team
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

export function runSimulations(ratings: EloRatings): SimResult {
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
    for (const group of GROUPS) {
      const groupTeams = WC2026_TEAMS.filter((t) => t.group === group);
      const standings = simulateGroup(groupTeams, ratings);
      groupResults.push(standings);
    }

    // Track group wins and advances
    // Top 2 from each group automatically advance: 12 groups × 2 = 24 teams
    // Best 8 third-place teams also advance: total = 32 for R32
    const thirdPlacers: GroupStanding[] = [];
    const advancers: WCTeam[] = [];

    for (const standings of groupResults) {
      const winner = standings[0];
      const second = standings[1];
      const third = standings[2];
      result.groupWins[winner.team.name]++;
      result.groupAdvances[winner.team.name]++;
      result.groupAdvances[second.team.name]++;
      advancers.push(winner.team, second.team);
      thirdPlacers.push(third);
    }

    // Pick best 8 third-place teams by points then gd then gf
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
      advancers.push(t.team);
    }

    // Now we have 32 teams. Shuffle for seeding simplicity
    // (real bracket is complex - we use random knockout for demo)
    const pool = [...advancers];
    shuffle(pool);

    // Round of 32 → 16 teams
    const r16: WCTeam[] = [];
    for (let i = 0; i < pool.length; i += 2) {
      const a = pool[i];
      const b = pool[i + 1];
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

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
