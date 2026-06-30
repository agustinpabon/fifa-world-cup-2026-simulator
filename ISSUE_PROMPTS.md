# World Cup Oracle - issue prompts

This file contains ready-to-copy prompts for an agent with GitHub access. Each prompt asks the agent to create an issue, assign it to a milestone, apply labels, check for duplicates, and include clear acceptance criteria before implementation.

Use `<assignee>` as the assignee placeholder. If no assignee is known, the agent should leave the issue unassigned and mention that in its final update.

## Tracker setup prompt

```text
Act as a senior software engineer and project maintainer for the World Cup Oracle repository.

Before creating implementation issues, prepare the issue tracker:

1. Check whether equivalent milestones already exist. If they do not, create these milestones:
   - M1 - Trust & Correctness
   - M2 - Model Quality
   - M3 - Operability & Product UX
   - M4 - Cleanup & Polish

2. Check whether equivalent labels already exist. If they do not, create these labels:
   - priority:urgent
   - priority:important
   - priority:optional
   - type:bug
   - type:enhancement
   - type:tech-debt
   - type:test
   - type:docs
   - area:data
   - area:model
   - area:tournament-format
   - area:api
   - area:frontend
   - area:testing
   - area:infra
   - area:security
   - area:docs
   - slice:afk
   - slice:hitl

3. Do not delete or rename existing labels or milestones without human approval.
4. Return a summary of what already existed, what you created, and any naming conflicts.
```

## Urgent

### Prompt 01 - Replace hardcoded teams, groups, and fixtures with versioned official data

```text
Act as a senior software engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Replace hardcoded teams, groups, and fixtures with versioned official data
- Milestone: M1 - Trust & Correctness
- Labels: priority:urgent, type:bug, area:data, area:tournament-format, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
The app must not depend on teams, groups, fixtures, or tournament metadata written by hand without traceability. Create a versioned tournament data source for the 2026 World Cup containing teams, groups, fixtures, venues, dates, match status, and source provenance. The backend should consume that source and validate that it contains 48 teams, 12 groups of 4, complete group fixtures, and enough metadata to run the simulation.

## Acceptance criteria
- [ ] A local versioned tournament data source exists with clear provenance.
- [ ] The backend no longer uses unvalidated hardcoded lists for teams, groups, or fixtures.
- [ ] Validation fails if there are not 48 teams, 12 groups, or consistent fixtures.
- [ ] The API returns teams and groups from the validated source.
- [ ] Tests cover counts, team uniqueness, groups, and fixtures.

## Blocked by
None - can start immediately

After creating the issue, implement the change. Do not change the prediction model except where needed to read the new data source. Update the README only if setup or provenance changes.
```

### Prompt 02 - Remove fake results and hardcoded live states

```text
Act as a senior software engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Remove fake results and hardcoded live states from the backend
- Milestone: M1 - Trust & Correctness
- Labels: priority:urgent, type:bug, area:data, area:api, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
The backend must not invent match results or live minutes. Remove any logic based on fixed dates or specific hardcoded matches. Official results must come from an explicit source, and user overrides must remain separate from official data.

## Acceptance criteria
- [ ] There are no fixed dates used to force match states or scores.
- [ ] There are no hardcoded scores for specific matches.
- [ ] scheduled/live/finished states come from official data or explicitly marked overrides.
- [ ] The UI does not say "official" or "synced automatically" unless a real source supports that claim.
- [ ] Tests verify that a fixture with no result remains scheduled.

## Blocked by
None - can start immediately

After creating the issue, implement the change. If no real live source exists, use honest product copy such as "manual scenario overrides" or "imported fixture data".
```

### Prompt 03 - Implement the official 2026 bracket, including third-place assignment

```text
Act as a senior software engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Implement the official 2026 bracket and third-place assignment
- Milestone: M1 - Trust & Correctness
- Labels: priority:urgent, type:bug, area:tournament-format, area:model, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
The current simulation assigns the 8 best third-place teams to the Round of 32 by simple array position, which does not represent the official bracket. Implement a tournament format module that builds the knockout bracket using official 2026 World Cup rules, including the third-place combination table.

## Acceptance criteria
- [ ] The Round of 32 is generated from official rules, not from best8thirds[index].
- [ ] The bracket has no duplicate teams and no missing teams.
- [ ] Each simulation produces exactly 32 qualified teams, 16 R32 matches, 8 quarter-final entrants, 4 semi-final entrants, 2 finalists, and 1 champion.
- [ ] Tests cover third-place qualification combinations.
- [ ] The code separates tournament format rules from match simulation.

## Blocked by
- Replace hardcoded teams, groups, and fixtures with versioned official data

After creating the issue, implement the change. Use a declarative data structure for the third-place assignment table and protect it with invariant tests.
```

### Prompt 04 - Correct FIFA group tiebreakers and remove Elo as an official tiebreaker

```text
Act as a senior software engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Correct FIFA group-stage tiebreakers
- Milestone: M1 - Trust & Correctness
- Labels: priority:urgent, type:bug, area:tournament-format, area:model, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
The group stage must order teams using official FIFA tiebreakers. Elo must not appear as a silent official tiebreaker. When the official rules require drawing lots, fair play points, or another criterion the simulator cannot fully model, handle it explicitly and reproducibly.

## Acceptance criteria
- [ ] Group ranking follows the FIFA criteria that can be implemented with simulation data.
- [ ] Elo is not used as a silent official tiebreaker.
- [ ] If drawing lots is required, it uses a seedable RNG and is documented.
- [ ] Tests cover ties on points, goal difference, goals scored, and head-to-head.
- [ ] The UI stops claiming "official FIFA tiebreakers" if any criterion remains approximate.

## Blocked by
None - can start immediately

After creating the issue, implement the change and document any criteria that are approximated or not modeled.
```

### Prompt 05 - Validate mutable endpoints with runtime schemas

```text
Act as a senior software engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Validate mutable endpoints with runtime schemas
- Milestone: M1 - Trust & Correctness
- Labels: priority:urgent, type:bug, area:api, area:security, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
Endpoints that accept user input must validate it with runtime schemas instead of manually casting req.body. Reject unknown teams, identical teams, non-integer scores, negative scores, unrealistic scores, and malformed payloads.

## Acceptance criteria
- [ ] POST /oracle/live-match validates the request with Zod or an equivalent runtime schema.
- [ ] DELETE /oracle/live-match validates the request with a runtime schema.
- [ ] POST /oracle/predict-match validates the request with a runtime schema.
- [ ] All errors return a consistent envelope documented in OpenAPI.
- [ ] Tests cover valid and invalid payloads for each endpoint.

## Blocked by
None - can start immediately

After creating the issue, implement the change. Reuse the OpenAPI/api-zod contract if practical; otherwise keep manual schemas aligned with the spec.
```

### Prompt 06 - Add simulator invariant tests

```text
Act as a senior software engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Add invariant tests for the tournament simulation
- Milestone: M1 - Trust & Correctness
- Labels: priority:urgent, type:test, area:model, area:testing, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
Create an automated test suite that protects the simulator's basic invariants: qualified-team counts, probabilities within range, expected round totals, and no duplicated or missing teams.

## Acceptance criteria
- [ ] A test runner is configured for the workspace.
- [ ] Tests verify that each simulation has exactly one champion.
- [ ] Aggregates have expected totals: 10,000 champions, 20,000 finalists, etc.
- [ ] Published probabilities are always between 0 and 100.
- [ ] Tests run in CI or via a documented command.

## Blocked by
None - can start immediately

After creating the issue, write tests before refactoring. If the current code fails, keep the test red and fix the cause.
```

## Important

### Prompt 07 - Create real backtesting with calibration metrics

```text
Act as a senior ML/product engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Create real backtesting with Brier score, log loss, and calibration
- Milestone: M2 - Model Quality
- Labels: priority:important, type:enhancement, area:model, area:testing, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
The model needs evidence of accuracy. Create a reproducible backtesting workflow over historical matches or tournaments, reporting Brier score, log loss, calibration buckets, and comparison against simple baselines.

## Acceptance criteria
- [ ] A reproducible backtest command exists.
- [ ] The backtest separates train/test by date to avoid leakage.
- [ ] It reports Brier score, log loss, and calibration buckets.
- [ ] It includes a simple Elo baseline and a uniform baseline.
- [ ] The output is documented and is not just a console demo.

## Blocked by
- Add invariant tests for the tournament simulation

After creating the issue, implement a small but real first backtest. Do not tune parameters until the metrics are trustworthy.
```

### Prompt 08 - Make simulations reproducible with a seedable RNG

```text
Act as a senior software engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Make simulations reproducible with a seedable RNG
- Milestone: M2 - Model Quality
- Labels: priority:important, type:enhancement, area:model, area:api, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
Replace direct Math.random usage with an injectable seedable random generator. Make it possible to reproduce a simulation run for debugging, tests, and model-change comparisons.

## Acceptance criteria
- [ ] The simulation engine accepts a seed or injected RNG.
- [ ] Tests can fix the seed and get stable results.
- [ ] The API can expose the seed used or accept an optional seed where appropriate.
- [ ] No direct Math.random remains in the model core.
- [ ] Documentation explains reproducibility and its limits.

## Blocked by
- Add invariant tests for the tournament simulation

After creating the issue, implement the change while preserving the current public behavior where possible.
```

### Prompt 09 - Replace match-level Monte Carlo sampling with an exact score probability matrix

```text
Act as a senior engineer focused on probabilistic modeling in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Calculate match probabilities with an exact score matrix
- Milestone: M2 - Model Quality
- Labels: priority:important, type:enhancement, area:model, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
The head-to-head predictor does not need 50,000 random samples to estimate win/draw/loss. Implement a truncated exact score probability matrix to calculate win/draw/loss, expected goals, and most likely score deterministically.

## Acceptance criteria
- [ ] matchProbabilities no longer uses Monte Carlo for win/draw/loss.
- [ ] The score matrix is normalized, or the truncated mass is documented.
- [ ] Most likely score comes from the matrix, not random frequency.
- [ ] Tests cover symmetric matches and clear favorite scenarios.
- [ ] The endpoint responds faster and with reproducible results.

## Blocked by
- Make simulations reproducible with a seedable RNG

After creating the issue, implement the matrix for the match-prediction endpoint. Keep Monte Carlo only where it still makes sense for tournament simulation.
```

### Prompt 10 - Calibrate or rename the Dixon-Coles model

```text
Act as a senior ML engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Calibrate or rename the Dixon-Coles model
- Milestone: M2 - Model Quality
- Labels: priority:important, type:enhancement, area:model, area:docs, slice:hitl
- Assignee: <assignee>

Issue body:
## What to build
The app claims to use Dixon-Coles, but rho and the low-score adjustments are not calibrated against data. Decide whether to implement a properly calibrated Dixon-Coles model or honestly rename the current approach to Poisson with a low-score adjustment.

## Acceptance criteria
- [ ] There is an explicit decision: calibrate Dixon-Coles or rename the model.
- [ ] If calibrated, rho is estimated using historical data/backtesting.
- [ ] If renamed, UI/README/API no longer claim Dixon-Coles.
- [ ] Tests verify that probabilities remain valid.
- [ ] The methodology is documented.

## Blocked by
- Create real backtesting with Brier score, log loss, and calibration

After creating the issue, request a human decision if there is a scope-vs-precision tradeoff. Do not keep technical claims that are not supported.
```

### Prompt 11 - Improve attack and defense metrics with opponent and competition adjustment

```text
Act as a senior ML engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Adjust attack and defense metrics by opponent strength and competition
- Milestone: M2 - Model Quality
- Labels: priority:important, type:enhancement, area:model, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
The current attack/defense strength calculation uses recent average goals without normalizing by opponent, competition, home advantage, or a finer recency model. Create a more robust metric that adjusts goals scored/conceded by opponent strength and match weight.

## Acceptance criteria
- [ ] The metric accounts for opponent strength at match time.
- [ ] The metric differentiates competitions/friendlies with documented weights.
- [ ] The metric avoids extreme values from small samples.
- [ ] Backtesting compares the old model against the new one.
- [ ] The UI uses understandable labels and does not overstate precision.

## Blocked by
- Create real backtesting with Brier score, log loss, and calibration

After creating the issue, implement an incremental and measurable version. Do not change multiple parameters without a backtest report.
```

### Prompt 12 - Add snapshot, timeout, retry, and fallback for historical data

```text
Act as a senior backend engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Make historical data loading robust with snapshot and fallback
- Milestone: M3 - Operability & Product UX
- Labels: priority:important, type:enhancement, area:data, area:infra, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
The backend downloads a remote CSV at startup. That makes the app depend on network access, external availability, and unversioned upstream changes. Add a local snapshot, timeout, limited retry, freshness metadata, and fallback behavior when the remote fetch fails.

## Acceptance criteria
- [ ] Startup works without network access by using a local snapshot.
- [ ] The remote fetch has timeout and limited retry.
- [ ] The API exposes date/source/hash metadata for the dataset in use.
- [ ] If loading fails, the API returns an explicit error state.
- [ ] Tests or mocks cover remote success, timeout, and fallback.

## Blocked by
- Replace hardcoded teams, groups, and fixtures with versioned official data

After creating the issue, implement without adding secrets or external services.
```

### Prompt 13 - Move simulation recalculation to a non-blocking job

```text
Act as a senior backend engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Move simulation recalculation to a non-blocking job
- Milestone: M3 - Operability & Product UX
- Labels: priority:important, type:enhancement, area:api, area:infra, area:model, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
Endpoints that record overrides currently recalculate 10,000 simulations synchronously. Move recalculation to a non-blocking job or worker, expose recalculation status, and keep the last valid simulation available while a new one is running.

## Acceptance criteria
- [ ] POST/DELETE live-match responds without blocking for the full simulation.
- [ ] /oracle/status exposes recalculating/lastUpdated/error where appropriate.
- [ ] The UI shows recalculation state without freezing.
- [ ] Race conditions do not publish stale results over newer ones.
- [ ] Tests cover multiple consecutive updates.

## Blocked by
- Make simulations reproducible with a seedable RNG

After creating the issue, implement the simplest local-process solution that avoids heavy infrastructure.
```

### Prompt 14 - Standardize API response and error envelopes

```text
Act as a senior API engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Standardize API responses and errors
- Milestone: M3 - Operability & Product UX
- Labels: priority:important, type:enhancement, area:api, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
The API mixes direct responses, `{ error }` responses, and empty readiness states. Define a consistent contract for success, error, metadata, and readiness. Update OpenAPI, generated clients, and frontend handling.

## Acceptance criteria
- [ ] A consistent error response format exists.
- [ ] OpenAPI documents all expected responses.
- [ ] The frontend handles loading, not-ready, and real-error states differently.
- [ ] Generated clients/zod schemas are updated.
- [ ] Contract tests cover the main endpoints.

## Blocked by
- Validate mutable endpoints with runtime schemas

After creating the issue, implement incrementally without breaking generated imports.
```

### Prompt 15 - Fix Match Center UX and copy

```text
Act as a senior product engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Fix Match Center UX and copy for manual scenarios
- Milestone: M3 - Operability & Product UX
- Labels: priority:important, type:enhancement, area:frontend, area:docs, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
The Match Center should present itself as a manual scenario/override editor unless a real official-results integration exists. Adjust the flow so users understand that they can lock in match results and see the impact on probabilities.

## Acceptance criteria
- [ ] The UI does not say "synced automatically" if no real sync exists.
- [ ] The initial tab prioritizes the group stage or the most relevant current flow.
- [ ] official/custom/scheduled states are clear and honest.
- [ ] Loading, empty, and error states are understandable.
- [ ] Users can restore an override without confusing it with official data.

## Blocked by
- Remove fake results and hardcoded live states from the backend

After creating the issue, implement copy and flow changes. Do not add unrelated features.
```

### Prompt 16 - Harden CORS, rate limits, and mutable endpoints

```text
Act as a senior security-minded backend engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Harden CORS, rate limits, and mutable endpoints
- Milestone: M3 - Operability & Product UX
- Labels: priority:important, type:enhancement, area:api, area:security, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
Endpoints that mutate in-memory state are exposed with open CORS. Define an environment-specific CORS policy, add basic rate limiting, and document that overrides are local/non-persistent.

## Acceptance criteria
- [ ] CORS is not left open without an explicit per-environment decision.
- [ ] Mutable endpoints have reasonable rate limits.
- [ ] Request body size is limited.
- [ ] Errors do not leak unnecessary internal details.
- [ ] Documentation explains the in-memory state model.

## Blocked by
- Validate mutable endpoints with runtime schemas

After creating the issue, implement simple and testable protections. Do not introduce complex authentication without a human decision.
```

### Prompt 17 - Document model methodology, assumptions, and limitations

```text
Act as a senior engineer and technical writer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Document model methodology, assumptions, and limitations
- Milestone: M3 - Operability & Product UX
- Labels: priority:important, type:docs, area:docs, area:model, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
Create clear documentation for how Elo, xG, match probabilities, tournament simulation, home advantage, data sources, and limitations work. Make it clear that these probabilities are not official betting odds.

## Acceptance criteria
- [ ] README or docs explain data provenance.
- [ ] Docs explain model assumptions and main parameters.
- [ ] Docs explain limitations and do not promise unmeasured accuracy.
- [ ] UI/README/API use the same terminology.
- [ ] Documentation explains how to run backtests or verify the model if available.

## Blocked by
- Calibrate or rename the Dixon-Coles model

After creating the issue, update documentation without overstating accuracy.
```

### Prompt 18 - Show uncertainty and confidence intervals

```text
Act as a senior product/data engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Show uncertainty and confidence intervals in probabilities
- Milestone: M2 - Model Quality
- Labels: priority:important, type:enhancement, area:model, area:frontend, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
Probabilities are shown as exact one-decimal values, but they are estimates. Calculate and expose Monte Carlo uncertainty, or at least standard error, and display it compactly in the UI.

## Acceptance criteria
- [ ] The API exposes uncertainty metadata or simulation error.
- [ ] The UI avoids presenting tiny differences as absolute ranking truth.
- [ ] The leaderboard can explain ties or non-significant differences.
- [ ] Tests cover standard error or interval calculation.
- [ ] Documentation explains how to interpret uncertainty.

## Blocked by
- Make simulations reproducible with a seedable RNG

After creating the issue, implement a lightweight first version. Do not overload the dashboard with excessive statistics.
```

## Optional

### Prompt 19 - Remove or isolate unused database scaffold

```text
Act as a senior software engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Remove or isolate unused database scaffold
- Milestone: M4 - Cleanup & Polish
- Labels: priority:optional, type:tech-debt, area:infra, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
The db package exists in the workspace and is declared as an API dependency, but it is not used at runtime and fails if imported without DATABASE_URL. Decide whether to remove it, isolate it, or document it as future scaffold.

## Acceptance criteria
- [ ] The API server does not declare an unnecessary db dependency if it does not use it.
- [ ] Importing modules does not accidentally fail because DATABASE_URL is missing except in clearly documented database entry points.
- [ ] README reflects whether the app requires a database.
- [ ] Typecheck/build still pass.
- [ ] No used functionality is removed.

## Blocked by
None - can start immediately

After creating the issue, implement the simplest option. If the product direction is unclear, ask for a human decision before deleting files.
```

### Prompt 20 - Prune unused UI components and dependencies

```text
Act as a senior frontend engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Prune unused UI components and dependencies
- Milestone: M4 - Cleanup & Polish
- Labels: priority:optional, type:tech-debt, area:frontend, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
The frontend contains many shadcn/ui components and dependencies that do not appear to be used by the current app. Identify real imports, remove unused files/dependencies, and keep only the necessary surface.

## Acceptance criteria
- [ ] A used-vs-unused components/dependencies list is produced.
- [ ] Only unreferenced components/dependencies are removed.
- [ ] Build and typecheck pass.
- [ ] UX is not changed except by removing dead code.
- [ ] The diff does not mix in functional refactors.

## Blocked by
None - can start immediately

After creating the issue, keep this as a small PR. Do not delete components if future use is unclear without approval.
```

### Prompt 21 - Align README, UI, and technical claims with the code

```text
Act as a senior engineer and product writer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Align README, UI, and technical claims with the code
- Milestone: M4 - Cleanup & Polish
- Labels: priority:optional, type:docs, area:docs, area:frontend, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
The README and UI promise things that do not always match the code: simulation count, official sync, Dixon-Coles, high performance, and data sources. Align all copy with actual behavior and available evidence.

## Acceptance criteria
- [ ] README does not contradict NUM_SIMULATIONS or real endpoints.
- [ ] UI does not promise official sync if none exists.
- [ ] Model claims match implementation and available backtesting.
- [ ] The language distinguishes simulation, prediction, and manual scenarios.
- [ ] No new claims are added without technical support.

## Blocked by
- Document model methodology, assumptions, and limitations

After creating the issue, adjust copy directly and soberly.
```

### Prompt 22 - Add E2E smoke tests for the main flow

```text
Act as a senior QA/frontend engineer in the World Cup Oracle repository.

First create a GitHub issue:
- Search for duplicates before creating it.
- Title: Add E2E smoke tests for the main flow
- Milestone: M4 - Cleanup & Polish
- Labels: priority:optional, type:test, area:frontend, area:testing, slice:afk
- Assignee: <assignee>

Issue body:
## What to build
Add E2E smoke tests that verify a user can load the dashboard, view the leaderboard, filter teams, open groups, simulate a match, and save/restore a manual override.

## Acceptance criteria
- [ ] Automated E2E tests cover the main flows.
- [ ] Tests wait for API readiness robustly.
- [ ] Tests cover loading/error states at least at a basic level.
- [ ] The test command is documented.
- [ ] Tests do not depend on external network access if a local snapshot exists.

## Blocked by
- Make historical data loading robust with snapshot and fallback
- Fix Match Center UX and copy for manual scenarios

After creating the issue, implement small and reliable smoke tests. Prioritize stability over exhaustive coverage.
```
