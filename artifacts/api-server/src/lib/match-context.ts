import {
  createExternalDataProvider,
  fetchJsonWithTimeout,
  type ExternalDataProvenance,
  type ExternalDataProvider,
  type ExternalDataSnapshot,
  type FetchLike,
} from "./external-data.js";
import { getHostVenueByName, type WCHostVenue } from "./worldcup2026.js";
import type { PlayedMatch } from "./simulation.js";

const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const DEFAULT_FORECAST_DAYS = 16;
const DEFAULT_CACHE_TTL_MS = 15 * 60_000;
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_TIMEZONE = "America/New_York";
const MATCH_CONTEXT_HOURLY_VARIABLES = [
  "temperature_2m",
  "precipitation",
  "rain",
  "wind_speed_10m",
  "precipitation_probability",
] as const;
const DATE_TIME_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

type UnknownRecord = Record<string, unknown>;
type MatchContextProvider = "open-meteo";
type MatchContextForecastPayload = {
  time: string[];
  temperature_2m?: Array<number | null>;
  precipitation?: Array<number | null>;
  rain?: Array<number | null>;
  wind_speed_10m?: Array<number | null>;
  precipitation_probability?: Array<number | null>;
};

export type MatchWeatherStatus = "available" | "unavailable";
export type MatchWeatherUnavailableReason =
  | "outside_forecast_horizon"
  | "venue_unavailable"
  | "provider_error"
  | "forecast_missing";

export interface MatchContextFixture
  extends Pick<
    PlayedMatch,
    | "matchNumber"
    | "homeTeam"
    | "awayTeam"
    | "stage"
    | "source"
    | "sourceId"
    | "date"
    | "kickoffTimeEt"
    | "status"
    | "group"
    | "venue"
    | "region"
  > {}

export interface MatchWeatherForecast {
  forecastTimeEt: string;
  temperatureC: number | null;
  precipitationMm: number | null;
  rainMm: number | null;
  windSpeed10mKph: number | null;
  precipitationProbabilityPct: number | null;
}

export interface MatchWeatherSnapshot {
  provider: MatchContextProvider;
  status: MatchWeatherStatus;
  reason?: MatchWeatherUnavailableReason;
  forecast: MatchWeatherForecast | null;
  provenance: ExternalDataProvenance<MatchContextProvider>;
}

export interface MatchContextSnapshot {
  fixture: MatchContextFixture;
  venue: WCHostVenue | null;
  weather: MatchWeatherSnapshot;
}

export interface CreateMatchContextServiceOptions {
  apiBaseUrl?: string;
  cacheTtlMs?: number;
  fetchImpl?: FetchLike;
  forecastDays?: number;
  now?: () => Date;
  timeoutMs?: number;
  timezone?: string;
}

export interface MatchContextService {
  getMatchContext(fixture: MatchContextFixture): Promise<MatchContextSnapshot>;
  clear(): void;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(record: UnknownRecord, key: string): string[] {
  const value = record[key];

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Open-Meteo payload field "${key}" must be an array of strings`);
  }

  return [...value];
}

function readNullableNumberArray(record: UnknownRecord, key: string): Array<number | null> | undefined {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Open-Meteo payload field "${key}" must be an array when present`);
  }

  return value.map((item) => {
    if (item === null) {
      return null;
    }

    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error(`Open-Meteo payload field "${key}" must contain only numbers or null`);
    }

    return item;
  });
}

function cloneVenue(venue: WCHostVenue | null): WCHostVenue | null {
  return venue ? { ...venue } : null;
}

function cloneFixture(fixture: MatchContextFixture): MatchContextFixture {
  return { ...fixture };
}

function cloneForecast(forecast: MatchWeatherForecast | null): MatchWeatherForecast | null {
  return forecast ? { ...forecast } : null;
}

function getDateFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = DATE_TIME_FORMATTER_CACHE.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  DATE_TIME_FORMATTER_CACHE.set(timeZone, formatter);

  return formatter;
}

function getLocalDateString(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    getDateFormatter(timeZone).formatToParts(date).map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseUtcDateDay(date: string): number | null {
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.floor(timestamp / 86_400_000);
}

function isWithinForecastHorizon(
  fixtureDate: string | undefined,
  now: Date,
  timeZone: string,
  forecastDays: number
): boolean {
  if (!fixtureDate) {
    return false;
  }

  const fixtureDay = parseUtcDateDay(fixtureDate);
  const todayDay = parseUtcDateDay(getLocalDateString(now, timeZone));

  if (fixtureDay === null || todayDay === null) {
    return false;
  }

  const dayOffset = fixtureDay - todayDay;
  return dayOffset >= 0 && dayOffset < forecastDays;
}

function buildForecastUrl(
  venue: WCHostVenue,
  options: {
    apiBaseUrl: string;
    forecastDays: number;
    timezone: string;
  }
): string {
  const url = new URL(options.apiBaseUrl);
  url.searchParams.set("latitude", String(venue.latitude));
  url.searchParams.set("longitude", String(venue.longitude));
  url.searchParams.set("forecast_days", String(options.forecastDays));
  url.searchParams.set("timezone", options.timezone);
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("precipitation_unit", "mm");
  url.searchParams.set("hourly", MATCH_CONTEXT_HOURLY_VARIABLES.join(","));

  return url.toString();
}

function createBaseProvenance(
  sourceUrl: string,
  cacheTtlMs: number
): ExternalDataProvenance<MatchContextProvider> {
  return {
    provider: "open-meteo",
    loadedAt: null,
    sourceUrl,
    cacheTtlMs,
    stale: false,
    error: null,
    state: "idle",
    fallback: "none",
  };
}

function parseOpenMeteoForecastPayload(payload: unknown): MatchContextForecastPayload {
  if (!isRecord(payload)) {
    throw new Error("Open-Meteo payload must be an object");
  }

  const hourly = payload.hourly;
  if (!isRecord(hourly)) {
    throw new Error('Open-Meteo payload must contain an "hourly" object');
  }

  return {
    time: readStringArray(hourly, "time"),
    temperature_2m: readNullableNumberArray(hourly, "temperature_2m"),
    precipitation: readNullableNumberArray(hourly, "precipitation"),
    rain: readNullableNumberArray(hourly, "rain"),
    wind_speed_10m: readNullableNumberArray(hourly, "wind_speed_10m"),
    precipitation_probability: readNullableNumberArray(hourly, "precipitation_probability"),
  };
}

function readSeriesValue(series: Array<number | null> | undefined, index: number): number | null {
  if (!series) {
    return null;
  }

  return series[index] ?? null;
}

function selectFixtureForecast(
  payload: MatchContextForecastPayload,
  fixture: MatchContextFixture
): MatchWeatherForecast | null {
  if (!fixture.date || !fixture.kickoffTimeEt) {
    return null;
  }

  const forecastTimeEt = `${fixture.date}T${fixture.kickoffTimeEt}`;
  const timeIndex = payload.time.indexOf(forecastTimeEt);

  if (timeIndex === -1) {
    return null;
  }

  return {
    forecastTimeEt,
    temperatureC: readSeriesValue(payload.temperature_2m, timeIndex),
    precipitationMm: readSeriesValue(payload.precipitation, timeIndex),
    rainMm: readSeriesValue(payload.rain, timeIndex),
    windSpeed10mKph: readSeriesValue(payload.wind_speed_10m, timeIndex),
    precipitationProbabilityPct: readSeriesValue(payload.precipitation_probability, timeIndex),
  };
}

function buildAvailableWeatherSnapshot(
  provenance: ExternalDataProvenance<MatchContextProvider>,
  forecast: MatchWeatherForecast
): MatchWeatherSnapshot {
  return {
    provider: "open-meteo",
    status: "available",
    forecast: cloneForecast(forecast),
    provenance: { ...provenance },
  };
}

function buildUnavailableWeatherSnapshot(
  provenance: ExternalDataProvenance<MatchContextProvider>,
  reason: MatchWeatherUnavailableReason
): MatchWeatherSnapshot {
  return {
    provider: "open-meteo",
    status: "unavailable",
    reason,
    forecast: null,
    provenance: { ...provenance },
  };
}

function buildMatchWeatherSnapshot(
  snapshot: ExternalDataSnapshot<MatchContextForecastPayload, MatchContextProvider>,
  fixture: MatchContextFixture
): MatchWeatherSnapshot {
  const forecast = selectFixtureForecast(snapshot.data, fixture);

  if (forecast) {
    return buildAvailableWeatherSnapshot(snapshot.provenance, forecast);
  }

  const reason = snapshot.provenance.state === "error" ? "provider_error" : "forecast_missing";
  return buildUnavailableWeatherSnapshot(snapshot.provenance, reason);
}

export function createMatchContextService(
  options: CreateMatchContextServiceOptions = {}
): MatchContextService {
  const apiBaseUrl = options.apiBaseUrl ?? OPEN_METEO_FORECAST_URL;
  const cacheTtlMs = Math.max(1_000, Math.trunc(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS));
  const forecastDays = Math.max(1, Math.trunc(options.forecastDays ?? DEFAULT_FORECAST_DAYS));
  const now = options.now ?? (() => new Date());
  const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const providers = new Map<string, ExternalDataProvider<MatchContextForecastPayload, MatchContextProvider>>();

  function getProviderForVenue(venue: WCHostVenue): ExternalDataProvider<MatchContextForecastPayload, MatchContextProvider> {
    const existingProvider = providers.get(venue.name);
    if (existingProvider) {
      return existingProvider;
    }

    const sourceUrl = buildForecastUrl(venue, {
      apiBaseUrl,
      forecastDays,
      timezone,
    });

    const provider = createExternalDataProvider({
      provider: "open-meteo",
      sourceUrl,
      cacheTtlMs,
      fetchImpl: options.fetchImpl,
      timeoutMs,
      fallbackData: {
        time: [],
      },
      load: async ({ fetchImpl, sourceUrl, timeoutMs }) => {
        const payload = await fetchJsonWithTimeout(fetchImpl, sourceUrl, timeoutMs);

        return {
          data: parseOpenMeteoForecastPayload(payload),
        };
      },
    });

    providers.set(venue.name, provider);
    return provider;
  }

  async function getMatchContext(fixtureInput: MatchContextFixture): Promise<MatchContextSnapshot> {
    const fixture = cloneFixture(fixtureInput);
    const resolvedVenue =
      typeof fixture.venue === "string" && fixture.venue.trim().length > 0
        ? getHostVenueByName(fixture.venue)
        : undefined;
    const venue = cloneVenue(resolvedVenue ?? null);
    const sourceUrl =
      venue === null
        ? apiBaseUrl
        : buildForecastUrl(venue, {
            apiBaseUrl,
            forecastDays,
            timezone,
          });

    if (venue === null) {
      return {
        fixture,
        venue,
        weather: buildUnavailableWeatherSnapshot(createBaseProvenance(sourceUrl, cacheTtlMs), "venue_unavailable"),
      };
    }

    if (!isWithinForecastHorizon(fixture.date, now(), timezone, forecastDays)) {
      return {
        fixture,
        venue,
        weather: buildUnavailableWeatherSnapshot(
          createBaseProvenance(sourceUrl, cacheTtlMs),
          "outside_forecast_horizon"
        ),
      };
    }

    const provider = getProviderForVenue(venue);
    const snapshot = await provider.read();

    return {
      fixture,
      venue,
      weather: buildMatchWeatherSnapshot(snapshot, fixture),
    };
  }

  function clear(): void {
    for (const provider of providers.values()) {
      provider.clear();
    }

    providers.clear();
  }

  return {
    getMatchContext,
    clear,
  };
}
