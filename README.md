```text
██╗    ██╗ ██████╗ ██████╗ ██╗     ██████╗      ██████╗██╗   ██╗██████╗ 
██║    ██║██╔═══██╗██╔══██╗██║     ██╔══██╗    ██╔════╝██║   ██║██╔══██╗
██║ █╗ ██║██║   ██║██████╔╝██║     ██║  ██║    ██║     ██║   ██║██████╔╝
██║███╗██║██║   ██║██╔══██╗██║     ██║  ██║    ██║     ██║   ██║██╔═══╝ 
╚███╔███╔╝╚██████╔╝██║  ██║███████╗██████╔╝    ╚██████╗╚██████╔╝██║     
 ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═════╝      ╚═════╝ ╚══════╝╚═╝     

                Monte Carlo Tournament Simulator & Elo Engine

               - 49,000+ Historical International Matches
               - Exponential Time-Decay Elo Rating Model
               - Validated Elo + Attack/Defense Poisson Model
               - 10,000 Tournament Monte Carlo Runs
```

A local tournament simulator for the 48-team FIFA World Cup 2026 (hosted across USA, Mexico, and Canada). It combines a time-decay Elo rating engine, validated attack/defense Poisson goal modeling, and Monte Carlo tournament simulations.

---

### Quickstart

```bash
# Clone repository
git clone https://github.com/agustinpabon/fifa-world-cup-2026-simulator.git
cd fifa-world-cup-2026-simulator

# Install dependencies via pnpm
pnpm install

# Run backend API (:8080) and frontend dashboard (:5173) together
pnpm dev
```

Open `http://localhost:5173` in your browser to inspect team probabilities, knockout probabilities, and head-to-head matchups.

---

### How the Prediction Engine Works

Rather than relying on static bookmaker odds or manual guesses, the engine processes ~49,000 historical international matches recorded since 1872 to estimate future match outcomes.

For the current mathematical notes, core equations, parameter options, and validation approach, read the **[Model Methodology & Assumptions Documentation](docs/model-methodology.md)**.

#### Core Model Components
1. **Time-Decay Elo Ratings**: Evaluates overall team strength using exponential recency weighting. Modern matches heavily outweigh results from past decades based on an exponential decay function. Applies host-advantage boosts ($+50$ Elo) for 2026 hosts (USA, Mexico, Canada).
2. **Attack/Defense Strength**: Recent goals scored and conceded are adjusted by opponent Elo at match time and competition weight. To handle small sample sizes, these are shrunk toward Elo-only factors before affecting expected goals (xG).
3. **Validated Poisson Score Model**: Translates rating disparities into Expected Goals (xG), applies conservative attack/defense multipliers, and samples from the same normalized score matrix used for match probabilities. Dixon-Coles remains implemented as an experimental variant but is not active because it did not improve validation metrics.
4. **2026 Tournament Structure & Simulation**: Simulates all group stage and knockout bracket matches. Evaluates group standings using FIFA tiebreakers and best third-place team rankings across 10,000 Monte Carlo iterations.

#### Model Assumptions & Key Parameters
- **K-Factor Weights**: Ranges from 60 (World Cup finals) down to 20 (Friendlies).
- **Time-Decay Half-Life**: Set to ~12.6 years (decay parameter $= 0.055$) to balance historical depth with modern relevance.
- **Home/Host Advantage**: Baseline $+75$ Elo for standard home matches, and $+50$ Elo host boost for USA, Mexico, and Canada playing in their home countries (with Quarter-Finals onwards restricted to USA).
- **Dixon-Coles Param ($\rho$)**: Set to $-0.06$ for the experimental Dixon-Coles variant, which is currently disabled by model selection.

> [!WARNING]
> **Important Disclaimer & Limitations**
> The model's predictions represent statistical probabilities based purely on historical results and current rating parameters. They are **not official betting odds** and do not promise unmeasured accuracy. The default published model does not account for rosters, injuries, weather, tactical modifications, resting players, or other real-world factors.

#### Model Verification & Backtesting
Run `pnpm backtest` to produce a rolling historical report with Brier score, log loss, accuracy, and calibration buckets. The report compares Elo-only, Elo + Poisson, Elo + Poisson + Dixon-Coles, Elo + attack/defense Poisson, and a uniform baseline.

Experimental context modifiers for `weather`, `availability`, `suspension`, and `manual` adjustments are implemented only behind explicit flags. They require traceable `explanation` and `provenance` fields, are off by default, and should not be promoted unless backtests improve both Brier score and log loss.

---

### Tournament Data Provenance

The 2026 teams, groups, and group-stage fixtures are loaded from the local versioned source at `artifacts/api-server/src/data/fifa-world-cup-2026.v1.json`. That file is transcribed from FIFA's official "FIFA World Cup 2026 Match Schedule" PDF, published June 28, 2026, and records the source URL, access date, kickoff dates/times, venues, match status, and team-to-Elo CSV name mappings. The backend validates the source at import time for 48 teams, 12 groups of 4, unique teams, and complete six-fixture coverage per group. No automatic FIFA sync or official result ingestion is currently implemented.

---

### Architecture & Tech Stack

Built as a lightweight monorepo with `pnpm workspaces`:

```
fifa-world-cup-2026-simulator/
├── artifacts/
│   ├── api-server/        # Express 5 API + Elo computation + Monte Carlo engine
│   └── world-cup-oracle/  # React 19 + Vite 7 dashboard (Tailwind v4, Radix UI)
├── lib/
│   ├── api-spec/          # OpenAPI spec (drives typed React Query hooks via Orval)
│   ├── api-client-react/  # Generated React Query hooks
│   └── db/                # Drizzle ORM schema scaffold (unused at runtime)
└── scripts/               # Workspace utilities
```

- **Frontend**: React 19, Vite 7, Tailwind CSS v4, TanStack Query v5, Wouter routing.
- **Backend**: Express 5 bundled with esbuild. Zero database is required for development or runtime execution. Ratings are computed from the historical match CSV loaded at startup, tournament fixtures come from the local versioned source, and manual scenario overrides live in memory.
- **Database (Scaffold only)**: The `lib/db` workspace package contains a database schema scaffold using Drizzle ORM and `pg` for future persistence integrations. It is entirely isolated from the runtime application, and does not require an active database connection (`DATABASE_URL` is only verified lazily if database exports are explicitly utilized).
- **Contract-Driven API**: OpenAPI spec in `lib/api-spec/openapi.yaml` automatically generates strictly typed React Query hooks and Zod schemas.

---

### In-Memory State Model & Ephemeral Scenario Overrides

The World Cup Oracle API manages all scenario modifications using an **ephemeral in-memory state model**:

1. **Local & Non-Persistent**: Manual match score overrides (recorded via `POST /api/oracle/live-match` or cleared via `POST /api/oracle/live-matches/clear`) are written directly to a local, in-memory cache variable in the running Express server process.
2. **Restart Instability**: Because overrides are stored purely in-memory, any custom results and scenario predictions are temporary. They reset to the loaded fixture schedule and ratings recomputed from historical match data whenever the Express server process restarts or redeploys.
3. **No Active Database**: Although the workspace contains a Drizzle ORM package structure (`lib/db`), the runtime server is database-free.

### Optional API-Football Squad Provider

Squad data is served from the local versioned snapshot by default. To optionally hydrate squads from API-Football on the backend, set `API_FOOTBALL_KEY` for the API server process. The key is sent only from Express using the `x-apisports-key` header; React never calls API-Football directly.

Optional backend env vars:
- `API_FOOTBALL_CACHE_TTL_MS` — cache TTL for API-Football squad reads, default `43200000` (12h), minimum 1 minute.
- `API_FOOTBALL_TIMEOUT_MS` — upstream request timeout in milliseconds, default 3000.
- `API_FOOTBALL_LEAGUE_ID` / `API_FOOTBALL_SEASON` — team ID discovery parameters, default World Cup league `1` and season `2026`.
- `API_FOOTBALL_BASE_URL` — override for tests or proxies, default `https://v3.football.api-sports.io`.

If `API_FOOTBALL_KEY` is unset or API-Football returns a rate/error response, `/api/oracle/squads` continues to serve local snapshots and reports provider state in `externalProvenance`. API-Football roster data is informational and does not automatically affect ratings, simulations, or recalculation.

---

### API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| GET | `/api/oracle/status` | Readiness check for ratings and simulation cache |
| GET | `/api/oracle/teams` | Qualified 2026 teams with computed Elo ratings |
| GET | `/api/oracle/live-matches` | Imported fixture list and any manual scenario overrides |
| GET | `/api/oracle/squads` | Versioned local squad snapshot, optionally hydrated server-side from API-Football |
| GET | `/api/oracle/simulation` | Per-team probabilities (Group win, R16, QF, SF, Final, Champion) |
| POST | `/api/oracle/live-match` | Record a manual scenario override (`{ homeTeam, awayTeam, homeScore, awayScore }`) |
| DELETE | `/api/oracle/live-match` | Remove a manual scenario override (`{ homeTeam, awayTeam }`) |
| POST | `/api/oracle/live-matches/clear` | Clear all manual scenario overrides |
| POST | `/api/oracle/predict-match` | Exact head-to-head probability matrix (`{ homeTeam, awayTeam }`) |
| POST | `/api/oracle/predict-match?experimentalModifiers=true` | Opt-in experimental modifier evaluation path for a single prediction; default model remains unchanged |

### Simulation Reproducibility

`GET /api/oracle/status` and `GET /api/oracle/simulation` include `simulationSeed`, the seed used for the cached Monte Carlo run. To reproduce a run for debugging or model comparisons, call `GET /api/oracle/simulation?seed=<seed>` with the same ratings data, fixture data, manual overrides, simulator code, and simulation count.

Seeds make the random draw sequence reproducible. They do not make probabilities exact, and results can still change after model logic, tournament data, Elo inputs, host-advantage rules, or manual scenario overrides change.

---

### Developer Commands

```bash
pnpm dev       # Run API server and web app concurrently
pnpm backtest  # Run a dated historical model backtest and write reports/backtests/latest.json
pnpm build     # Typecheck and build all workspace packages
pnpm test      # Run package test suites, including simulator invariant tests
pnpm test:e2e  # Run Playwright smoke tests against local API/web servers
pnpm typecheck # Validate TypeScript across the entire monorepo
```

The E2E command starts the API and Vite dashboard on isolated local ports and
sets `HISTORICAL_DATA_MAX_ATTEMPTS=0`, so tests use the bundled historical CSV
snapshot instead of requiring external network access.

To update API types after modifying `openapi.yaml`:
```bash
pnpm --filter @workspace/api-spec run codegen
```

### Model Backtesting

Run the first historical holdout backtest with:

```bash
pnpm backtest
```

By default, the command trains chronological Elo ratings on matches before `2024-01-01`, scores matches from `2024-01-01` through `2024-12-31`, and writes a JSON report to `reports/backtests/latest.json`. Each test match is scored before its result updates ratings for later test matches, so the evaluation is rolling-origin and does not use future results.

The report includes multiclass Brier score, log loss, accuracy, confidence calibration buckets, a simple Elo baseline, and a uniform baseline. For pinned local data, pass `-- --input path/to/results.csv`; for another window, pass `-- --test-start YYYY-MM-DD --test-end YYYY-MM-DD`.

To evaluate traceable experimental context modifiers against the active base model:

```bash
pnpm backtest -- --experimental-modifiers path/to/modifiers.json
```

The JSON file must contain `sourceName` and `entries[]` with `homeTeam`, `awayTeam`, optional `date`, and typed `modifiers`. Every modifier must include an `explanation` and `provenance.source`. The generated report includes base vs modifier Brier/log-loss deltas and keeps the recommendation disabled unless all enabled windows improve both metrics.
