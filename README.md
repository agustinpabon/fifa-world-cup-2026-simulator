```
 ⚽  █░█░█ █▀█ █▀█ █░░ █▀▄   █▀▀ █░█ █▀█   ▀█  ███  █▀▀ 
 🏆  ▀▄▀▄▀ █▄█ █▀▄ █▄▄ █▄▀   █▄▄ █▄█ █▀▀   █▄  █▄█  ██▄ 
     ===============================================
     FIFA World Cup 2026 Simulator & Prediction Engine
```

A high-performance tournament simulator for the 48-team **FIFA World Cup 2026** (hosted across 🇺🇸 USA, 🇲🇽 Mexico, and 🇨🇦 Canada). Powered by a custom Time-Decay Elo rating engine, Dixon-Coles Poisson goal modeling, and Monte Carlo tournament simulations.

---

### ⚡ Quickstart

```bash
# Clone repository
git clone https://github.com/agustinpabon/fifa-world-cup-2026-simulator.git
cd fifa-world-cup-2026-simulator

# Install dependencies via pnpm
pnpm install

# Run backend API (:8080) and frontend dashboard (:5173) together
pnpm dev
```

Open `http://localhost:5173` in your browser to inspect live team odds, knockout probabilities, and test custom head-to-head match matchups.

---

### 🎲 How the Prediction Engine Works

Rather than relying on static bookmaker odds or manual guesses, the engine processes ~49,000 historical international matches recorded since 1872:

1. **Time-Decay Elo Ratings**: Evaluates team strength using exponential recency weighting ($w = e^{-\lambda \cdot t}$). Modern matches heavily outweigh results from past decades. Applies host-advantage boosts for 2026 hosts (USA, Mexico, Canada).
2. **Dixon-Coles Poisson Model**: Translates Elo disparities into expected goals ($xG$) and applies low-scoring draw adjustments (0-0, 1-1).
3. **Official 48-Team Bracket**: Simulates all 12 group stages, identifies the 8 best third-place qualifiers, and runs a structured 32-team knockout bracket through 25,000+ Monte Carlo iterations.

---

### 🛠️ Architecture & Tech Stack

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
- **Backend**: Express 5 bundled with esbuild. Zero database required for instant startup.
- **Contract-Driven API**: OpenAPI spec in `lib/api-spec/openapi.yaml` automatically generates strictly typed React Query hooks and Zod schemas.

---

### 🔌 API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/oracle/status` | Readiness check for ratings and simulation cache |
| `GET` | `/api/oracle/teams` | Qualified 2026 teams with computed Elo ratings |
| `GET` | `/api/oracle/simulation` | Per-team probabilities (Group win, R16, QF, SF, Final, Champion) |
| `POST` | `/api/oracle/predict-match` | Head-to-head predictor (`{ homeTeam, awayTeam }`) |

---

### 💡 Developer Commands

```bash
pnpm dev       # Run API server and web app concurrently
pnpm build     # Typecheck and build all workspace packages
pnpm typecheck # Validate TypeScript across the entire monorepo
```

To update API types after modifying `openapi.yaml`:
```bash
pnpm --filter @workspace/api-spec run codegen
```
