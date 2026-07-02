import { getFixtureByTeams, WC2026_TEAMS } from "./worldcup2026.js";
import { type PlayedMatch } from "./simulation.js";
import {
  createExternalDataProvider,
  fetchJsonWithTimeout,
  type ExternalDataProvider,
  type ExternalDataProvenance,
  type ExternalDataSnapshot,
  type FetchLike,
  type ReadExternalDataOptions,
} from "./external-data.js";

const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719&limit=200";
const ESPN_STANDINGS_URL =
  "https://site.web.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=2026";
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_CACHE_TTL_MS = 30_000;
const EASTERN_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

type UnknownRecord = Record<string, unknown>;

export type LiveDataProvider = "espn";

export interface LiveDataProviderMetadata extends ExternalDataProvenance<LiveDataProvider> {
  standingsUrl: string;
  matchCount: number;
  eliminatedTeamCount: number;
}

export interface LiveTournamentFeed {
  matches: PlayedMatch[];
  eliminatedTeams: Set<string>;
  metadata: LiveDataProviderMetadata;
}

export interface FetchLiveTournamentFeedOptions {
  fetchImpl?: FetchLike;
  scoreboardUrl?: string;
  standingsUrl?: string;
  timeoutMs?: number;
}

export interface CreateLiveTournamentFeedProviderOptions extends FetchLiveTournamentFeedOptions {
  cacheTtlMs?: number;
}

export interface LiveTournamentFeedProvider {
  read(options?: ReadExternalDataOptions): Promise<LiveTournamentFeed>;
  peek(): LiveTournamentFeed;
  clear(): void;
}

interface LiveTournamentFeedPayload {
  matches: PlayedMatch[];
  eliminatedTeams: Set<string>;
  standingsUrl: string;
}

const TEAM_NAME_BY_CODE = new Map(WC2026_TEAMS.map((team) => [team.code.toUpperCase(), team.name]));
const TEAM_NAME_BY_NORMALIZED_NAME = new Map(
  WC2026_TEAMS.flatMap((team) => [
    [normalizeTeamName(team.name), team.name],
    [normalizeTeamName(team.csvName), team.name],
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
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: UnknownRecord | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function readBoolean(record: UnknownRecord | undefined, key: string): boolean | undefined {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function readArray(record: UnknownRecord | undefined, key: string): unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
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

function mapTeamName(teamRecord: UnknownRecord | undefined): string | undefined {
  const abbreviation = readString(teamRecord, "abbreviation")?.toUpperCase();
  if (abbreviation) {
    const byCode = TEAM_NAME_BY_CODE.get(abbreviation);
    if (byCode) return byCode;
  }

  for (const key of ["displayName", "shortDisplayName", "name", "location"]) {
    const value = readString(teamRecord, key);
    if (!value) continue;

    const normalized = normalizeTeamName(value);
    const byAlias = TEAM_NAME_ALIASES.get(normalized);
    if (byAlias) return byAlias;

    const byName = TEAM_NAME_BY_NORMALIZED_NAME.get(normalized);
    if (byName) return byName;
  }

  return undefined;
}

function parseInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string") return undefined;

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseEventId(event: UnknownRecord, competition: UnknownRecord | undefined): number | undefined {
  return parseInteger(readString(competition, "id") ?? readString(event, "id"));
}

function getStatus(competition: UnknownRecord | undefined): PlayedMatch["status"] {
  const status = isRecord(competition?.status) ? competition.status : undefined;
  const type = isRecord(status?.type) ? status.type : undefined;
  const state = readString(type, "state");
  const completed = readBoolean(type, "completed") ?? false;

  if (completed || state === "post") return "finished";
  if (state === "in") return "live";
  return "scheduled";
}

function getStatusDetail(competition: UnknownRecord | undefined): string | undefined {
  const status = isRecord(competition?.status) ? competition.status : undefined;
  const type = isRecord(status?.type) ? status.type : undefined;

  return readString(type, "shortDetail") ?? readString(type, "description") ?? readString(status, "displayClock");
}

function formatEasternDateTime(dateValue: string | undefined): { date?: string; kickoffTimeEt?: string } {
  if (!dateValue) return {};

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return {};

  const parts = Object.fromEntries(
    EASTERN_TIME_FORMATTER.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    kickoffTimeEt: `${parts.hour}:${parts.minute}`,
  };
}

function mapStage(event: UnknownRecord, competition: UnknownRecord | undefined): string {
  const slug = readString(isRecord(event.season) ? event.season : undefined, "slug") ?? "";
  const note = readString(competition, "altGameNote") ?? "";

  if (slug === "group-stage" || /group/i.test(note)) return "Group Stage";
  if (slug === "round-of-32" || /round of 32/i.test(note)) return "Round of 32";
  if (slug === "round-of-16" || /round of 16|rd of 16/i.test(note)) return "Round of 16";
  if (slug === "quarterfinals" || /quarter/i.test(note)) return "Quarter-Finals";
  if (slug === "semifinals" || /semi/i.test(note)) return "Semi-Finals";
  if (slug === "final" || /final/i.test(note)) return "Final";
  return "Tournament";
}

function getVenue(competition: UnknownRecord | undefined): { venue?: string; region?: string } {
  const venue = isRecord(competition?.venue) ? competition.venue : undefined;
  const address = isRecord(venue?.address) ? venue.address : undefined;
  const city = readString(address, "city");
  const country = readString(address, "country");

  return {
    venue: readString(venue, "fullName") ?? readString(venue, "displayName"),
    region: [city, country].filter(Boolean).join(", ") || undefined,
  };
}

function getCompetitorByHomeAway(
  competitors: readonly unknown[],
  homeAway: "home" | "away"
): UnknownRecord | undefined {
  return competitors.find(
    (competitor): competitor is UnknownRecord =>
      isRecord(competitor) && readString(competitor, "homeAway") === homeAway
  );
}

function parseWinnerTeam(
  home: UnknownRecord,
  away: UnknownRecord,
  status: PlayedMatch["status"]
): string | undefined {
  if (status !== "finished") return undefined;

  if (readBoolean(home, "winner")) {
    return mapTeamName(isRecord(home.team) ? home.team : undefined);
  }

  if (readBoolean(away, "winner")) {
    return mapTeamName(isRecord(away.team) ? away.team : undefined);
  }

  return undefined;
}

function parseEvent(event: unknown): PlayedMatch | undefined {
  if (!isRecord(event)) return undefined;

  const competition = readArray(event, "competitions").find(isRecord);
  const competitors = readArray(competition, "competitors");
  const home = getCompetitorByHomeAway(competitors, "home");
  const away = getCompetitorByHomeAway(competitors, "away");
  if (!home || !away) return undefined;

  const homeTeam = mapTeamName(isRecord(home.team) ? home.team : undefined);
  const awayTeam = mapTeamName(isRecord(away.team) ? away.team : undefined);
  if (!homeTeam || !awayTeam) return undefined;

  const status = getStatus(competition);
  const homeScore = status === "scheduled" ? -1 : parseInteger(readString(home, "score")) ?? 0;
  const awayScore = status === "scheduled" ? -1 : parseInteger(readString(away, "score")) ?? 0;
  const fixture = getFixtureByTeams(homeTeam, awayTeam);
  const eventId = parseEventId(event, competition);
  const { date, kickoffTimeEt } = formatEasternDateTime(readString(event, "date"));
  const { venue, region } = getVenue(competition);

  return {
    matchNumber: fixture?.matchNumber ?? eventId,
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    stage: fixture?.stage === "group" ? "Group Stage" : mapStage(event, competition),
    source: "espn",
    sourceId: eventId === undefined ? undefined : `espn:${eventId}`,
    date,
    kickoffTimeEt,
    status,
    group: fixture?.group,
    venue,
    region,
    statusDetail: getStatusDetail(competition),
    winnerTeam: parseWinnerTeam(home, away, status),
  };
}

function parseStandingsEliminatedTeams(payload: unknown): Set<string> {
  const eliminatedTeams = new Set<string>();
  if (!isRecord(payload)) return eliminatedTeams;

  for (const group of readArray(payload, "children")) {
    if (!isRecord(group)) continue;
    const standings = isRecord(group.standings) ? group.standings : undefined;
    for (const entry of readArray(standings, "entries")) {
      if (!isRecord(entry)) continue;

      const note = isRecord(entry.note) ? entry.note : undefined;
      const description = readString(note, "description") ?? "";
      if (!/eliminated/i.test(description)) continue;

      const teamName = mapTeamName(isRecord(entry.team) ? entry.team : undefined);
      if (teamName) {
        eliminatedTeams.add(teamName);
      }
    }
  }

  return eliminatedTeams;
}

function addKnockoutLosers(matches: readonly PlayedMatch[], eliminatedTeams: Set<string>): Set<string> {
  const next = new Set(eliminatedTeams);

  for (const match of matches) {
    if (match.status !== "finished" || !match.winnerTeam || match.stage === "Group Stage") {
      continue;
    }

    if (match.winnerTeam === match.homeTeam) {
      next.add(match.awayTeam);
    } else if (match.winnerTeam === match.awayTeam) {
      next.add(match.homeTeam);
    }
  }

  return next;
}

function cloneMatches(matches: readonly PlayedMatch[]): PlayedMatch[] {
  return matches.map((match) => ({ ...match }));
}

export function parseEspnTournamentFeed(scoreboardPayload: unknown, standingsPayload: unknown): LiveTournamentFeed {
  const matches = isRecord(scoreboardPayload)
    ? readArray(scoreboardPayload, "events").flatMap((event) => {
        const parsed = parseEvent(event);
        return parsed ? [parsed] : [];
      })
    : [];
  const eliminatedTeams = addKnockoutLosers(matches, parseStandingsEliminatedTeams(standingsPayload));

  return {
    matches,
    eliminatedTeams,
    metadata: {
      provider: "espn",
      sourceUrl: ESPN_SCOREBOARD_URL,
      standingsUrl: ESPN_STANDINGS_URL,
      loadedAt: new Date().toISOString(),
      cacheTtlMs: 0,
      stale: false,
      error: null,
      state: "fresh",
      fallback: "none",
      matchCount: matches.length,
      eliminatedTeamCount: eliminatedTeams.size,
    },
  };
}

export async function fetchEspnTournamentFeed(
  options: FetchLiveTournamentFeedOptions = {}
): Promise<LiveTournamentFeed> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const scoreboardUrl = options.scoreboardUrl ?? ESPN_SCOREBOARD_URL;
  const standingsUrl = options.standingsUrl ?? ESPN_STANDINGS_URL;
  const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const [scoreboardPayload, standingsPayload] = await Promise.all([
    fetchJsonWithTimeout(fetchImpl, scoreboardUrl, timeoutMs),
    fetchJsonWithTimeout(fetchImpl, standingsUrl, timeoutMs),
  ]);
  const parsed = parseEspnTournamentFeed(scoreboardPayload, standingsPayload);

  return {
    ...parsed,
    metadata: {
      ...parsed.metadata,
      sourceUrl: scoreboardUrl,
      standingsUrl,
    },
  };
}

function buildLiveTournamentFeed(
  snapshot: ExternalDataSnapshot<LiveTournamentFeedPayload, LiveDataProvider>
): LiveTournamentFeed {
  return {
    matches: cloneMatches(snapshot.data.matches),
    eliminatedTeams: new Set(snapshot.data.eliminatedTeams),
    metadata: {
      ...snapshot.provenance,
      standingsUrl: snapshot.data.standingsUrl,
      matchCount: snapshot.data.matches.length,
      eliminatedTeamCount: snapshot.data.eliminatedTeams.size,
    },
  };
}

export function createLiveTournamentFeedProvider(
  options: CreateLiveTournamentFeedProviderOptions = {}
): LiveTournamentFeedProvider {
  const scoreboardUrl = options.scoreboardUrl ?? ESPN_SCOREBOARD_URL;
  const standingsUrl = options.standingsUrl ?? ESPN_STANDINGS_URL;
  const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const cacheTtlMs = Math.max(1_000, Math.trunc(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS));
  const provider: ExternalDataProvider<LiveTournamentFeedPayload, LiveDataProvider> = createExternalDataProvider({
    provider: "espn",
    sourceUrl: scoreboardUrl,
    cacheTtlMs,
    fetchImpl: options.fetchImpl,
    timeoutMs,
    fallbackData: {
      matches: [],
      eliminatedTeams: new Set<string>(),
      standingsUrl,
    },
    load: async ({ fetchImpl, sourceUrl, timeoutMs }) => {
      const parsed = await fetchEspnTournamentFeed({
        fetchImpl,
        scoreboardUrl: sourceUrl,
        standingsUrl,
        timeoutMs,
      });

      return {
        data: {
          matches: cloneMatches(parsed.matches),
          eliminatedTeams: new Set(parsed.eliminatedTeams),
          standingsUrl,
        },
        loadedAt: parsed.metadata.loadedAt ?? new Date().toISOString(),
        sourceUrl,
      };
    },
  });

  return {
    async read(readOptions = {}) {
      return buildLiveTournamentFeed(await provider.read(readOptions));
    },
    peek() {
      return buildLiveTournamentFeed(provider.peek());
    },
    clear() {
      provider.clear();
    },
  };
}
