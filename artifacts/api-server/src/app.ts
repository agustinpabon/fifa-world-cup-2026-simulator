import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sendApiError } from "./lib/api-response";

const app: Express = express();

const trustProxyVal = process.env.TRUST_PROXY;
if (trustProxyVal === "true") {
  app.set("trust proxy", true);
} else if (trustProxyVal === "false") {
  app.set("trust proxy", false);
} else if (trustProxyVal) {
  const num = Number(trustProxyVal);
  app.set("trust proxy", Number.isNaN(num) ? trustProxyVal : num);
} else {
  app.set("trust proxy", false);
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

const isProduction = process.env.NODE_ENV === "production";
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or same-origin)
      if (!origin) {
        return callback(null, true);
      }

      if (isProduction) {
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          logger.warn({ origin }, "CORS blocked request in production");
          callback(new Error("Not allowed by CORS"));
        }
      } else {
        // In development/test, allow localhost/127.0.0.1 origins or origins defined in ALLOWED_ORIGINS
        if (
          origin.startsWith("http://localhost:") ||
          origin.startsWith("http://127.0.0.1:") ||
          allowedOrigins.includes(origin)
        ) {
          callback(null, true);
        } else {
          logger.warn(
            { origin },
            "CORS blocked request in development (non-localhost)",
          );
          callback(new Error("Not allowed by CORS"));
        }
      }
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ limit: "10kb", extended: true }));

const malformedJsonHandler: ErrorRequestHandler = (error, req, res, next) => {
  const bodyParserError = error as {
    type?: unknown;
    status?: number;
    statusCode?: number;
  };

  if (
    error instanceof SyntaxError &&
    bodyParserError.type === "entity.parse.failed"
  ) {
    sendApiError(res, 400, {
      code: "malformed_json",
      message: "Malformed JSON payload",
      issues: [{ message: "Request body must be valid JSON" }],
    });
    return;
  }

  if (
    bodyParserError.status === 413 ||
    bodyParserError.statusCode === 413 ||
    bodyParserError.type === "entity.too.large"
  ) {
    sendApiError(res, 413, {
      code: "payload_too_large",
      message: "Request payload too large",
    });
    return;
  }

  next(error);
};

app.use(malformedJsonHandler);

app.use("/api", router);

const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  const isProd = process.env.NODE_ENV === "production";
  req.log.error(error);

  let status = error.status || error.statusCode || 500;
  let code = error.code || "internal_server_error";
  let message = error.message || "An unexpected error occurred";

  if (error.message === "Not allowed by CORS") {
    status = 403;
    code = "cors_not_allowed";
    message = "Request origin is not allowed by CORS policy";
  }

  sendApiError(res, status, {
    code,
    message:
      isProd && code === "internal_server_error"
        ? "An unexpected error occurred"
        : message,
    ...(isProd ? {} : { issues: [{ message: error.stack || "" }] }),
  });
};

app.use(errorHandler);

export default app;
