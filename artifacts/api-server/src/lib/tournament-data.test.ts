import assert from "node:assert/strict";
import test from "node:test";

import { buildFixtureMatches } from "./elo.js";
import { TOURNAMENT_2026, TournamentDataValidationError, validateTournamentData } from "./tournament-data.js";
import { WC2026_HOST_VENUES, getHostVenueByName } from "./worldcup2026.js";

test("validated 2026 data has 48 unique teams in 12 groups of 4", () => {
  assert.equal(TOURNAMENT_2026.teams.length, 48);
  assert.equal(new Set(TOURNAMENT_2026.teams.map((team) => team.name)).size, 48);
  assert.equal(new Set(TOURNAMENT_2026.teams.map((team) => team.code)).size, 48);

  const groupCounts = new Map<string, number>();
  for (const team of TOURNAMENT_2026.teams) {
    groupCounts.set(team.group, (groupCounts.get(team.group) ?? 0) + 1);
  }

  assert.equal(groupCounts.size, 12);
  assert.deepEqual([...groupCounts.values()], new Array(12).fill(4));
});

test("validated 2026 data has complete group fixture coverage", () => {
  assert.equal(TOURNAMENT_2026.fixtures.length, 72);
  assert.equal(new Set(TOURNAMENT_2026.fixtures.map((fixture) => fixture.matchNumber)).size, 72);

  for (const group of TOURNAMENT_2026.groups) {
    assert.equal(group.fixtures.length, 6, `Group ${group.id} should have six fixtures`);

    const expectedPairs = new Set<string>();
    for (let i = 0; i < group.teams.length; i++) {
      for (let j = i + 1; j < group.teams.length; j++) {
        expectedPairs.add([group.teams[i].name, group.teams[j].name].sort().join("|"));
      }
    }

    const actualPairs = new Set(
      group.fixtures.map((fixture) => [fixture.homeTeam, fixture.awayTeam].sort().join("|"))
    );

    assert.deepEqual(actualPairs, expectedPairs);
  }
});

test("host venue metadata covers every 2026 host city with altitude and coordinates", () => {
  assert.equal(WC2026_HOST_VENUES.length, 16);

  const venueNames = new Set(WC2026_HOST_VENUES.map((venue) => venue.name));
  const fixtureVenueNames = new Set(TOURNAMENT_2026.fixtures.map((fixture) => fixture.venue));

  assert.deepEqual(venueNames, fixtureVenueNames);

  const mexicoCity = getHostVenueByName("Mexico City");
  const guadalajara = getHostVenueByName("Guadalajara");

  assert.ok(mexicoCity);
  assert.equal(mexicoCity.altitudeMeters, 2240);
  assert.equal(mexicoCity.country, "Mexico");
  assert.ok(guadalajara);
  assert.equal(guadalajara.altitudeMeters, 1566);

  for (const venue of WC2026_HOST_VENUES) {
    assert.ok(Number.isFinite(venue.latitude), `${venue.name} latitude should be finite`);
    assert.ok(Number.isFinite(venue.longitude), `${venue.name} longitude should be finite`);
    assert.ok(Number.isFinite(venue.altitudeMeters), `${venue.name} altitude should be finite`);
  }
});

test("fixture with no result remains scheduled imported fixture data", () => {
  const fixture = TOURNAMENT_2026.fixtures[0];
  const [match] = buildFixtureMatches([{ ...fixture, status: "live" }]);

  assert.equal(match.homeTeam, fixture.homeTeam);
  assert.equal(match.awayTeam, fixture.awayTeam);
  assert.equal(match.homeScore, -1);
  assert.equal(match.awayScore, -1);
  assert.equal(match.status, "scheduled");
  assert.equal(match.source, "fixture");
});

test("validator rejects missing teams, groups, and inconsistent fixtures", () => {
  const invalid = {
    ...TOURNAMENT_2026.raw,
    teams: TOURNAMENT_2026.raw.teams.slice(1),
    fixtures: [
      {
        ...TOURNAMENT_2026.raw.fixtures[0],
        awayTeam: TOURNAMENT_2026.raw.fixtures[0].homeTeam,
      },
    ],
  };

  assert.throws(
    () => validateTournamentData(invalid),
    (error: unknown) => {
      assert.ok(error instanceof TournamentDataValidationError);
      assert.ok(error.issues.some((issue) => issue.includes("48 teams")));
      assert.ok(error.issues.some((issue) => issue.includes("12 groups")));
      assert.ok(error.issues.some((issue) => issue.includes("distinct teams")));
      return true;
    }
  );
});
