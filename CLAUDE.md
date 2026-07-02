# CLAUDE.md

Guidance for working in this repo. See `README.md` for user-facing setup.

## What this is

World Cup Oracle — a pnpm-workspace monorepo with an Express API that computes
Elo ratings + a Monte Carlo simulation of the 2026 FIFA World Cup, and a
React/Vite dashboard that consumes it. Originally scaffolded on Replit; all
Replit-specific tooling has been removed and it runs locally.

## Run & operate

- `pnpm dev` — run API (`:8080`) and web (`:5173`) together; web proxies `/api` → API
- `pnpm dev:api` / `pnpm dev:web` — run one side
- `pnpm build` — typecheck, then build all packages
- `pnpm typecheck` — typecheck the whole workspace
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from the OpenAPI spec

No database or env vars are required to run. `PORT`, `BASE_PATH`, and
`API_PROXY_TARGET` are honored if set (see README) but all default sensibly.

## Architecture / where things live

- `artifacts/api-server/` — Express 5 API, bundled to `dist/index.mjs` with esbuild (`build.mjs`).
  - `src/routes/oracle.ts` — the API surface; results are cached in memory.
  - `src/lib/elo.ts` — downloads `results.csv` from GitHub and computes Elo ratings. **Source of the data model.**
  - `src/lib/simulation.ts` — Poisson match model + Monte Carlo tournament sim.
  - `src/lib/worldcup2026.ts` — the qualified teams, groups, and CSV name mapping.
  - On boot, `initOracle()` runs in the background; `/api/oracle/*` data is empty until it finishes (poll `/api/oracle/status`).
- `artifacts/world-cup-oracle/` — React 19 + Vite 7 frontend. Entry `src/main.tsx` → `src/App.tsx`. Tailwind v4 (config lives in `src/index.css`, no `tailwind.config`). shadcn/ui components under `src/components/ui`.
- `lib/api-spec/` — **contract source of truth.** `openapi.yaml` drives Orval codegen.
- `lib/api-client-react/` — generated typed React Query hooks (`src/generated`). Don't hand-edit generated files; change `openapi.yaml` and rerun codegen.
- `lib/api-zod/` — generated Zod schemas.
- `scripts/` — workspace utility scripts.

## Conventions / gotchas

- **pnpm only.** A `preinstall` guard rejects npm/yarn. Use Corepack to get pnpm and ensure bare `pnpm` is on `PATH` (some scripts call it recursively).
- **Cross-platform installs.** `pnpm-workspace.yaml` pins `esbuild` and overrides drizzle-kit's esbuild loader, but does **not** exclude platform-specific native binaries — keep it that way so installs work on macOS/Windows/Linux. (The original Replit config excluded all non-Linux binaries, which broke local installs.)
- **Generated API client types are strict.** The generated `useX` hooks type their `query` option as the full `UseQueryOptions`, so you must pass `queryKey` (use the exported `getXQueryKey()` helper) when supplying query options.
- TanStack Query v5: `refetchInterval` callbacks receive the `Query` object — read data via `query.state.data`, not a `data` argument.
- API route handlers must `return` on every path (`tsc` runs with strict return checking).
- The API server build externalizes many optional native deps (see `build.mjs`); add to that list if you introduce a package that can't be bundled.

## Product

A dashboard showing, for each qualified team, the probability of winning the
group / reaching each knockout round / winning the title, plus a head-to-head
match predictor. Predictions come from Elo ratings derived from ~49k historical
international matches, fed into a Poisson scoring model and a 10,000-run Monte
Carlo tournament simulation.
