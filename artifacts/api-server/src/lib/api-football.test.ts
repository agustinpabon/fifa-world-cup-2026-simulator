import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_API_FOOTBALL_CACHE_TTL_MS,
  createOptionalApiFootballSquadsProvider,
} from "./api-football.js";
import type { FetchLike } from "./external-data.js";

const TEST_API_FOOTBALL_KEY = ["api", "football", "test", "token"].join("-");

function getHeaderValue(headers: RequestInit["headers"] | undefined, key: string): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(key);
  if (Array.isArray(headers)) {
    return headers.find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1] ?? null;
  }

  const value = Object.entries(headers).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];
  return typeof value === "string" ? value : null;
}

test("API-Football squads provider is disabled when API_FOOTBALL_KEY is absent", () => {
  let fetchCalled = false;
  const provider = createOptionalApiFootballSquadsProvider({
    apiKey: "   ",
    fetchImpl: async () => {
      fetchCalled = true;
      return Response.json({});
    },
  });

  assert.equal(provider, null);
  assert.equal(fetchCalled, false);
});

test("API-Football squads provider normalizes mocked squads and reuses cache", async () => {
  const requestedUrls: string[] = [];
  const requestedKeys: Array<string | null> = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    requestedUrls.push(url.toString());
    requestedKeys.push(getHeaderValue(init?.headers, "x-apisports-key"));

    if (url.pathname === "/teams") {
      return Response.json({
        errors: [],
        response: [
          {
            team: {
              id: 1001,
              name: "Mexico",
              code: "MEX",
            },
          },
        ],
      });
    }

    assert.equal(url.pathname, "/players/squads");
    assert.equal(url.searchParams.get("team"), "1001");
    return Response.json({
      errors: [],
      response: [
        {
          team: {
            id: 1001,
            name: "Mexico",
          },
          players: [
            {
              id: 1,
              name: "Guillermo Ochoa",
              number: 13,
              position: "Goalkeeper",
            },
            {
              id: 2,
              name: "Santiago Gimenez",
              number: 11,
              position: "Attacker",
            },
          ],
        },
      ],
    });
  };
  const provider = createOptionalApiFootballSquadsProvider({
    apiKey: TEST_API_FOOTBALL_KEY,
    baseUrl: "https://v3.football.api-sports.io",
    cacheTtlMs: DEFAULT_API_FOOTBALL_CACHE_TTL_MS,
    fetchImpl,
    teams: ["Mexico"],
  });

  assert.ok(provider);
  const first = await provider.read();
  const second = await provider.read();
  const mexico = first.squads.find((squad) => squad.team === "Mexico");

  assert.equal(requestedUrls.length, 2);
  assert.deepEqual(requestedKeys, [TEST_API_FOOTBALL_KEY, TEST_API_FOOTBALL_KEY]);
  assert.equal(second.provenance.state, "fresh");
  assert.equal(first.provenance.provider, "api-football");
  assert.equal(first.provenance.stale, false);
  assert.equal(first.provenance.error, null);
  assert.equal(first.provenance.cacheTtlMs, DEFAULT_API_FOOTBALL_CACHE_TTL_MS);
  assert.match(first.provenance.sourceEndpoint, /\/players\/squads$/);
  assert.ok(mexico);
  assert.equal(mexico.players.length, 2);
  assert.equal(mexico.players[0]?.name, "Guillermo Ochoa");
  assert.equal(mexico.players[0]?.shirtNumber, 13);
  assert.equal(mexico.players[0]?.source.sourceName, "API-Football");
});

test("API-Football squads provider falls back to local snapshots on rate-limit responses", async () => {
  const provider = createOptionalApiFootballSquadsProvider({
    apiKey: TEST_API_FOOTBALL_KEY,
    fetchImpl: async () => new Response("rate limited", { status: 429 }),
    teams: ["Mexico"],
  });

  assert.ok(provider);
  const snapshot = await provider.read();
  const mexico = snapshot.squads.find((squad) => squad.team === "Mexico");

  assert.ok(mexico);
  assert.equal(mexico.players.length, 0);
  assert.equal(snapshot.provenance.provider, "api-football");
  assert.equal(snapshot.provenance.state, "error");
  assert.equal(snapshot.provenance.stale, true);
  assert.equal(snapshot.provenance.fallback, "local-data");
  assert.match(String(snapshot.provenance.error), /http 429/i);
});

test("API-Football squads provider tolerates incomplete player payloads", async () => {
  const provider = createOptionalApiFootballSquadsProvider({
    apiKey: TEST_API_FOOTBALL_KEY,
    fetchImpl: async (input) => {
      const url = new URL(input);

      if (url.pathname === "/teams") {
        return Response.json({
          errors: [],
          response: [{ team: { id: 1001, name: "Mexico", code: "MEX" } }],
        });
      }

      return Response.json({
        errors: [],
        response: [
          {
            team: { id: 1001, name: "Mexico" },
            players: [
              { id: 1, name: "Valid Player", position: "Midfielder" },
              { id: 2, name: "Missing Position" },
              { id: 3, position: "Defender" },
            ],
          },
        ],
      });
    },
    teams: ["Mexico"],
  });

  assert.ok(provider);
  const snapshot = await provider.read();
  const mexico = snapshot.squads.find((squad) => squad.team === "Mexico");

  assert.ok(mexico);
  assert.equal(snapshot.provenance.state, "fresh");
  assert.equal(mexico.players.length, 1);
  assert.equal(mexico.players[0]?.name, "Valid Player");
  assert.equal(mexico.players[0]?.shirtNumber, undefined);
  assert.ok(mexico.completeness.notes.some((note) => /skipped 2 incomplete/i.test(note)));
});
