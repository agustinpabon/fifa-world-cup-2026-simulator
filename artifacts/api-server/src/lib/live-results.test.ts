import assert from "node:assert/strict";
import test from "node:test";

import { parseEspnTournamentFeed } from "./live-results.js";

test("ESPN feed parser maps finished and scheduled tournament matches to oracle matches", () => {
  const feed = parseEspnTournamentFeed(
    {
      events: [
        {
          id: "760415",
          date: "2026-06-11T19:00Z",
          season: { slug: "group-stage" },
          competitions: [
            {
              id: "760415",
              status: {
                displayClock: "FT",
                type: { state: "post", completed: true, description: "Full Time", shortDetail: "FT" },
              },
              venue: { fullName: "Estadio Banorte", address: { city: "Mexico City", country: "Mexico" } },
              competitors: [
                {
                  homeAway: "home",
                  score: "3",
                  winner: true,
                  team: { abbreviation: "MEX", displayName: "Mexico" },
                },
                {
                  homeAway: "away",
                  score: "0",
                  winner: false,
                  team: { abbreviation: "RSA", displayName: "South Africa" },
                },
              ],
            },
          ],
        },
        {
          id: "760492",
          date: "2026-06-30T21:00Z",
          season: { slug: "round-of-32" },
          competitions: [
            {
              id: "760492",
              status: {
                displayClock: "0'",
                type: { state: "pre", completed: false, description: "Scheduled", shortDetail: "Scheduled" },
              },
              venue: { fullName: "MetLife Stadium", address: { city: "East Rutherford, New Jersey", country: "USA" } },
              competitors: [
                {
                  homeAway: "home",
                  score: "0",
                  winner: false,
                  team: { abbreviation: "FRA", displayName: "France" },
                },
                {
                  homeAway: "away",
                  score: "0",
                  winner: false,
                  team: { abbreviation: "SWE", displayName: "Sweden" },
                },
              ],
            },
          ],
        },
      ],
    },
    { children: [] }
  );

  assert.equal(feed.matches.length, 2);
  assert.deepEqual(feed.matches[0], {
    matchNumber: 1,
    homeTeam: "Mexico",
    awayTeam: "South Africa",
    homeScore: 3,
    awayScore: 0,
    stage: "Group Stage",
    source: "espn",
    sourceId: "espn:760415",
    date: "2026-06-11",
    kickoffTimeEt: "15:00",
    status: "finished",
    group: "A",
    statusDetail: "FT",
    winnerTeam: "Mexico",
    venue: "Estadio Banorte",
    region: "Mexico City, Mexico",
  });
  assert.equal(feed.matches[1].homeTeam, "France");
  assert.equal(feed.matches[1].awayTeam, "Sweden");
  assert.equal(feed.matches[1].homeScore, -1);
  assert.equal(feed.matches[1].awayScore, -1);
  assert.equal(feed.matches[1].stage, "Round of 32");
  assert.equal(feed.matches[1].status, "scheduled");
});

test("ESPN feed parser marks group eliminated teams and knockout losers", () => {
  const feed = parseEspnTournamentFeed(
    {
      events: [
        {
          id: "760474",
          date: "2026-06-29T20:30Z",
          season: { slug: "round-of-32" },
          competitions: [
            {
              id: "760474",
              status: {
                displayClock: "FT",
                type: { state: "post", completed: true, description: "Full Time", shortDetail: "FT" },
              },
              competitors: [
                {
                  homeAway: "home",
                  score: "1",
                  winner: false,
                  team: { abbreviation: "GER", displayName: "Germany" },
                },
                {
                  homeAway: "away",
                  score: "1",
                  winner: true,
                  team: { abbreviation: "PAR", displayName: "Paraguay" },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      children: [
        {
          standings: {
            entries: [
              {
                team: { abbreviation: "CZE", displayName: "Czechia" },
                note: { description: "Eliminated" },
              },
              {
                team: { abbreviation: "MEX", displayName: "Mexico" },
                note: { description: "Advance to Round of 32" },
              },
            ],
          },
        },
      ],
    }
  );

  assert.equal(feed.matches[0].winnerTeam, "Paraguay");
  assert.deepEqual([...feed.eliminatedTeams].sort(), ["Czechia", "Germany"]);
});
