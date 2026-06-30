import {
  TOURNAMENT_2026,
  type TournamentFixture,
  type TournamentGroup,
  type TournamentTeam,
} from "./tournament-data.js";

export type WCTeam = TournamentTeam;
export type WCFixture = TournamentFixture;
export type WCGroup = TournamentGroup;

export const WC2026_TOURNAMENT = TOURNAMENT_2026;
export const WC2026_TEAMS: WCTeam[] = TOURNAMENT_2026.teams.map((team) => ({ ...team }));
export const WC2026_FIXTURES: WCFixture[] = TOURNAMENT_2026.fixtures.map((fixture) => ({ ...fixture }));
export const WC2026_GROUPS: WCGroup[] = TOURNAMENT_2026.groups.map((group) => ({
  id: group.id,
  teams: group.teams.map((team) => ({ ...team })),
  fixtures: group.fixtures.map((fixture) => ({ ...fixture })),
}));
export const GROUPS = WC2026_GROUPS.map((group) => group.id);

export function getTeamByCsvName(csvName: string): WCTeam | undefined {
  return WC2026_TEAMS.find((team) => team.csvName === csvName);
}

export function getTeamByName(name: string): WCTeam | undefined {
  return WC2026_TEAMS.find((team) => team.name === name);
}

export function getGroupById(groupId: string): WCGroup | undefined {
  return WC2026_GROUPS.find((group) => group.id === groupId);
}

export function getGroupFixtures(groupId: string): WCFixture[] {
  return WC2026_FIXTURES.filter((fixture) => fixture.group === groupId).map((fixture) => ({ ...fixture }));
}

export function getFixtureByTeams(teamA: string, teamB: string): WCFixture | undefined {
  return WC2026_FIXTURES.find(
    (fixture) =>
      (fixture.homeTeam === teamA && fixture.awayTeam === teamB) ||
      (fixture.homeTeam === teamB && fixture.awayTeam === teamA)
  );
}
