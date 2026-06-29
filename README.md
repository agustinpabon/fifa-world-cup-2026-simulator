# World Cup Oracle

Elo-based predictions for the 2026 FIFA World Cup. The backend pulls ~49,000
historical international results, computes Elo ratings for every national team,
runs a 10,000-iteration Monte Carlo simulation of the tournament, and exposes
the results through a small JSON API. The frontend is a React dashboard that
shows tournament odds, a leaderboard, and a head-to-head match simulator.

This was originally scaffolded on Replit and has since been converted to run
fully locally with no Replit dependencies.

## Stack

- **Monorepo:** pnpm workspaces, TypeScript 5.9
- **API:** Express 5, bundled with esbuild
- **Frontend:** React 19 + Vite 7, Tailwind CSS v4, shadcn/ui, TanStack Query, wouter
- **API client:** generated from `lib/api-spec/openapi.yaml` (Orval) into typed React Query hooks
- **Prediction model:** Elo ratings (FIFA-style K-factors + home advantage + goal-difference multiplier) feeding a Poisson match model and a Monte Carlo tournament simulation

There is a Drizzle/PostgreSQL package (`lib/db`) scaffolded in the workspace,
but the app does **not** currently use a database — no `DATABASE_URL` or
Postgres instance is required to run it.

## Prerequisites

- Node.js 22.12+ (Node 24 recommended)
- pnpm 11+ — the easiest way to get it is via Corepack, which ships with Node:

  ```sh
  corepack enable pnpm
  ```

  > After enabling, make sure `pnpm` resolves on your `PATH` (`pnpm --version`).
  > Some workspace scripts invoke `pnpm` recursively, so a bare `pnpm` command
  > must be available.

## Setup

```sh
pnpm install
```

## Run locally

Start the API server and the web app together:

```sh
pnpm dev
```

- Web app: <http://localhost:5173>
- API server: <http://localhost:8080> (endpoints under `/api`)

The Vite dev server proxies `/api/*` to the API server, so the frontend's
relative API calls work without any extra configuration.

Run just one side if you prefer:

```sh
pnpm dev:web    # frontend only (expects an API on :8080)
pnpm dev:api    # API only
```

### Configuration (optional)

Everything has sensible defaults; override via environment variables if needed:

| Variable            | Default                 | Used by      | Purpose                                   |
| ------------------- | ----------------------- | ------------ | ----------------------------------------- |
| `PORT`              | `8080` (api) / `5173` (web) | both     | Port to listen on                         |
| `BASE_PATH`         | `/`                     | web          | Base path the app is served from          |
| `API_PROXY_TARGET`  | `http://localhost:8080` | web (dev)    | Where the Vite dev server proxies `/api`  |

## API endpoints

| Method | Path                        | Description                                            |
| ------ | --------------------------- | ------------------------------------------------------ |
| GET    | `/api/healthz`              | Health check                                           |
| GET    | `/api/oracle/status`        | Whether ratings/simulation are ready                   |
| GET    | `/api/oracle/teams`         | Qualified teams with computed Elo ratings              |
| GET    | `/api/oracle/simulation`    | Per-team tournament probabilities (title, final, etc.) |
| POST   | `/api/oracle/predict-match` | Head-to-head prediction (`{ homeTeam, awayTeam }`)     |

On startup the API downloads the international results CSV and computes ratings
in the background, so `/api/oracle/*` data becomes available a second or two
after the server starts (poll `/api/oracle/status`).

## Useful scripts

```sh
pnpm dev          # run API + web together
pnpm build        # typecheck, then build every package
pnpm typecheck    # typecheck the whole workspace
```

To regenerate the API client/types after editing the OpenAPI spec:

```sh
pnpm --filter @workspace/api-spec run codegen
```

## Project structure

```
artifacts/
  api-server/        Express API: Elo, simulation, oracle routes
  world-cup-oracle/  React + Vite frontend (the dashboard)
lib/
  api-spec/          OpenAPI spec + Orval codegen config
  api-client-react/  Generated typed React Query hooks
  api-zod/           Generated Zod schemas
  db/                Drizzle schema scaffold (unused at runtime)
scripts/             Workspace utility scripts
```
