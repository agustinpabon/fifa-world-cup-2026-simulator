import rawSquadsData from "../data/fifa-world-cup-2026-squads.v1.json" with { type: "json" };

import { TOURNAMENT_2026, type GroupId, type TournamentProvenance } from "./tournament-data.js";

const SQUAD_COMPLETENESS_STATUSES = ["complete", "incomplete"] as const;

type SquadCompletenessStatus = (typeof SQUAD_COMPLETENESS_STATUSES)[number];
type UnknownRecord = Record<string, unknown>;
type TeamLookup = {
  code: string;
  group: GroupId;
  flagEmoji: string;
};

export interface SquadSource extends TournamentProvenance {
  id: string;
}

export interface SquadPlayerInput {
  name: string;
  position: string;
  shirtNumber?: number;
  club?: string;
  sourceId?: string;
}

export interface SquadCompleteness {
  status: SquadCompletenessStatus;
  expectedPlayerCount: number;
  notes: string[];
}

export interface TeamSquadInput {
  team: string;
  sourceId: string;
  completeness: SquadCompleteness;
  players: SquadPlayerInput[];
}

export interface SquadsDataInput {
  schemaVersion: number;
  version: string;
  competition: string;
  provenance: TournamentProvenance;
  sources: SquadSource[];
  squads: TeamSquadInput[];
}

export interface SquadPlayer {
  name: string;
  position: string;
  shirtNumber?: number;
  club?: string;
  sourceId: string;
  source: SquadSource;
}

export interface TeamSquad {
  team: string;
  code: string;
  group: GroupId;
  flagEmoji: string;
  sourceId: string;
  source: SquadSource;
  completeness: SquadCompleteness;
  playerCount: number;
  players: SquadPlayer[];
}

export interface ValidatedSquadsData {
  schemaVersion: number;
  version: string;
  competition: string;
  provenance: TournamentProvenance;
  sources: SquadSource[];
  squads: TeamSquad[];
  raw: SquadsDataInput;
}

export class SquadsDataValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid squads data:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "SquadsDataValidationError";
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: UnknownRecord, key: string, issues: string[], path: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${path}.${key} must be a non-empty string`);
    return "";
  }

  return value;
}

function readOptionalString(
  record: UnknownRecord,
  key: string,
  issues: string[],
  path: string
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${path}.${key} must be a non-empty string when provided`);
    return undefined;
  }

  return value;
}

function readInteger(record: UnknownRecord, key: string, issues: string[], path: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    issues.push(`${path}.${key} must be an integer`);
    return Number.NaN;
  }

  return value;
}

function readOptionalInteger(
  record: UnknownRecord,
  key: string,
  issues: string[],
  path: string
): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    issues.push(`${path}.${key} must be an integer when provided`);
    return undefined;
  }

  return value;
}

function readStringArray(record: UnknownRecord, key: string, issues: string[], path: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    issues.push(`${path}.${key} must be an array of non-empty strings`);
    return [];
  }

  return [...value];
}

function parseProvenance(value: unknown, issues: string[], path: string): TournamentProvenance {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return {
      sourceName: "",
      sourceUrl: "",
      sourceTitle: "",
      publishedDate: "",
      accessedDate: "",
      notes: [],
    };
  }

  return {
    sourceName: readString(value, "sourceName", issues, path),
    sourceUrl: readString(value, "sourceUrl", issues, path),
    sourceTitle: readString(value, "sourceTitle", issues, path),
    publishedDate: readString(value, "publishedDate", issues, path),
    accessedDate: readString(value, "accessedDate", issues, path),
    notes: readStringArray(value, "notes", issues, path),
  };
}

function parseSources(value: unknown, issues: string[]): SquadSource[] {
  if (!Array.isArray(value)) {
    issues.push("squads.sources must be an array");
    return [];
  }

  return value.flatMap((source, index) => {
    const path = `sources[${index}]`;
    if (!isRecord(source)) {
      issues.push(`${path} must be an object`);
      return [];
    }

    const provenance = parseProvenance(source, issues, path);
    return [
      {
        id: readString(source, "id", issues, path),
        ...provenance,
      },
    ];
  });
}

function parseCompleteness(value: unknown, issues: string[], path: string): SquadCompleteness {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return {
      status: "incomplete",
      expectedPlayerCount: 0,
      notes: [],
    };
  }

  const status = readString(value, "status", issues, path);
  if (!SQUAD_COMPLETENESS_STATUSES.includes(status as SquadCompletenessStatus)) {
    issues.push(`${path}.status must be one of ${SQUAD_COMPLETENESS_STATUSES.join(", ")}`);
  }

  const expectedPlayerCount = readInteger(value, "expectedPlayerCount", issues, path);
  if (Number.isFinite(expectedPlayerCount) && expectedPlayerCount < 1) {
    issues.push(`${path}.expectedPlayerCount must be greater than 0`);
  }

  const notes = readStringArray(value, "notes", issues, path);
  if (status === "incomplete" && notes.length === 0) {
    issues.push(`${path}.notes must explain why the squad is incomplete`);
  }

  return {
    status: SQUAD_COMPLETENESS_STATUSES.includes(status as SquadCompletenessStatus)
      ? (status as SquadCompletenessStatus)
      : "incomplete",
    expectedPlayerCount,
    notes,
  };
}

function parsePlayers(value: unknown, issues: string[], path: string): SquadPlayerInput[] {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return [];
  }

  return value.flatMap((player, index) => {
    const playerPath = `${path}[${index}]`;
    if (!isRecord(player)) {
      issues.push(`${playerPath} must be an object`);
      return [];
    }

    const shirtNumber = readOptionalInteger(player, "shirtNumber", issues, playerPath);
    if (shirtNumber !== undefined && (shirtNumber < 1 || shirtNumber > 99)) {
      issues.push(`${playerPath}.shirtNumber must be between 1 and 99`);
    }

    const club = readOptionalString(player, "club", issues, playerPath);
    const sourceId = readOptionalString(player, "sourceId", issues, playerPath);

    return [
      {
        name: readString(player, "name", issues, playerPath),
        position: readString(player, "position", issues, playerPath),
        ...(shirtNumber !== undefined ? { shirtNumber } : {}),
        ...(club !== undefined ? { club } : {}),
        ...(sourceId !== undefined ? { sourceId } : {}),
      },
    ];
  });
}

function parseSquads(value: unknown, issues: string[]): TeamSquadInput[] {
  if (!Array.isArray(value)) {
    issues.push("squads.squads must be an array");
    return [];
  }

  return value.flatMap((squad, index) => {
    const path = `squads[${index}]`;
    if (!isRecord(squad)) {
      issues.push(`${path} must be an object`);
      return [];
    }

    return [
      {
        team: readString(squad, "team", issues, path),
        sourceId: readString(squad, "sourceId", issues, path),
        completeness: parseCompleteness(squad.completeness, issues, `${path}.completeness`),
        players: parsePlayers(squad.players, issues, `${path}.players`),
      },
    ];
  });
}

function assertUnique(values: string[], label: string, issues: string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      issues.push(`${label} contains duplicate value: ${value}`);
    }
    seen.add(value);
  }
}

function validateSquadReferences(
  sources: SquadSource[],
  squads: TeamSquadInput[],
  issues: string[]
): Map<string, TeamLookup> {
  const teamsByName = new Map(
    TOURNAMENT_2026.teams.map((team) => [team.name, { code: team.code, group: team.group, flagEmoji: team.flagEmoji }])
  );
  const sourcesById = new Map(sources.map((source) => [source.id, source]));

  for (const squad of squads) {
    if (!teamsByName.has(squad.team)) {
      issues.push(`squad ${squad.team} references an unknown team`);
    }

    if (!sourcesById.has(squad.sourceId)) {
      issues.push(`squad ${squad.team} references an unknown sourceId: ${squad.sourceId}`);
    }

    if (Number.isFinite(squad.completeness.expectedPlayerCount)) {
      if (squad.players.length > squad.completeness.expectedPlayerCount) {
        issues.push(
          `squad ${squad.team} has ${squad.players.length} players but expectedPlayerCount is ${squad.completeness.expectedPlayerCount}`
        );
      }

      if (
        squad.completeness.status === "complete" &&
        squad.players.length !== squad.completeness.expectedPlayerCount
      ) {
        issues.push(
          `complete squad ${squad.team} must contain exactly ${squad.completeness.expectedPlayerCount} players`
        );
      }
    }

    const playerNames = new Set<string>();
    const shirtNumbers = new Set<number>();
    for (const player of squad.players) {
      if (playerNames.has(player.name)) {
        issues.push(`squad ${squad.team} contains duplicate player name: ${player.name}`);
      }
      playerNames.add(player.name);

      if (player.shirtNumber !== undefined) {
        if (shirtNumbers.has(player.shirtNumber)) {
          issues.push(`squad ${squad.team} contains duplicate shirtNumber: ${player.shirtNumber}`);
        }
        shirtNumbers.add(player.shirtNumber);
      }

      const playerSourceId = player.sourceId ?? squad.sourceId;
      if (!sourcesById.has(playerSourceId)) {
        issues.push(`player ${player.name} in squad ${squad.team} references an unknown sourceId: ${playerSourceId}`);
      }
    }
  }

  if (squads.length !== TOURNAMENT_2026.teams.length) {
    issues.push(`Squads data must define exactly ${TOURNAMENT_2026.teams.length} team entries`);
  }

  const squadTeams = new Set(squads.map((squad) => squad.team));
  for (const team of TOURNAMENT_2026.teams) {
    if (!squadTeams.has(team.name)) {
      issues.push(`Missing squad entry for team: ${team.name}`);
    }
  }

  return teamsByName;
}

function copyProvenance(value: TournamentProvenance): TournamentProvenance {
  return {
    sourceName: value.sourceName,
    sourceUrl: value.sourceUrl,
    sourceTitle: value.sourceTitle,
    publishedDate: value.publishedDate,
    accessedDate: value.accessedDate,
    notes: [...value.notes],
  };
}

function copySource(value: SquadSource): SquadSource {
  return {
    id: value.id,
    ...copyProvenance(value),
  };
}

function copyCompleteness(value: SquadCompleteness): SquadCompleteness {
  return {
    status: value.status,
    expectedPlayerCount: value.expectedPlayerCount,
    notes: [...value.notes],
  };
}

function copyPlayerInput(value: SquadPlayerInput): SquadPlayerInput {
  return {
    name: value.name,
    position: value.position,
    ...(value.shirtNumber !== undefined ? { shirtNumber: value.shirtNumber } : {}),
    ...(value.club !== undefined ? { club: value.club } : {}),
    ...(value.sourceId !== undefined ? { sourceId: value.sourceId } : {}),
  };
}

export function validateSquadsData(value: unknown): ValidatedSquadsData {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new SquadsDataValidationError(["Squads data must be an object"]);
  }

  const schemaVersion = readInteger(value, "schemaVersion", issues, "squads");
  const version = readString(value, "version", issues, "squads");
  const competition = readString(value, "competition", issues, "squads");
  const provenance = parseProvenance(value.provenance, issues, "provenance");
  const sources = parseSources(value.sources, issues);
  const squads = parseSquads(value.squads, issues);

  assertUnique(sources.map((source) => source.id), "sources.id", issues);
  assertUnique(squads.map((squad) => squad.team), "squads.team", issues);

  const teamsByName = validateSquadReferences(sources, squads, issues);

  if (issues.length > 0) {
    throw new SquadsDataValidationError(issues);
  }

  const raw: SquadsDataInput = {
    schemaVersion,
    version,
    competition,
    provenance: copyProvenance(provenance),
    sources: sources.map(copySource),
    squads: squads.map((squad) => ({
      team: squad.team,
      sourceId: squad.sourceId,
      completeness: copyCompleteness(squad.completeness),
      players: squad.players.map(copyPlayerInput),
    })),
  };
  const sourcesById = new Map(raw.sources.map((source) => [source.id, source]));

  return {
    schemaVersion,
    version,
    competition,
    provenance: copyProvenance(raw.provenance),
    sources: raw.sources.map(copySource),
    squads: raw.squads.map((squad) => {
      const team = teamsByName.get(squad.team);
      const source = sourcesById.get(squad.sourceId);

      if (!team || !source) {
        throw new SquadsDataValidationError([`Unable to resolve validated squad ${squad.team}`]);
      }

      return {
        team: squad.team,
        code: team.code,
        group: team.group,
        flagEmoji: team.flagEmoji,
        sourceId: squad.sourceId,
        source: copySource(source),
        completeness: copyCompleteness(squad.completeness),
        playerCount: squad.players.length,
        players: squad.players.map((player) => {
          const playerSourceId = player.sourceId ?? squad.sourceId;
          const playerSource = sourcesById.get(playerSourceId);

          if (!playerSource) {
            throw new SquadsDataValidationError([
              `Unable to resolve validated source ${playerSourceId} for player ${player.name}`,
            ]);
          }

          return {
            name: player.name,
            position: player.position,
            ...(player.shirtNumber !== undefined ? { shirtNumber: player.shirtNumber } : {}),
            ...(player.club !== undefined ? { club: player.club } : {}),
            sourceId: playerSourceId,
            source: copySource(playerSource),
          };
        }),
      };
    }),
    raw,
  };
}

export const WC2026_SQUADS = validateSquadsData(rawSquadsData);

export function getSquadByTeamName(teamName: string): TeamSquad | undefined {
  const squad = WC2026_SQUADS.squads.find((entry) => entry.team === teamName);
  if (!squad) {
    return undefined;
  }

  return {
    team: squad.team,
    code: squad.code,
    group: squad.group,
    flagEmoji: squad.flagEmoji,
    sourceId: squad.sourceId,
    source: copySource(squad.source),
    completeness: copyCompleteness(squad.completeness),
    playerCount: squad.playerCount,
    players: squad.players.map((player) => ({
      name: player.name,
      position: player.position,
      ...(player.shirtNumber !== undefined ? { shirtNumber: player.shirtNumber } : {}),
      ...(player.club !== undefined ? { club: player.club } : {}),
      sourceId: player.sourceId,
      source: copySource(player.source),
    })),
  };
}
