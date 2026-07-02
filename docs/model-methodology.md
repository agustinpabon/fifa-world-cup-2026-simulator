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

## Experimental Context Modifiers

Experimental match context modifiers are implemented for research only and are
feature-flagged off by default. They can adjust Elo and/or xG through four typed
families:

- `weather`
- `availability`
- `suspension`
- `manual`

Modifiers do not encode automatic heuristics. Each entry must provide explicit
numeric adjustments plus `explanation` and `provenance.source`, and the runtime
reports both requested and applied adjustments. Applied adjustments are bounded
by model config limits before they affect predictions.

The default published model does not use these modifiers. They are applied only
when `experimentalModifiersEnabled=true` is present in model config or an
explicit API query flag is passed for a prediction request. `POST
/api/oracle/predict-match?experimentalModifiers=true` enables the experimental
path for that request and returns the modifier report, but no external injury,
weather, or roster source is wired into the published model by default.

Backtesting can compare the active base model against opt-in modifiers:

```bash
pnpm backtest -- --experimental-modifiers path/to/modifiers.json
```

The modifiers JSON must be traceable:

```json
{
  "sourceName": "manual-context-experiment-v1",
  "generatedAt": "2026-07-01T00:00:00.000Z",
  "entries": [
    {
      "date": "2024-06-01",
      "homeTeam": "Team A",
      "awayTeam": "Team B",
      "modifiers": {
        "manual": [
          {
            "target": "teamA",
            "adjustments": { "eloDelta": -25, "xgMultiplier": 0.96 },
            "explanation": "Research-only availability adjustment from tracked source.",
            "provenance": { "source": "analyst-notebook", "sourceId": "exp-001" }
          }
        ]
      }
    }
  ]
}
```

The rolling report includes base vs modifier Brier score and log loss deltas.
Experimental modifiers remain disabled unless enabled backtests improve both
Brier score and log loss in every evaluated window.

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
| 2021 | 1115 | 0.4849 | 0.8342 | 0.4970 | 0.8553 | 0.6667 | 64.1% |
| 2022 | 970 | 0.5538 | 0.9388 | 0.5571 | 0.9454 | 0.6667 | 57.8% |
| 2023 | 1054 | 0.5171 | 0.8816 | 0.5259 | 0.8966 | 0.6667 | 61.8% |
| 2024 | 1231 | 0.5405 | 0.9167 | 0.5483 | 0.9301 | 0.6667 | 58.7% |
| 2025 | 1002 | 0.4932 | 0.8467 | 0.5065 | 0.8690 | 0.6667 | 62.4% |

Variant summary versus Elo-only across the five windows:

| Variant | Windows Better On Brier | Windows Better On Log Loss | Avg Brier Delta | Avg Log Loss Delta | Decision |
|---|---:|---:|---:|---:|---|
| `elo-poisson` | 0/5 | 0/5 | +0.0053 | +0.0085 | Disabled |
| `elo-poisson-dixon-coles` | 0/5 | 0/5 | +0.0064 | +0.0089 | Disabled |
| `elo-poisson-strength` | 5/5 | 5/5 | -0.0091 | -0.0157 | Active |

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

The default published model does not include:

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
