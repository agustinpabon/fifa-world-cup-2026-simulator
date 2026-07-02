import {
  createExternalDataProvider,
  fetchJsonWithTimeout,
  type ExternalDataProvider,
  type ExternalDataProvenance,
  type ExternalDataSnapshot,
  type FetchLike,
  type ReadExternalDataOptions,
} from "./external-data.js";
import {
  WC2026_SQUADS,
  type SquadCompleteness,
  type SquadPlayer,
  type SquadSource,
  type TeamSquad,
} from "./squads-data.js";
import { WC2026_TEAMS } from "./worldcup2026.js";

export const DEFAULT_API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";
export const DEFAULT_API_FOOTBALL_CACHE_TTL_MS = 12 * 60 * 60_000;

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_WORLD_CUP_LEAGUE_ID = 1;
const DEFAULT_WORLD_CUP_SEASON = 2026;
const API_FOOTBALL_PROVIDER = "api-football" as const;
const API_FOOTBALL_SOURCE_TITLE = "API-Football players/squads";

type ApiFootballProvider = typeof API_FOOTBALL_PROVIDER;
type UnknownRecord = Record<string, unknown>;

export interface ApiFootballSquadsProvenance
  extends ExternalDataProvenance<ApiFootballProvider> {
  sourceEndpoint: string;
}

export interface ApiFootballSquadsSnapshot {
  squads: TeamSquad[];
  provenance: ApiFootballSquadsProvenance;
}

export interface ApiFootballSquadsProvider {
  read(options?: ReadExternalDataOptions): Promise<ApiFootballSquadsSnapshot>;
  peek(): ApiFootballSquadsSnapshot;
  clear(): void;
}

export interface CreateApiFootballSquadsProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  cacheTtlMs?: number;
  fetchImpl?: FetchLike;
  leagueId?: number;
  season?: number;
  teamIds?: Record<string, number>;
  teams?: string[];
  timeoutMs?: number;
}

type ApiFootballTeamIndex = {
  idsByTeamName: Map<string, number>;
  namesByApiId: Map<number, string>;
};

type ApiFootballSquadPayload = {
  teamName: string;
  teamId: number;
  players: SquadPlayer[];
  skippedPlayerCount: number;
  sourceEndpoint: string;
};

const PROJECT_TEAM_BY_NAME = new Map(WC2026_TEAMS.map((team) => [team.name, team]));
const PROJECT_TEAM_BY_CODE = new Map(WC2026_TEAMS.map((team) => [team.code.toUpperCase(), team]));
const PROJECT_TEAM_BY_NORMALIZED_NAME = new Map(
  WC2026_TEAMS.flatMap((team) => [
    [normalizeTeamName(team.name), team],
    [normalizeTeamName(team.csvName), team],
  ])
);
const TEAM_NAME_ALIASES = new Map<string, string>([
  ["bosnia-herzegovina", "Bosnia & Herzegovina"],
  ["bosnia and herzegovina", "Bosnia & Herzegovina"],
  ["cape verde", "Cabo Verde"],
  ["czech republic", "Czechia"],
  ["democratic republic of the congo", "Congo DR"],
  ["dr congo", "Congo DR"],
  ["ivory coast", "Côte d'Ivoire"],
  ["iran", "IR Iran"],
  ["south korea", "Korea Republic"],
  ["turkey", "Türkiye"],
  ["united states", "USA"],
  ["united states of america", "USA"],
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTeamName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\s+/g, " ")
    .trim();
}

function readString(record: UnknownRecord | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readArray(record: UnknownRecord | undefined, key: string): unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

function parseInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string") return undefined;

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function createApiFootballHeaders(apiKey: string): NonNullable<RequestInit["headers"]> {
  return {
    accept: "application/json",
    "x-apisports-key": apiKey,
  };
}

function createEndpoint(baseUrl: string, pathname: string, params: Record<string, string | number> = {}): string {
  const url = new URL(pathname, baseUrl);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

function hasApiFootballErrors(errors: unknown): boolean {
  if (errors === undefined || errors === null) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  if (typeof errors === "string") return errors.trim().length > 0;
  if (isRecord(errors)) return Object.keys(errors).length > 0;

  return true;
}

async function fetchApiFootballResponse(
  options: {
    apiKey: string;
    endpointName: string;
    fetchImpl: FetchLike;
    timeoutMs: number;
    url: string;
  }
): Promise<unknown[]> {
  const payload = await fetchJsonWithTimeout(options.fetchImpl, options.url, options.timeoutMs, {
    headers: createApiFootballHeaders(options.apiKey),
  });

  if (!isRecord(payload)) {
    throw new Error(`API-Football ${options.endpointName} payload must be an object`);
  }

  if (hasApiFootballErrors(payload.errors)) {
    throw new Error(`API-Football ${options.endpointName} responded with errors`);
  }

  if (!Array.isArray(payload.response)) {
    throw new Error(`API-Football ${options.endpointName} response must be an array`);
  }

  return payload.response;
}

function getProjectTeamNameFromApiTeam(team: UnknownRecord | undefined): string | undefined {
  const code = readString(team, "code")?.toUpperCase();
  if (code) {
    const byCode = PROJECT_TEAM_BY_CODE.get(code);
    if (byCode) return byCode.name;
  }

  const name = readString(team, "name");
  if (!name) return undefined;

  const normalizedName = normalizeTeamName(name);
  const alias = TEAM_NAME_ALIASES.get(normalizedName);
  if (alias) return alias;

  return PROJECT_TEAM_BY_NORMALIZED_NAME.get(normalizedName)?.name;
}

function getRequestedTeamNames(teams: readonly string[] | undefined): string[] {
  if (!teams) {
    return WC2026_TEAMS.map((team) => team.name);
  }

  return teams.flatMap((teamName) => {
    const projectTeam =
      PROJECT_TEAM_BY_NAME.get(teamName) ?? PROJECT_TEAM_BY_NORMALIZED_NAME.get(normalizeTeamName(teamName));
    return projectTeam ? [projectTeam.name] : [];
  });
}

function getConfiguredTeamId(
  teamName: string,
  teamIds: Record<string, number> | undefined
): number | undefined {
  if (!teamIds) return undefined;

  const projectTeam = PROJECT_TEAM_BY_NAME.get(teamName);
  const candidates = [
    teamName,
    normalizeTeamName(teamName),
    projectTeam?.code,
    projectTeam?.code.toUpperCase(),
  ].filter((value): value is string => typeof value === "string");

  for (const candidate of candidates) {
    const value = teamIds[candidate];
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
  }

  return undefined;
}

async function loadApiFootballTeamIndex(options: {
  apiKey: string;
  baseUrl: string;
  fetchImpl: FetchLike;
  leagueId: number;
  requestedTeamNames: readonly string[];
  season: number;
  teamIds?: Record<string, number>;
  timeoutMs: number;
}): Promise<ApiFootballTeamIndex> {
  const requestedTeamNames = new Set(options.requestedTeamNames);
  const configuredEntries = options.requestedTeamNames.flatMap((teamName) => {
    const teamId = getConfiguredTeamId(teamName, options.teamIds);
    return teamId === undefined ? [] : [[teamName, teamId] as const];
  });
  const configuredIdsByName = new Map(configuredEntries);
  const missingConfiguredTeams = options.requestedTeamNames.filter(
    (teamName) => !configuredIdsByName.has(teamName)
  );

  if (missingConfiguredTeams.length === 0) {
    return {
      idsByTeamName: configuredIdsByName,
      namesByApiId: new Map([...configuredIdsByName.entries()].map(([name, id]) => [id, name])),
    };
  }

  const teamsEndpoint = createEndpoint(options.baseUrl, "/teams", {
    league: options.leagueId,
    season: options.season,
  });
  const response = await fetchApiFootballResponse({
    apiKey: options.apiKey,
    endpointName: "teams",
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    url: teamsEndpoint,
  });
  const fetchedEntries = response.flatMap((item) => {
    if (!isRecord(item)) return [];
    const team = isRecord(item.team) ? item.team : undefined;
    const teamId = parseInteger(team?.id);
    const teamName = getProjectTeamNameFromApiTeam(team);

    if (!teamId || !teamName || !requestedTeamNames.has(teamName)) {
      return [];
    }

    return [[teamName, teamId] as const];
  });
  const idsByTeamName = new Map([...configuredIdsByName.entries(), ...fetchedEntries]);

  return {
    idsByTeamName,
    namesByApiId: new Map([...idsByTeamName.entries()].map(([name, id]) => [id, name])),
  };
}

function buildApiFootballSource(
  options: {
    sourceEndpoint: string;
    sourceId: string;
    loadedAt: string;
    notes: string[];
  }
): SquadSource {
  const date = options.loadedAt.slice(0, 10);

  return {
    id: options.sourceId,
    sourceName: "API-Football",
    sourceUrl: options.sourceEndpoint,
    sourceTitle: API_FOOTBALL_SOURCE_TITLE,
    publishedDate: date,
    accessedDate: date,
    notes: [...options.notes],
  };
}

function cloneSource(source: SquadSource): SquadSource {
  return {
    ...source,
    notes: [...source.notes],
  };
}

function cloneCompleteness(completeness: SquadCompleteness): SquadCompleteness {
  return {
    ...completeness,
    notes: [...completeness.notes],
  };
}

function clonePlayers(players: readonly SquadPlayer[]): SquadPlayer[] {
  return players.map((player) => ({
    name: player.name,
    position: player.position,
    ...(player.shirtNumber !== undefined ? { shirtNumber: player.shirtNumber } : {}),
    ...(player.club !== undefined ? { club: player.club } : {}),
    sourceId: player.sourceId,
    source: cloneSource(player.source),
  }));
}

function cloneSquad(squad: TeamSquad): TeamSquad {
  return {
    team: squad.team,
    code: squad.code,
    group: squad.group,
    flagEmoji: squad.flagEmoji,
    sourceId: squad.sourceId,
    source: cloneSource(squad.source),
    completeness: cloneCompleteness(squad.completeness),
    playerCount: squad.playerCount,
    players: clonePlayers(squad.players),
  };
}

function createLocalFallbackSquads(): TeamSquad[] {
  return WC2026_SQUADS.squads.map(cloneSquad);
}

function normalizeApiFootballPlayers(
  rawPlayers: readonly unknown[],
  options: {
    source: SquadSource;
    teamId: number;
  }
): { players: SquadPlayer[]; skippedPlayerCount: number } {
  let skippedPlayerCount = 0;
  const players = rawPlayers.flatMap((rawPlayer) => {
    if (!isRecord(rawPlayer)) {
      skippedPlayerCount += 1;
      return [];
    }

    const name = readString(rawPlayer, "name");
    const position = readString(rawPlayer, "position");

    if (!name || !position) {
      skippedPlayerCount += 1;
      return [];
    }

    const rawNumber = parseInteger(rawPlayer.number);
    const shirtNumber = rawNumber !== undefined && rawNumber >= 1 && rawNumber <= 99 ? rawNumber : undefined;
    const playerId = parseInteger(rawPlayer.id);

    return [
      {
        name,
        position,
        ...(shirtNumber !== undefined ? { shirtNumber } : {}),
        sourceId:
          playerId === undefined
            ? `api-football:team:${options.teamId}:player:${normalizeTeamName(name)}`
            : `api-football:player:${playerId}`,
        source: cloneSource(options.source),
      },
    ];
  });

  return {
    players,
    skippedPlayerCount,
  };
}

function buildExternalSquad(
  localSquad: TeamSquad,
  payload: ApiFootballSquadPayload
): TeamSquad {
  const expectedPlayerCount = localSquad.completeness.expectedPlayerCount;
  const sourceId = `api-football:players-squads:${payload.teamId}`;
  const notes = [
    `Loaded from API-Football players/squads for team id ${payload.teamId}.`,
    "API-Football squad data is informational and does not affect the simulation model automatically.",
    ...(payload.skippedPlayerCount > 0
      ? [`Skipped ${payload.skippedPlayerCount} incomplete API-Football player records.`]
      : []),
  ];
  const source = buildApiFootballSource({
    sourceEndpoint: payload.sourceEndpoint,
    sourceId,
    loadedAt: new Date().toISOString(),
    notes,
  });
  const completenessNotes =
    payload.players.length >= expectedPlayerCount
      ? [
          "API-Football returned at least the expected World Cup squad size.",
          ...(payload.players.length === expectedPlayerCount
            ? []
            : [`API-Football returned ${payload.players.length} players for expected squad size ${expectedPlayerCount}.`]),
          ...notes.slice(1),
        ]
      : [
          `API-Football returned ${payload.players.length} players for expected squad size ${expectedPlayerCount}.`,
          ...notes.slice(1),
        ];

  return {
    team: localSquad.team,
    code: localSquad.code,
    group: localSquad.group,
    flagEmoji: localSquad.flagEmoji,
    sourceId,
    source,
    completeness: {
      status: payload.players.length >= expectedPlayerCount ? "complete" : "incomplete",
      expectedPlayerCount,
      notes: completenessNotes,
    },
    playerCount: payload.players.length,
    players: payload.players.map((player) => ({
      ...player,
      sourceId: player.sourceId,
      source: cloneSource(source),
    })),
  };
}

async function fetchApiFootballSquad(options: {
  apiKey: string;
  baseUrl: string;
  fetchImpl: FetchLike;
  loadedAt: string;
  namesByApiId: ReadonlyMap<number, string>;
  teamId: number;
  timeoutMs: number;
}): Promise<ApiFootballSquadPayload | null> {
  const sourceEndpoint = createEndpoint(options.baseUrl, "/players/squads", { team: options.teamId });
  const response = await fetchApiFootballResponse({
    apiKey: options.apiKey,
    endpointName: "players/squads",
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    url: sourceEndpoint,
  });
  const squadRecord = response.find(isRecord);
  if (!squadRecord) {
    return null;
  }

  const apiTeam = isRecord(squadRecord.team) ? squadRecord.team : undefined;
  const projectTeamName =
    getProjectTeamNameFromApiTeam(apiTeam) ?? options.namesByApiId.get(options.teamId);

  if (!projectTeamName) {
    return null;
  }

  const sourceId = `api-football:players-squads:${options.teamId}`;
  const source = buildApiFootballSource({
    sourceEndpoint,
    sourceId,
    loadedAt: options.loadedAt,
    notes: [
      `Loaded from API-Football players/squads for team id ${options.teamId}.`,
      "API-Football squad data is informational and does not affect the simulation model automatically.",
    ],
  });
  const normalizedPlayers = normalizeApiFootballPlayers(readArray(squadRecord, "players"), {
    source,
    teamId: options.teamId,
  });

  return {
    teamName: projectTeamName,
    teamId: options.teamId,
    players: normalizedPlayers.players,
    skippedPlayerCount: normalizedPlayers.skippedPlayerCount,
    sourceEndpoint,
  };
}

async function loadApiFootballSquads(options: {
  apiKey: string;
  baseUrl: string;
  fetchImpl: FetchLike;
  leagueId: number;
  requestedTeamNames: readonly string[];
  season: number;
  teamIds?: Record<string, number>;
  timeoutMs: number;
}): Promise<TeamSquad[]> {
  const localSquads = createLocalFallbackSquads();
  const localSquadsByTeam = new Map(localSquads.map((squad) => [squad.team, squad]));
  const teamIndex = await loadApiFootballTeamIndex(options);

  if (teamIndex.idsByTeamName.size === 0) {
    throw new Error("API-Football did not return team IDs for the configured World Cup teams");
  }

  const loadedAt = new Date().toISOString();
  const externalSquads: ApiFootballSquadPayload[] = [];

  for (const [teamName, teamId] of teamIndex.idsByTeamName.entries()) {
    if (!localSquadsByTeam.has(teamName)) {
      continue;
    }

    const squad = await fetchApiFootballSquad({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl,
      loadedAt,
      namesByApiId: teamIndex.namesByApiId,
      teamId,
      timeoutMs: options.timeoutMs,
    });

    if (squad) {
      externalSquads.push(squad);
    }
  }

  const externalSquadsByTeam = new Map(externalSquads.map((squad) => [squad.teamName, squad]));

  return localSquads.map((localSquad) => {
    const externalSquad = externalSquadsByTeam.get(localSquad.team);
    return externalSquad ? buildExternalSquad(localSquad, externalSquad) : cloneSquad(localSquad);
  });
}

function buildApiFootballSquadsSnapshot(
  snapshot: ExternalDataSnapshot<TeamSquad[], ApiFootballProvider>
): ApiFootballSquadsSnapshot {
  return {
    squads: snapshot.data.map(cloneSquad),
    provenance: {
      ...snapshot.provenance,
      sourceEndpoint: snapshot.provenance.sourceUrl,
    },
  };
}

export function createOptionalApiFootballSquadsProvider(
  options: CreateApiFootballSquadsProviderOptions = {}
): ApiFootballSquadsProvider | null {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    return null;
  }

  const baseUrl = options.baseUrl ?? DEFAULT_API_FOOTBALL_BASE_URL;
  const cacheTtlMs = Math.max(60_000, Math.trunc(options.cacheTtlMs ?? DEFAULT_API_FOOTBALL_CACHE_TTL_MS));
  const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const leagueId = Math.max(1, Math.trunc(options.leagueId ?? DEFAULT_WORLD_CUP_LEAGUE_ID));
  const season = Math.max(1872, Math.trunc(options.season ?? DEFAULT_WORLD_CUP_SEASON));
  const requestedTeamNames = getRequestedTeamNames(options.teams);
  const squadsEndpoint = createEndpoint(baseUrl, "/players/squads");
  const provider: ExternalDataProvider<TeamSquad[], ApiFootballProvider> = createExternalDataProvider({
    provider: API_FOOTBALL_PROVIDER,
    sourceUrl: squadsEndpoint,
    cacheTtlMs,
    fetchImpl: options.fetchImpl,
    timeoutMs,
    fallbackData: createLocalFallbackSquads(),
    load: async ({ fetchImpl }) => ({
      data: await loadApiFootballSquads({
        apiKey,
        baseUrl,
        fetchImpl,
        leagueId,
        requestedTeamNames,
        season,
        teamIds: options.teamIds,
        timeoutMs,
      }),
      sourceUrl: squadsEndpoint,
    }),
  });

  return {
    async read(readOptions = {}) {
      return buildApiFootballSquadsSnapshot(await provider.read(readOptions));
    },
    peek() {
      return buildApiFootballSquadsSnapshot(provider.peek());
    },
    clear() {
      provider.clear();
    },
  };
}
