import app from "./app.js";
import type { LoadHistoricalDatasetOptions } from "./lib/elo.js";
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

function getOracleInitOptionsFromEnv(): LoadHistoricalDatasetOptions {
  const maxAttempts = readIntegerEnv("HISTORICAL_DATA_MAX_ATTEMPTS", { min: 0 });
  const timeoutMs = readIntegerEnv("HISTORICAL_DATA_TIMEOUT_MS", { min: 1 });

  return {
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
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
