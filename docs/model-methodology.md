# World Cup Oracle Model Methodology

This document describes the implemented prediction pipeline as of the latest
backtest in `reports/backtests/latest.json`. It intentionally avoids accuracy
claims that are not supported by the validation data.

## Active Model

The active match model is `elo-poisson-strength`:

1. Build chronological Elo ratings from international results.
2. Convert the Elo difference into a base expected-goals split.
3. Apply conservative recent attack and defense multipliers.
4. Build a normalized Poisson score matrix.
5. Sum the score matrix into home win, draw, and away win probabilities.

This model is active because it beat the Elo-only baseline on both Brier score
and log loss in every evaluated annual backtest window from 2021 through 2025.

Dixon-Coles is implemented and tested, but it is not active. In the current
rolling backtest, `elo-poisson-dixon-coles` performed worse than Elo-only in
every evaluated window on both Brier score and log loss.

## Data

Historical results come from Mart J. Van de Guchte's international results CSV.
The API tries the remote CSV on startup and falls back to the bundled snapshot
at `artifacts/api-server/src/data/international-results.snapshot.csv`.

Production and backtesting now use the same CSV parser from
`@workspace/oracle-model`. The parser handles quoted CSV fields such as team,
city, or country names containing commas.

The World Cup 2026 team list and group fixtures are local data under
`artifacts/api-server/src/data/fifa-world-cup-2026.v1.json`.

## Elo Ratings

Ratings start at `1500`. The fallback rating and metric rating center are also
`1500`, so teams without historical data do not receive accidental attack or
defense penalties.

Elo expected score:

```text
E_A = 1 / (1 + 10 ^ ((R_B - R_A) / 400))
```

The home team receives `+75` Elo for non-neutral historical matches. Updates use
tournament K-factors and a goal-difference multiplier, with recency decay
relative to the prediction year.

## Attack And Defense Multipliers

Attack and defense multipliers are recent-form adjustments, not a second full
strength model. They are computed from an 8-year window, opponent-adjusted goals,
competition weights, and shrinkage toward a mild Elo-derived prior.

Current safeguards:

- Clamp range: `[0.6, 1.5]`.
- Residual Elo scale: `5000`.
- Max recent-goal blend: `0.10`.
- Prior weight: `60`.

These settings were changed because the old scale caused most World Cup teams to
sit exactly on the clamp boundaries. A regression test now fails if more than
10% of qualified teams are exactly at an attack or defense clamp boundary.

## Score Matrix

For `elo-poisson-strength`, the expected-goals split starts from the Elo
difference and is adjusted as:

```text
xG_A = base_xG_A * attack_A * defense_B
xG_B = base_xG_B * attack_B * defense_A
```

The score matrix is truncated at 10 goals per team and normalized. Match
probabilities and match simulation both use this same final matrix. Simulation
samples categorically from the matrix, not by rejection sampling.

## Dixon-Coles

Dixon-Coles low-score adjustment is available for the experimental
`elo-poisson-dixon-coles` variant:

```text
tau(0,0) = 1 - xG_A * xG_B * rho
tau(1,0) = 1 + xG_B * rho
tau(0,1) = 1 + xG_A * rho
tau(1,1) = 1 - rho
```

Positive adjustments are not capped at `1`. The adjusted matrix is normalized
after applying the low-score factors. Current tests verify normalization and
that negative `rho` increases 0-0 and 1-1 probabilities while decreasing 1-0
and 0-1.

## Model Selection And Backtesting

Backtesting uses rolling-origin evaluation. For each test match, the model
predicts before that match is applied to the rating state. Metrics prioritize
probability quality:

- Brier score, lower is better.
- Log loss, lower is better.
- Accuracy, reported but not used as the primary selection metric.
- Confidence calibration buckets.

Default command:

```bash
pnpm backtest
```

The default backtest uses the bundled snapshot for reproducibility and evaluates
annual windows for 2021, 2022, 2023, 2024, and 2025.

| Year | Matches | Active Brier | Active Log Loss | Elo Brier | Elo Log Loss | Uniform Brier | Accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2021 | 1115 | 0.4880 | 0.8377 | 0.5001 | 0.8587 | 0.6667 | 63.9% |
| 2022 | 970 | 0.5550 | 0.9408 | 0.5582 | 0.9474 | 0.6667 | 57.9% |
| 2023 | 1054 | 0.5210 | 0.8863 | 0.5292 | 0.9004 | 0.6667 | 61.6% |
| 2024 | 1231 | 0.5431 | 0.9201 | 0.5510 | 0.9334 | 0.6667 | 58.1% |
| 2025 | 1002 | 0.4944 | 0.8473 | 0.5083 | 0.8708 | 0.6667 | 62.2% |

Variant summary versus Elo-only across the five windows:

| Variant | Windows Better On Brier | Windows Better On Log Loss | Avg Brier Delta | Avg Log Loss Delta | Decision |
|---|---:|---:|---:|---:|---|
| `elo-poisson` | 0/5 | 0/5 | +0.0047 | +0.0077 | Disabled |
| `elo-poisson-dixon-coles` | 0/5 | 0/5 | +0.0057 | +0.0081 | Disabled |
| `elo-poisson-strength` | 5/5 | 5/5 | -0.0090 | -0.0157 | Active |

Negative deltas are improvements over Elo-only. Positive deltas are worse.

## Tournament Simulation

Monte Carlo tournament simulation remains in use. Each simulated match samples
from the same normalized score matrix used for match probabilities.

Host advantage:

- Group-stage host status uses fixture venue when venue data is available.
- For knockout rounds without venue data in the local bracket templates, the
  existing stage-level assumption remains: host teams may receive host boost in
  R32/R16, and only USA can receive it from quarter-finals onward.

Penalty shootouts:

- Drawn knockout matches advance by a 50/50 penalty decision.
- Elo-adjusted penalties are not used because they have not been validated.

## Known Limitations

The model does not include:

- Final rosters.
- Injuries.
- Suspensions.
- Player availability.
- Player form.
- Weather.
- Pitch conditions.
- Travel fatigue.
- Tactical changes.
- Manager changes.
- Motivation and rotation incentives.
- Match congestion.
- Penalty-taker or goalkeeper skill.
- Market odds.
- Missing or incomplete match data.
- Data quality issues in historical sources.

The backtest is an offline historical validation, not a guarantee of future
World Cup accuracy. The 2026 tournament has distribution-shift risk because it
uses a new 48-team format and is hosted across three countries.
