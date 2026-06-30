import type { Request, Response, NextFunction } from "express";
import { sendApiError } from "../lib/api-response.js";
import { logger } from "../lib/logger.js";

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

const clientLimits = new Map<string, RateLimitInfo>();

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

export function rateLimiter(options: RateLimiterOptions) {
  const {
    windowMs,
    max,
    message = "Too many requests, please try again later.",
    keyGenerator = (req: Request) => req.ip || req.socket.remoteAddress || "unknown",
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyGenerator(req);
    const now = Date.now();
    let info = clientLimits.get(key);

    if (!info || now > info.resetTime) {
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
        { key, path: req.path, count: info.count },
        "Rate limit exceeded"
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
