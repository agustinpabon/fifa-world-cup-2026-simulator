import rawTournamentData from "../data/fifa-world-cup-2026.v1.json" with { type: "json" };

const EXPECTED_TEAM_COUNT = 48;
const EXPECTED_GROUP_COUNT = 12;
const EXPECTED_TEAMS_PER_GROUP = 4;
const EXPECTED_FIXTURES_PER_GROUP = 6;
export const GROUP_IDS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;
const FIXTURE_STATUSES = ["scheduled", "live", "finished"] as const;

export type GroupId = (typeof GROUP_IDS)[number];
type FixtureStatus = (typeof FIXTURE_STATUSES)[number];

export interface TournamentProvenance {
  sourceName: string;
  sourceUrl: string;
  sourceTitle: string;
  publishedDate: string;
  accessedDate: string;
  notes: string[];
}

export interface TournamentTeam {
  name: string;
  csvName: string;
  code: string;
  group: GroupId;
  flagEmoji: string;
}

export interface TournamentFixture {
  matchNumber: number;
  stage: "group";
  group: GroupId;
  homeTeam: string;
  awayTeam: string;
  date: string;
  kickoffTimeEt: string;
  venue: string;
  region: string;
  status: FixtureStatus;
  sourceId: string;
}

export interface TournamentDataInput {
  schemaVersion: number;
  version: string;
  competition: string;
  hostCountries: string[];
  provenance: TournamentProvenance;
  teams: TournamentTeam[];
  fixtures: TournamentFixture[];
}

export interface TournamentGroup {
  id: GroupId;
  teams: TournamentTeam[];
  fixtures: TournamentFixture[];
}

export interface ValidatedTournamentData extends TournamentDataInput {
  groups: TournamentGroup[];
  raw: TournamentDataInput;
}

type UnknownRecord = Record<string, unknown>;

export class TournamentDataValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid tournament data:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "TournamentDataValidationError";
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

function readNumber(record: UnknownRecord, key: string, issues: string[], path: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    issues.push(`${path}.${key} must be an integer`);
    return Number.NaN;
  }
  return value;
}

function readGroupId(record: UnknownRecord, key: string, issues: string[], path: string): GroupId {
  const value = readString(record, key, issues, path);
  if (!GROUP_IDS.includes(value as GroupId)) {
    issues.push(`${path}.${key} must be one of ${GROUP_IDS.join(", ")}`);
    return "A";
  }
  return value as GroupId;
}

function readStatus(record: UnknownRecord, key: string, issues: string[], path: string): FixtureStatus {
  const value = readString(record, key, issues, path);
  if (!FIXTURE_STATUSES.includes(value as FixtureStatus)) {
    issues.push(`${path}.${key} must be one of ${FIXTURE_STATUSES.join(", ")}`);
    return "scheduled";
  }
  return value as FixtureStatus;
}

function readStringArray(record: UnknownRecord, key: string, issues: string[], path: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    issues.push(`${path}.${key} must be an array of non-empty strings`);
    return [];
  }
  return [...value];
}

function parseProvenance(value: unknown, issues: string[]): TournamentProvenance {
  if (!isRecord(value)) {
    issues.push("provenance must be an object");
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
    sourceName: readString(value, "sourceName", issues, "provenance"),
    sourceUrl: readString(value, "sourceUrl", issues, "provenance"),
    sourceTitle: readString(value, "sourceTitle", issues, "provenance"),
    publishedDate: readString(value, "publishedDate", issues, "provenance"),
    accessedDate: readString(value, "accessedDate", issues, "provenance"),
    notes: readStringArray(value, "notes", issues, "provenance"),
  };
}

function parseTeams(value: unknown, issues: string[]): TournamentTeam[] {
  if (!Array.isArray(value)) {
    issues.push("teams must be an array");
    return [];
  }

  return value.flatMap((team, index) => {
    const path = `teams[${index}]`;
    if (!isRecord(team)) {
      issues.push(`${path} must be an object`);
      return [];
    }

    return [
      {
        name: readString(team, "name", issues, path),
        csvName: readString(team, "csvName", issues, path),
        code: readString(team, "code", issues, path),
        group: readGroupId(team, "group", issues, path),
        flagEmoji: readString(team, "flagEmoji", issues, path),
      },
    ];
  });
}

function parseFixtures(value: unknown, issues: string[]): TournamentFixture[] {
  if (!Array.isArray(value)) {
    issues.push("fixtures must be an array");
    return [];
  }

  return value.flatMap((fixture, index) => {
    const path = `fixtures[${index}]`;
    if (!isRecord(fixture)) {
      issues.push(`${path} must be an object`);
      return [];
    }

    const stage = readString(fixture, "stage", issues, path);
    if (stage !== "group") {
      issues.push(`${path}.stage must be group`);
    }

    return [
      {
        matchNumber: readNumber(fixture, "matchNumber", issues, path),
        stage: "group",
        group: readGroupId(fixture, "group", issues, path),
        homeTeam: readString(fixture, "homeTeam", issues, path),
        awayTeam: readString(fixture, "awayTeam", issues, path),
        date: readString(fixture, "date", issues, path),
        kickoffTimeEt: readString(fixture, "kickoffTimeEt", issues, path),
        venue: readString(fixture, "venue", issues, path),
        region: readString(fixture, "region", issues, path),
        status: readStatus(fixture, "status", issues, path),
        sourceId: readString(fixture, "sourceId", issues, path),
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

function getPairKey(teamA: string, teamB: string): string {
  return [teamA, teamB].sort().join("|");
}

function validateFixtureReferences(teams: TournamentTeam[], fixtures: TournamentFixture[], issues: string[]): void {
  const teamsByName = new Map(teams.map((team) => [team.name, team]));

  for (const fixture of fixtures) {
    const home = teamsByName.get(fixture.homeTeam);
    const away = teamsByName.get(fixture.awayTeam);
    const label = `fixture ${fixture.matchNumber}`;

    if (fixture.homeTeam === fixture.awayTeam) {
      issues.push(`${label} must reference two distinct teams`);
    }
    if (!home) {
      issues.push(`${label} references unknown home team: ${fixture.homeTeam}`);
    }
    if (!away) {
      issues.push(`${label} references unknown away team: ${fixture.awayTeam}`);
    }
    if (home && home.group !== fixture.group) {
      issues.push(`${label} home team ${fixture.homeTeam} is not in Group ${fixture.group}`);
    }
    if (away && away.group !== fixture.group) {
      issues.push(`${label} away team ${fixture.awayTeam} is not in Group ${fixture.group}`);
    }
    if (home && away && home.group !== away.group) {
      issues.push(`${label} must contain teams from the same group`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fixture.date)) {
      issues.push(`${label} date must be YYYY-MM-DD`);
    }
    if (!/^\d{2}:\d{2}$/.test(fixture.kickoffTimeEt)) {
      issues.push(`${label} kickoffTimeEt must be HH:mm`);
    }
  }
}

function validateGroupFixtureCoverage(
  teams: TournamentTeam[],
  fixtures: TournamentFixture[],
  issues: string[]
): TournamentGroup[] {
  const groups = GROUP_IDS.map((id) => ({
    id,
    teams: teams.filter((team) => team.group === id),
    fixtures: fixtures.filter((fixture) => fixture.group === id),
  }));

  for (const group of groups) {
    if (group.teams.length !== EXPECTED_TEAMS_PER_GROUP) {
      issues.push(`Group ${group.id} must contain ${EXPECTED_TEAMS_PER_GROUP} teams`);
    }
    if (group.fixtures.length !== EXPECTED_FIXTURES_PER_GROUP) {
      issues.push(`Group ${group.id} must contain ${EXPECTED_FIXTURES_PER_GROUP} fixtures`);
    }

    const expectedPairs = new Set<string>();
    for (let i = 0; i < group.teams.length; i++) {
      for (let j = i + 1; j < group.teams.length; j++) {
        expectedPairs.add(getPairKey(group.teams[i].name, group.teams[j].name));
      }
    }

    const actualPairs = new Set(group.fixtures.map((fixture) => getPairKey(fixture.homeTeam, fixture.awayTeam)));
    for (const pair of expectedPairs) {
      if (!actualPairs.has(pair)) {
        issues.push(`Group ${group.id} is missing fixture pair ${pair}`);
      }
    }
  }

  return groups;
}

export function validateTournamentData(value: unknown): ValidatedTournamentData {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new TournamentDataValidationError(["Tournament data must be an object"]);
  }

  const schemaVersion = readNumber(value, "schemaVersion", issues, "tournament");
  const version = readString(value, "version", issues, "tournament");
  const competition = readString(value, "competition", issues, "tournament");
  const hostCountries = readStringArray(value, "hostCountries", issues, "tournament");
  const provenance = parseProvenance(value.provenance, issues);
  const teams = parseTeams(value.teams, issues);
  const fixtures = parseFixtures(value.fixtures, issues);

  assertUnique(teams.map((team) => team.name), "teams.name", issues);
  assertUnique(teams.map((team) => team.code), "teams.code", issues);
  assertUnique(teams.map((team) => team.csvName), "teams.csvName", issues);
  assertUnique(fixtures.map((fixture) => String(fixture.matchNumber)), "fixtures.matchNumber", issues);

  const groupIds = new Set(teams.map((team) => team.group));
  if (teams.length !== EXPECTED_TEAM_COUNT || groupIds.size !== EXPECTED_GROUP_COUNT) {
    issues.push(
      `Tournament data must define ${EXPECTED_TEAM_COUNT} teams and ${EXPECTED_GROUP_COUNT} groups of ${EXPECTED_TEAMS_PER_GROUP}`
    );
  }
  if (fixtures.length !== EXPECTED_GROUP_COUNT * EXPECTED_FIXTURES_PER_GROUP) {
    issues.push(`Tournament data must define ${EXPECTED_GROUP_COUNT * EXPECTED_FIXTURES_PER_GROUP} group fixtures`);
  }

  validateFixtureReferences(teams, fixtures, issues);
  const groups = validateGroupFixtureCoverage(teams, fixtures, issues);

  if (issues.length > 0) {
    throw new TournamentDataValidationError(issues);
  }

  const raw: TournamentDataInput = {
    schemaVersion,
    version,
    competition,
    hostCountries,
    provenance,
    teams,
    fixtures,
  };

  return {
    ...raw,
    teams: teams.map((team) => ({ ...team })),
    fixtures: fixtures.map((fixture) => ({ ...fixture })),
    groups: groups.map((group) => ({
      id: group.id,
      teams: group.teams.map((team) => ({ ...team })),
      fixtures: group.fixtures.map((fixture) => ({ ...fixture })),
    })),
    raw,
  };
}

export const TOURNAMENT_2026 = validateTournamentData(rawTournamentData);
