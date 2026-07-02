import assert from "node:assert/strict";
import test from "node:test";

import type { TournamentTeam } from "./tournament-data.js";
import {
  buildMatchesFromPreviousWinners,
  buildRoundOf32Matches,
  getThirdPlaceAssignment,
  GROUP_IDS,
  QUARTER_FINAL_MATCHES,
  ROUND_OF_16_MATCHES,
  SEMI_FINAL_MATCHES,
  THIRD_PLACE_ASSIGNMENT_ROWS,
  THIRD_PLACE_ASSIGNMENT_SLOT_GROUPS,
  type GroupId,
  type KnockoutMatch,
} from "./tournament-format.js";

function combinations<T>(values: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (values.length < size) return [];

  const [first, ...rest] = values;
  const withFirst = combinations(rest, size - 1).map((combination) => [first, ...combination]);
  const withoutFirst = combinations(rest, size);
  return [...withFirst, ...withoutFirst];
}

function makeTeam(name: string, group: GroupId): TournamentTeam {
  return {
    name,
    csvName: name,
    code: name.slice(0, 3).padEnd(3, "_"),
    group,
    flagEmoji: "",
  };
}

function makeTeamMap(prefix: string, groups: readonly GroupId[] = GROUP_IDS): Record<GroupId, TournamentTeam> {
  return Object.fromEntries(groups.map((group) => [group, makeTeam(`${prefix}${group}`, group)])) as Record<
    GroupId,
    TournamentTeam
  >;
}

function getMatch(matches: readonly KnockoutMatch[], matchNumber: number): KnockoutMatch {
  const match = matches.find((candidate) => candidate.matchNumber === matchNumber);
  assert.ok(match, `Expected match ${matchNumber} to exist`);
  return match;
}

function selectHomeWinners(matches: readonly KnockoutMatch[]): Map<number, TournamentTeam> {
  return new Map(matches.map((match) => [match.matchNumber, match.home]));
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

test("third-place assignment table covers every possible eight-group combination", () => {
  const expectedCombinationKeys = combinations(GROUP_IDS, 8).map((combination) => combination.join(""));
  const actualCombinationKeys = THIRD_PLACE_ASSIGNMENT_ROWS.map(([combinationKey]) => combinationKey);

  assert.equal(THIRD_PLACE_ASSIGNMENT_ROWS.length, 495);
  assert.equal(new Set(actualCombinationKeys).size, 495);
  assert.deepEqual(sorted(actualCombinationKeys), sorted(expectedCombinationKeys));

  for (const [combinationKey, assignmentCode] of THIRD_PLACE_ASSIGNMENT_ROWS) {
    assert.equal(combinationKey.length, 8);
    assert.equal(assignmentCode.length, THIRD_PLACE_ASSIGNMENT_SLOT_GROUPS.length);
    assert.deepEqual(sorted(assignmentCode.split("")), sorted(combinationKey.split("")));
  }
});

test("third-place assignment table returns official slot assignments", () => {
  assert.deepEqual(getThirdPlaceAssignment(["E", "F", "G", "H", "I", "J", "K", "L"]), {
    A: "E",
    B: "J",
    D: "I",
    E: "F",
    G: "H",
    I: "G",
    K: "L",
    L: "K",
  });

  assert.deepEqual(getThirdPlaceAssignment(["B", "D", "E", "F", "I", "J", "K", "L"]), {
    A: "E",
    B: "J",
    D: "B",
    E: "D",
    G: "I",
    I: "F",
    K: "L",
    L: "K",
  });

  assert.deepEqual(getThirdPlaceAssignment(["A", "B", "C", "D", "E", "F", "G", "H"]), {
    A: "H",
    B: "G",
    D: "B",
    E: "C",
    G: "A",
    I: "F",
    K: "D",
    L: "E",
  });
});

test("round of 32 bracket uses official fixed matches and third-place assignments", () => {
  const winners = makeTeamMap("1");
  const runners = makeTeamMap("2");
  const thirdPlaceGroups = ["B", "D", "E", "F", "I", "J", "K", "L"] as const;
  const thirdPlaceTeams = makeTeamMap("3", thirdPlaceGroups);

  const matches = buildRoundOf32Matches(winners, runners, thirdPlaceTeams);
  const matchTeams = matches.flatMap((match) => [match.home.name, match.away.name]);
  const expectedQualifiedTeams = [
    ...GROUP_IDS.map((group) => `1${group}`),
    ...GROUP_IDS.map((group) => `2${group}`),
    ...thirdPlaceGroups.map((group) => `3${group}`),
  ];

  assert.equal(matches.length, 16);
  assert.equal(new Set(matchTeams).size, 32);
  assert.deepEqual(sorted(matchTeams), sorted(expectedQualifiedTeams));
  assert.deepEqual(
    matches.map((match) => match.matchNumber),
    [73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88]
  );

  assert.equal(getMatch(matches, 79).home.name, "1A");
  assert.equal(getMatch(matches, 79).away.name, "3E");
  assert.equal(getMatch(matches, 85).home.name, "1B");
  assert.equal(getMatch(matches, 85).away.name, "3J");
  assert.equal(getMatch(matches, 81).home.name, "1D");
  assert.equal(getMatch(matches, 81).away.name, "3B");
  assert.equal(getMatch(matches, 74).home.name, "1E");
  assert.equal(getMatch(matches, 74).away.name, "3D");
  assert.equal(getMatch(matches, 82).home.name, "1G");
  assert.equal(getMatch(matches, 82).away.name, "3I");
  assert.equal(getMatch(matches, 77).home.name, "1I");
  assert.equal(getMatch(matches, 77).away.name, "3F");
  assert.equal(getMatch(matches, 87).home.name, "1K");
  assert.equal(getMatch(matches, 87).away.name, "3L");
  assert.equal(getMatch(matches, 80).home.name, "1L");
  assert.equal(getMatch(matches, 80).away.name, "3K");
  assert.equal(getMatch(matches, 73).venue, "Los Angeles");
  assert.equal(getMatch(matches, 79).venue, "Mexico City");
  assert.equal(getMatch(matches, 85).venue, "Vancouver");
});

test("knockout templates produce official round sizes from exactly 32 teams", () => {
  const r32Matches = buildRoundOf32Matches(makeTeamMap("1"), makeTeamMap("2"), makeTeamMap("3", [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
  ]));
  const r32Teams = r32Matches.flatMap((match) => [match.home.name, match.away.name]);
  assert.equal(new Set(r32Teams).size, 32);

  const r16Matches = buildMatchesFromPreviousWinners(ROUND_OF_16_MATCHES, selectHomeWinners(r32Matches));
  assert.equal(r16Matches.length, 8);
  assert.equal(new Set(r16Matches.flatMap((match) => [match.home.name, match.away.name])).size, 16);

  const quarterFinalMatches = buildMatchesFromPreviousWinners(QUARTER_FINAL_MATCHES, selectHomeWinners(r16Matches));
  assert.equal(quarterFinalMatches.length, 4);
  assert.equal(new Set(quarterFinalMatches.flatMap((match) => [match.home.name, match.away.name])).size, 8);

  const semiFinalMatches = buildMatchesFromPreviousWinners(SEMI_FINAL_MATCHES, selectHomeWinners(quarterFinalMatches));
  assert.equal(semiFinalMatches.length, 2);
  assert.equal(new Set(semiFinalMatches.flatMap((match) => [match.home.name, match.away.name])).size, 4);

  const [finalMatch] = buildMatchesFromPreviousWinners(
    [{ matchNumber: 104, stage: "F", homeSourceMatchNumber: 101, awaySourceMatchNumber: 102 }],
    selectHomeWinners(semiFinalMatches)
  );
  assert.ok(finalMatch);
  assert.equal(new Set([finalMatch.home.name, finalMatch.away.name]).size, 2);
  assert.equal(finalMatch.date, "2026-07-19");
  assert.equal(finalMatch.venue, "New York New Jersey");
});
