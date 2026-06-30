import { type HistoricalMatch } from "./types.js";

export function parseResultsCsv(raw: string): HistoricalMatch[] {
  const lines = raw.split(/\r?\n/);
  const matches: HistoricalMatch[] = [];

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;

    const parts = parseCsvLine(line);
    if (parts.length < 9) continue;

    const homeScore = Number.parseInt(parts[3] ?? "", 10);
    const awayScore = Number.parseInt(parts[4] ?? "", 10);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

    const match = {
      date: parts[0] ?? "",
      homeTeam: parts[1] ?? "",
      awayTeam: parts[2] ?? "",
      homeScore,
      awayScore,
      tournament: parts[5] ?? "",
      neutral: (parts[8] ?? "").trim().toUpperCase() === "TRUE",
    };

    if (isIsoDate(match.date) && match.homeTeam.length > 0 && match.awayTeam.length > 0) {
      matches.push(match);
    }
  }

  return matches;
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === "\"" && inQuotes && nextCharacter === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (character === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  fields.push(current);
  return fields;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
