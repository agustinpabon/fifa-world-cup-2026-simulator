import assert from "node:assert/strict";
import test from "node:test";

import type { PlayedMatch } from "./simulation.js";
import { createMatchContextService } from "./match-context.js";
import type { FetchLike } from "./external-data.js";

const SCHEDULED_FIXTURE: PlayedMatch = {
  matchNumber: 901,
  homeTeam: "Mexico",
  awayTeam: "South Africa",
  homeScore: -1,
  awayScore: -1,
  stage: "Group Stage",
  source: "fixture",
  sourceId: "fixture:901",
  date: "2026-06-14",
  kickoffTimeEt: "15:00",
  status: "scheduled",
  group: "A",
  venue: "Toronto",
  region: "Eastern Region",
};

test("match context returns cached Open-Meteo weather for fixtures inside forecast horizon", async () => {
  let fetchCount = 0;
  let requestedUrl = "";
  const fetchImpl: FetchLike = async (input) => {
    fetchCount += 1;
    requestedUrl = String(input);

    return Response.json({
      hourly: {
        time: ["2026-06-14T14:00", "2026-06-14T15:00", "2026-06-14T16:00"],
        temperature_2m: [23.1, 24.6, 25.0],
        precipitation: [0, 0.8, 0.2],
        rain: [0, 0.4, 0.1],
        wind_speed_10m: [10.5, 18.2, 16.9],
        precipitation_probability: [10, 45, 35],
      },
    });
  };

  const service = createMatchContextService({
    fetchImpl,
    now: () => new Date("2026-06-10T12:00:00.000Z"),
    cacheTtlMs: 60_000,
  });

  const first = await service.getMatchContext(SCHEDULED_FIXTURE);
  const second = await service.getMatchContext(SCHEDULED_FIXTURE);

  assert.equal(fetchCount, 1);
  assert.match(requestedUrl, /open-meteo/i);
  assert.match(requestedUrl, /forecast_days=16/i);
  assert.equal(first.fixture.matchNumber, 901);
  assert.equal(first.venue?.stadium, "BMO Field");
  assert.equal(first.weather.status, "available");
  assert.equal(first.weather.reason, undefined);
  assert.equal(first.weather.provenance.provider, "open-meteo");
  assert.equal(first.weather.provenance.state, "fresh");
  assert.equal(first.weather.provenance.error, null);
  assert.equal(first.weather.forecast?.forecastTimeEt, "2026-06-14T15:00");
  assert.equal(first.weather.forecast?.temperatureC, 24.6);
  assert.equal(first.weather.forecast?.precipitationMm, 0.8);
  assert.equal(first.weather.forecast?.rainMm, 0.4);
  assert.equal(first.weather.forecast?.windSpeed10mKph, 18.2);
  assert.equal(first.weather.forecast?.precipitationProbabilityPct, 45);
  assert.deepEqual(second.weather.forecast, first.weather.forecast);
});

test("match context returns unavailable when the fixture venue is missing", async () => {
  let fetchCalled = false;
  const fetchImpl: FetchLike = async () => {
    fetchCalled = true;
    throw new Error("fetch should not run without a venue");
  };
  const service = createMatchContextService({
    fetchImpl,
    now: () => new Date("2026-06-10T12:00:00.000Z"),
  });

  const context = await service.getMatchContext({
    ...SCHEDULED_FIXTURE,
    venue: undefined,
    region: undefined,
  });

  assert.equal(fetchCalled, false);
  assert.equal(context.venue, null);
  assert.equal(context.weather.status, "unavailable");
  assert.equal(context.weather.reason, "venue_unavailable");
  assert.equal(context.weather.forecast, null);
  assert.equal(context.weather.provenance.loadedAt, null);
  assert.equal(context.weather.provenance.state, "idle");
  assert.equal(context.weather.provenance.error, null);
});

test("match context returns provider errors when Open-Meteo is unavailable", async () => {
  const service = createMatchContextService({
    fetchImpl: async () => new Response("upstream unavailable", { status: 503 }),
    now: () => new Date("2026-06-10T12:00:00.000Z"),
  });

  const context = await service.getMatchContext(SCHEDULED_FIXTURE);

  assert.equal(context.weather.status, "unavailable");
  assert.equal(context.weather.reason, "provider_error");
  assert.equal(context.weather.forecast, null);
  assert.equal(context.weather.provenance.provider, "open-meteo");
  assert.equal(context.weather.provenance.state, "error");
  assert.equal(context.weather.provenance.stale, true);
  assert.equal(context.weather.provenance.loadedAt, null);
  assert.match(String(context.weather.provenance.error), /http 503/i);
});

test("match context returns unavailable when the fixture is outside the Open-Meteo forecast horizon", async () => {
  let fetchCalled = false;
  const service = createMatchContextService({
    fetchImpl: async () => {
      fetchCalled = true;
      return Response.json({});
    },
    now: () => new Date("2026-06-01T12:00:00.000Z"),
  });

  const context = await service.getMatchContext({
    ...SCHEDULED_FIXTURE,
    date: "2026-06-25",
  });

  assert.equal(fetchCalled, false);
  assert.equal(context.weather.status, "unavailable");
  assert.equal(context.weather.reason, "outside_forecast_horizon");
  assert.equal(context.weather.forecast, null);
  assert.equal(context.weather.provenance.loadedAt, null);
  assert.equal(context.weather.provenance.state, "idle");
});
