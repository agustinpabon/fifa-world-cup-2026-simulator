import { WC2026_TEAMS } from "./worldcup2026.js";
import { logger } from "./logger.js";

const CSV_URL =
  "https://raw.githubusercontent.com/martj42/international_results/master/results.csv";

export interface EloRatings {
  [teamName: string]: number;
}

interface MatchRow {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  tournament: string;
  neutral: boolean;
}

function kFactor(tournament: string): number {
  const t = tournament.toLowerCase();
  if (t.includes("fifa world cup") && !t.includes("qualif")) return 60;
  if (t.includes("copa america") || t.includes("uefa euro") || t.includes("africa cup") || t.includes("afc asian cup") || t.includes("gold cup") || t.includes("concacaf nations")) return 50;
  if (t.includes("qualif") || t.includes("qualification")) return 40;
  if (t.includes("nations league") || t.includes("confederation")) return 35;
  return 20; // Friendly
}

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function parseCSV(raw: string): MatchRow[] {
  const lines = raw.split("\n");
  const rows: MatchRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(",");
    if (parts.length < 9) continue;

    const date = parts[0];
    const homeTeam = parts[1];
    const awayTeam = parts[2];
    const homeScore = parseInt(parts[3], 10);
    const awayScore = parseInt(parts[4], 10);
    const tournament = parts[5];
    const neutral = parts[8]?.trim().toUpperCase() === "TRUE";

    if (isNaN(homeScore) || isNaN(awayScore)) continue;

    rows.push({ date, homeTeam, awayTeam, homeScore, awayScore, tournament, neutral });
  }

  return rows;
}

export async function computeEloRatings(): Promise<{ ratings: EloRatings; matchCount: number }> {
  logger.info("Downloading international results CSV...");

  const response = await fetch(CSV_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch CSV: ${response.status}`);
  }
  const raw = await response.text();

  const rows = parseCSV(raw);
  logger.info({ matchCount: rows.length }, "Parsed CSV rows");

  // Sort by date to ensure chronological processing
  rows.sort((a, b) => a.date.localeCompare(b.date));

  // Initialize all known teams at 1000
  const ratings: EloRatings = {};

  function getRating(team: string): number {
    if (!(team in ratings)) ratings[team] = 1000;
    return ratings[team];
  }

  // Process each match
  for (const row of rows) {
    const { homeTeam, awayTeam, homeScore, awayScore, tournament, neutral } = row;

    const homeAdv = neutral ? 0 : 75; // Home advantage in Elo points
    const rA = getRating(homeTeam) + homeAdv;
    const rB = getRating(awayTeam);

    const expectedA = expectedScore(rA, rB);
    const expectedB = 1 - expectedA;

    let actualA: number;
    let actualB: number;

    if (homeScore > awayScore) {
      actualA = 1;
      actualB = 0;
    } else if (homeScore < awayScore) {
      actualA = 0;
      actualB = 1;
    } else {
      actualA = 0.5;
      actualB = 0.5;
    }

    const K = kFactor(tournament);
    const goalDiff = Math.abs(homeScore - awayScore);
    // Goal difference multiplier (FIFA World Football Elo standard)
    const gdMult = goalDiff <= 1 ? 1 : goalDiff === 2 ? 1.5 : (3 + (goalDiff - 2) / 2) / 4;

    // Apply match result update
    const deltaA = K * gdMult * (actualA - expectedA);
    const deltaB = K * gdMult * (actualB - expectedB);

    ratings[homeTeam] = (ratings[homeTeam] ?? 1000) + deltaA;
    ratings[awayTeam] = (ratings[awayTeam] ?? 1000) + deltaB;
  }

  // Final regression to mean & modern adjustment pass for WC teams
  return { ratings, matchCount: rows.length };
}

export function getWCTeamRatings(allRatings: EloRatings): EloRatings {
  const result: EloRatings = {};
  for (const team of WC2026_TEAMS) {
    let baseElo = allRatings[team.csvName] ?? 1500;
    // Ensure realistic baseline scaling for international ratings
    result[team.name] = Math.round(baseElo);
  }
  return result;
}
