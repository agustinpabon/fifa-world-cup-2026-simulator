import type { Request, Response, NextFunction } from "express";
import { sendApiError } from "../lib/api-response.js";
import { logger } from "../lib/logger.js";

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

const clientLimits = new Map<string, RateLimitInfo>();
const DEFAULT_MAX_CLIENT_KEYS = 10_000;
let limiterInstanceCounter = 0;

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  maxKeys?: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

function pruneExpiredClients(now: number): void {
  for (const [key, info] of clientLimits) {
    if (now > info.resetTime) {
      clientLimits.delete(key);
    }
  }
}

export function rateLimiter(options: RateLimiterOptions) {
  const {
    windowMs,
    max,
    maxKeys = DEFAULT_MAX_CLIENT_KEYS,
    message = "Too many requests, please try again later.",
    keyGenerator = (req: Request) =>
      req.ip || req.socket.remoteAddress || "unknown",
  } = options;
  const limiterKeyPrefix = `limiter-${limiterInstanceCounter++}:`;

  function countTrackedClients(): number {
    let count = 0;

    for (const key of clientLimits.keys()) {
      if (key.startsWith(limiterKeyPrefix)) {
        count += 1;
      }
    }

    return count;
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const clientKey = keyGenerator(req);
    const key = `${limiterKeyPrefix}${clientKey}`;
    const now = Date.now();
    pruneExpiredClients(now);

    let info = clientLimits.get(key);

    if (!info || now > info.resetTime) {
      if (!info && countTrackedClients() >= maxKeys) {
        logger.warn(
          { key: clientKey, path: req.path, maxKeys },
          "Rate limiter client capacity exceeded",
        );

        sendApiError(res, 429, {
          code: "rate_limit_capacity_exceeded",
          message:
            "Too many distinct clients are being rate limited. Please try again later.",
        });
        return;
      }

      info = {
        count: 0,
        resetTime: now + windowMs,
      };
    }

    info.count += 1;
    clientLimits.set(key, info);

    const remaining = Math.max(0, max - info.count);
    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(info.resetTime / 1000));

    if (info.count > max) {
      const retryAfter = Math.ceil((info.resetTime - now) / 1000);
      res.setHeader("Retry-After", retryAfter);

      logger.warn(
        { key: clientKey, path: req.path, count: info.count },
        "Rate limit exceeded",
      );

      sendApiError(res, 429, {
        code: "rate_limit_exceeded",
        message,
      });
      return;
    }

    next();
  };
}

export function resetRateLimits(): void {
  clientLimits.clear();
}
