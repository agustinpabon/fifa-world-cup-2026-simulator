import app from "./app.js";
import { logger } from "./lib/logger.js";
import { initOracle } from "./routes/oracle.js";

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

function readIntegerEnv(name: string, options: { min: number }): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < options.min) {
    throw new Error(`Invalid ${name} value: "${raw}"`);
  }

  return value;
}

function readStringEnv(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

function getOracleInitOptionsFromEnv(): Parameters<typeof initOracle>[0] {
  const maxAttempts = readIntegerEnv("HISTORICAL_DATA_MAX_ATTEMPTS", { min: 0 });
  const timeoutMs = readIntegerEnv("HISTORICAL_DATA_TIMEOUT_MS", { min: 1 });
  const liveDataTimeoutMs = readIntegerEnv("LIVE_DATA_TIMEOUT_MS", { min: 1 });
  const liveDataRefreshIntervalMs = readIntegerEnv("LIVE_DATA_REFRESH_INTERVAL_MS", { min: 1000 });
  const liveDataProvider = process.env["LIVE_DATA_PROVIDER"] === "disabled" ? "disabled" : "espn";
  const apiFootballKey = readStringEnv("API_FOOTBALL_KEY");
  const apiFootballBaseUrl = readStringEnv("API_FOOTBALL_BASE_URL");
  const apiFootballCacheTtlMs = readIntegerEnv("API_FOOTBALL_CACHE_TTL_MS", { min: 60_000 });
  const apiFootballTimeoutMs = readIntegerEnv("API_FOOTBALL_TIMEOUT_MS", { min: 1 });
  const apiFootballLeagueId = readIntegerEnv("API_FOOTBALL_LEAGUE_ID", { min: 1 });
  const apiFootballSeason = readIntegerEnv("API_FOOTBALL_SEASON", { min: 1872 });

  return {
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(apiFootballKey === undefined
      ? {}
      : {
          apiFootball: {
            apiKey: apiFootballKey,
            ...(apiFootballBaseUrl === undefined ? {} : { baseUrl: apiFootballBaseUrl }),
            ...(apiFootballCacheTtlMs === undefined ? {} : { cacheTtlMs: apiFootballCacheTtlMs }),
            ...(apiFootballTimeoutMs === undefined ? {} : { timeoutMs: apiFootballTimeoutMs }),
            ...(apiFootballLeagueId === undefined ? {} : { leagueId: apiFootballLeagueId }),
            ...(apiFootballSeason === undefined ? {} : { season: apiFootballSeason }),
          },
        }),
    liveData: {
      provider: liveDataProvider,
      ...(liveDataTimeoutMs === undefined ? {} : { timeoutMs: liveDataTimeoutMs }),
      ...(liveDataRefreshIntervalMs === undefined
        ? {}
        : { refreshIntervalMs: liveDataRefreshIntervalMs }),
    },
  };
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Initialize oracle in background (non-blocking)
  initOracle(getOracleInitOptionsFromEnv()).then(() => {
    logger.info("Oracle initialized successfully");
  }).catch((err) => {
    logger.error({ err }, "Oracle initialization failed");
  });
});
