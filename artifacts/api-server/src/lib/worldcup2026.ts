import {
  TOURNAMENT_2026,
  type TournamentFixture,
  type TournamentGroup,
  type TournamentTeam,
} from "./tournament-data.js";

export type WCTeam = TournamentTeam;
export type WCFixture = TournamentFixture;
export type WCGroup = TournamentGroup;
export type WCHostCountry = "Canada" | "Mexico" | "United States";

export interface WCHostVenue {
  name: string;
  stadium: string;
  city: string;
  country: WCHostCountry;
  region: string;
  altitudeMeters: number;
  latitude: number;
  longitude: number;
}

const HOST_VENUES = [
  {
    name: "Atlanta",
    stadium: "Mercedes-Benz Stadium",
    city: "Atlanta",
    country: "United States",
    region: "Eastern Region",
    altitudeMeters: 320,
    latitude: 33.7554,
    longitude: -84.4008,
  },
  {
    name: "Boston",
    stadium: "Gillette Stadium",
    city: "Foxborough",
    country: "United States",
    region: "Eastern Region",
    altitudeMeters: 88,
    latitude: 42.0909,
    longitude: -71.2643,
  },
  {
    name: "Dallas",
    stadium: "AT&T Stadium",
    city: "Arlington",
    country: "United States",
    region: "Central Region",
    altitudeMeters: 184,
    latitude: 32.7473,
    longitude: -97.0945,
  },
  {
    name: "Guadalajara",
    stadium: "Estadio Akron",
    city: "Zapopan",
    country: "Mexico",
    region: "Central Region",
    altitudeMeters: 1566,
    latitude: 20.6817,
    longitude: -103.4628,
  },
  {
    name: "Houston",
    stadium: "NRG Stadium",
    city: "Houston",
    country: "United States",
    region: "Central Region",
    altitudeMeters: 15,
    latitude: 29.6847,
    longitude: -95.4107,
  },
  {
    name: "Kansas City",
    stadium: "Arrowhead Stadium",
    city: "Kansas City",
    country: "United States",
    region: "Central Region",
    altitudeMeters: 264,
    latitude: 39.049,
    longitude: -94.4839,
  },
  {
    name: "Los Angeles",
    stadium: "SoFi Stadium",
    city: "Inglewood",
    country: "United States",
    region: "Western Region",
    altitudeMeters: 38,
    latitude: 33.9535,
    longitude: -118.3392,
  },
  {
    name: "Mexico City",
    stadium: "Estadio Azteca",
    city: "Mexico City",
    country: "Mexico",
    region: "Central Region",
    altitudeMeters: 2240,
    latitude: 19.3029,
    longitude: -99.1505,
  },
  {
    name: "Miami",
    stadium: "Hard Rock Stadium",
    city: "Miami Gardens",
    country: "United States",
    region: "Eastern Region",
    altitudeMeters: 2,
    latitude: 25.958,
    longitude: -80.2389,
  },
  {
    name: "Monterrey",
    stadium: "Estadio BBVA",
    city: "Guadalupe",
    country: "Mexico",
    region: "Central Region",
    altitudeMeters: 512,
    latitude: 25.668,
    longitude: -100.2441,
  },
  {
    name: "New York New Jersey",
    stadium: "MetLife Stadium",
    city: "East Rutherford",
    country: "United States",
    region: "Eastern Region",
    altitudeMeters: 2,
    latitude: 40.8135,
    longitude: -74.0745,
  },
  {
    name: "Philadelphia",
    stadium: "Lincoln Financial Field",
    city: "Philadelphia",
    country: "United States",
    region: "Eastern Region",
    altitudeMeters: 7,
    latitude: 39.9008,
    longitude: -75.1675,
  },
  {
    name: "San Francisco Bay Area",
    stadium: "Levi's Stadium",
    city: "Santa Clara",
    country: "United States",
    region: "Western Region",
    altitudeMeters: 2,
    latitude: 37.403,
    longitude: -121.97,
  },
  {
    name: "Seattle",
    stadium: "Lumen Field",
    city: "Seattle",
    country: "United States",
    region: "Western Region",
    altitudeMeters: 4,
    latitude: 47.5952,
    longitude: -122.3316,
  },
  {
    name: "Toronto",
    stadium: "BMO Field",
    city: "Toronto",
    country: "Canada",
    region: "Eastern Region",
    altitudeMeters: 76,
    latitude: 43.6332,
    longitude: -79.4186,
  },
  {
    name: "Vancouver",
    stadium: "BC Place",
    city: "Vancouver",
    country: "Canada",
    region: "Western Region",
    altitudeMeters: 2,
    latitude: 49.2767,
    longitude: -123.1119,
  },
] as const satisfies readonly WCHostVenue[];

const HOST_VENUES_BY_NAME = new Map<string, WCHostVenue>(HOST_VENUES.map((venue) => [venue.name, venue]));

export const WC2026_TOURNAMENT = TOURNAMENT_2026;
export const WC2026_TEAMS: WCTeam[] = TOURNAMENT_2026.teams.map((team) => ({ ...team }));
export const WC2026_FIXTURES: WCFixture[] = TOURNAMENT_2026.fixtures.map((fixture) => ({ ...fixture }));
export const WC2026_GROUPS: WCGroup[] = TOURNAMENT_2026.groups.map((group) => ({
  id: group.id,
  teams: group.teams.map((team) => ({ ...team })),
  fixtures: group.fixtures.map((fixture) => ({ ...fixture })),
}));
export const GROUPS = WC2026_GROUPS.map((group) => group.id);
export const WC2026_HOST_VENUES: WCHostVenue[] = HOST_VENUES.map((venue) => ({ ...venue }));

export function getHostVenueByName(name: string): WCHostVenue | undefined {
  const venue = HOST_VENUES_BY_NAME.get(name);

  return venue ? { ...venue } : undefined;
}

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
