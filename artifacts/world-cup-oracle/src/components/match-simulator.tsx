import React, { useState } from "react";
import { useGetTeams, usePredictMatch, type MatchPredictionData } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { AlertTriangle, Home, Zap } from "lucide-react";

const MIN_LOADING_MS = 2200;
const HOST_TEAMS = new Set(["USA", "Mexico", "Canada"]);

export function MatchSimulator() {
  const { data: teamsResponse, isLoading: teamsLoading, isError: teamsError } = useGetTeams();
  const [homeTeam, setHomeTeam] = useState<string>("");
  const [awayTeam, setAwayTeam] = useState<string>("");
  const [isSimulating, setIsSimulating] = useState(false);
  const [result, setResult] = useState<MatchPredictionData | undefined>(undefined);

  const predictMatch = usePredictMatch();

  const teams = teamsResponse?.data.teams ?? [];
  const readiness = teamsResponse?.meta.readiness;
  const isOracleUnavailable = readiness ? readiness.state !== "ready" : false;

  const handleSimulate = async () => {
    if (!homeTeam || !awayTeam || isSimulating) return;

    setResult(undefined);
    setIsSimulating(true);

    const fetchStart = Date.now();

    predictMatch.mutate(
      { data: { homeTeam, awayTeam } },
      {
        onSettled: (response) => {
          const elapsed = Date.now() - fetchStart;
          const remaining = Math.max(0, MIN_LOADING_MS - elapsed);
          setTimeout(() => {
            setResult(response?.data);
            setIsSimulating(false);
          }, remaining);
        },
      }
    );
  };

  const homeTeamInfo = teams.find((t) => t.name === homeTeam);
  const awayTeamInfo = teams.find((t) => t.name === awayTeam);

  const homeFlag = homeTeamInfo?.flagEmoji ?? "";
  const awayFlag = awayTeamInfo?.flagEmoji ?? "";

  const isHomeHost = HOST_TEAMS.has(homeTeam);
  const isAwayHost = HOST_TEAMS.has(awayTeam);

  return (
    <Card data-testid="match-predictor" className="border-card-border bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-xl uppercase tracking-wider text-muted-foreground font-mono flex items-center justify-between">
          <span>Match Predictor</span>
          <span className="text-[10px] text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded font-bold uppercase tracking-widest font-mono">
            Poisson & Dixon-Coles
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {(teamsError || isOracleUnavailable) && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-background/40 p-4 text-sm text-muted-foreground">
            <AlertTriangle className={`h-4 w-4 shrink-0 ${teamsError ? "text-destructive" : "text-yellow-500"}`} />
            <span>
              {teamsError
                ? "Unable to load teams for match prediction."
                : readiness?.message}
            </span>
          </div>
        )}

        {/* Controls row */}
        <div className="flex flex-col md:flex-row gap-4 items-end mb-8">
          <div className="flex-1 w-full">
            <label htmlFor="predictor-home-team" className="text-xs text-muted-foreground uppercase font-mono mb-2 block">Team 1 (Home)</label>
            <select
              id="predictor-home-team"
              data-testid="predictor-home-team"
              value={homeTeam}
              onChange={(e) => {
                setHomeTeam(e.target.value);
                setResult(undefined);
              }}
              disabled={teamsLoading || teamsError || isOracleUnavailable || isSimulating}
              className="w-full h-9 rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">Select team...</option>
              {teams.map((team) => (
                <option key={team.code} value={team.name} disabled={team.name === awayTeam}>
                  {team.flagEmoji} {team.name}
                </option>
              ))}
            </select>
          </div>

          <div className="text-muted-foreground pb-2 px-2 font-mono text-sm hidden md:block">VS</div>

          <div className="flex-1 w-full">
            <label htmlFor="predictor-away-team" className="text-xs text-muted-foreground uppercase font-mono mb-2 block">Team 2 (Away)</label>
            <select
              id="predictor-away-team"
              data-testid="predictor-away-team"
              value={awayTeam}
              onChange={(e) => {
                setAwayTeam(e.target.value);
                setResult(undefined);
              }}
              disabled={teamsLoading || teamsError || isOracleUnavailable || isSimulating}
              className="w-full h-9 rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">Select team...</option>
              {teams.map((team) => (
                <option key={team.code} value={team.name} disabled={team.name === homeTeam}>
                  {team.flagEmoji} {team.name}
                </option>
              ))}
            </select>
          </div>

          <Button
            data-testid="predict-match-button"
            onClick={handleSimulate}
            disabled={!homeTeam || !awayTeam || homeTeam === awayTeam || teamsError || isOracleUnavailable || isSimulating}
            className="w-full md:w-auto font-mono uppercase tracking-wider min-w-[120px]"
          >
            {isSimulating ? "Calculating..." : "Predict"}
          </Button>
        </div>

        {/* Pre-simulation Comparative Strengths Panel */}
        {!isSimulating && !result && homeTeamInfo && awayTeamInfo && (
          <div className="animate-in fade-in duration-300 rounded-lg bg-background/30 p-6 border border-card-border mb-4 font-mono text-xs">
            <div className="text-xs uppercase text-muted-foreground mb-4 tracking-widest text-center border-b border-border/40 pb-2">
              Matchup Strength Comparison
            </div>
            <div className="grid grid-cols-3 items-center gap-4 text-center">
              {/* Home Team Stats */}
              <div>
                <span className="text-2xl block mb-1">{homeFlag}</span>
                <span className="font-bold text-sm font-sans block text-foreground truncate">{homeTeam}</span>
                {isHomeHost && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] bg-primary/20 text-primary border border-primary/30 px-1.5 py-0.5 rounded-full mt-1.5 font-bold uppercase tracking-wider">
                    <Home className="w-2.5 h-2.5" /> Host Boost
                  </span>
                )}
                <div className="mt-4 space-y-2 text-left">
                  <div className="flex justify-between border-b border-border/30 pb-1">
                    <span className="text-muted-foreground">Elo Rating:</span>
                    <span className="text-foreground font-bold">{Math.round(homeTeamInfo.elo)}</span>
                  </div>
                  <div className="flex justify-between border-b border-border/30 pb-1">
                    <span className="text-muted-foreground">Attack Mult:</span>
                    <span className="text-foreground font-bold">{homeTeamInfo.attackStrength.toFixed(1)}x</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Defense Mult:</span>
                    <span className="text-foreground font-bold">{homeTeamInfo.defenseStrength.toFixed(1)}x</span>
                  </div>
                </div>
              </div>

              {/* Comparison Center */}
              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="bg-secondary px-3 py-1.5 rounded-full font-bold text-xs uppercase tracking-wider border border-border">
                  VS
                </div>
                <div className="text-[10px] text-muted-foreground leading-normal max-w-[120px]">
                  Compare Elo and goal-strength multipliers before calculating probabilities.
                </div>
              </div>

              {/* Away Team Stats */}
              <div>
                <span className="text-2xl block mb-1">{awayFlag}</span>
                <span className="font-bold text-sm font-sans block text-foreground truncate">{awayTeam}</span>
                {isAwayHost && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] bg-primary/20 text-primary border border-primary/30 px-1.5 py-0.5 rounded-full mt-1.5 font-bold uppercase tracking-wider">
                    <Home className="w-2.5 h-2.5" /> Host Boost
                  </span>
                )}
                <div className="mt-4 space-y-2 text-left">
                  <div className="flex justify-between border-b border-border/30 pb-1">
                    <span className="text-muted-foreground">Elo Rating:</span>
                    <span className="text-foreground font-bold">{Math.round(awayTeamInfo.elo)}</span>
                  </div>
                  <div className="flex justify-between border-b border-border/30 pb-1">
                    <span className="text-muted-foreground">Attack Mult:</span>
                    <span className="text-foreground font-bold">{awayTeamInfo.attackStrength.toFixed(1)}x</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Defense Mult:</span>
                    <span className="text-foreground font-bold">{awayTeamInfo.defenseStrength.toFixed(1)}x</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading animation */}
        {isSimulating && (
          <div data-testid="predictor-loading" className="rounded-lg bg-background border border-border p-8 text-center">
            <div className="flex flex-col items-center gap-6">
              {/* Pulsing badge */}
              <div className="flex items-center gap-3">
                <span className="text-2xl">{homeFlag}</span>
                <span className="text-muted-foreground font-mono text-sm">VS</span>
                <span className="text-2xl">{awayFlag}</span>
              </div>

              <div className="font-mono text-sm text-muted-foreground uppercase tracking-widest">
                Calculating matchup probabilities for{" "}
                <span className="text-foreground font-sans font-bold">{homeTeam}</span>
                {" vs "}
                <span className="text-foreground font-sans font-bold">{awayTeam}</span>
                {"..."}
              </div>

              <div className="text-xs text-muted-foreground leading-relaxed max-w-sm">
                Using the exact Dixon-Coles-adjusted Poisson score matrix from the current Elo ratings and goal-strength multipliers.
              </div>

              {/* Scanning dots */}
              <div className="flex gap-1.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-primary"
                    style={{
                      animation: `pulse 1s ease-in-out ${i * 0.15}s infinite`,
                      opacity: 0.4,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {!isSimulating && result && (
          <div
            data-testid="prediction-results"
            className="animate-in fade-in slide-in-from-bottom-4 duration-500 rounded-lg bg-background p-6 border border-border"
          >
            {/* Team header */}
            <div className="grid grid-cols-3 gap-2 text-center mb-6 items-center">
              <div className="flex flex-col items-center">
                <span className="text-3xl mb-1">{homeFlag}</span>
                <span className="text-base font-bold font-sans text-foreground truncate max-w-[150px]">{result.homeTeam}</span>
                {isHomeHost && (
                  <span className="inline-flex items-center gap-0.5 text-[8px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full mt-1 font-bold uppercase tracking-wider font-mono">
                    Host
                  </span>
                )}
              </div>
              <div className="text-muted-foreground font-mono text-xs uppercase tracking-widest">Prediction Results</div>
              <div className="flex flex-col items-center">
                <span className="text-3xl mb-1">{awayFlag}</span>
                <span className="text-base font-bold font-sans text-foreground truncate max-w-[150px]">{result.awayTeam}</span>
                {isAwayHost && (
                  <span className="inline-flex items-center gap-0.5 text-[8px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full mt-1 font-bold uppercase tracking-wider font-mono">
                    Host
                  </span>
                )}
              </div>
            </div>

            {/* Win/Draw/Win Probability breakdown bar */}
            <div className="mb-8">
              <div className="flex justify-between text-xs font-mono text-muted-foreground mb-2">
                <span>{result.homeTeam} Win: {result.homeWinPct.toFixed(1)}%</span>
                <span>Draw: {result.drawPct.toFixed(1)}%</span>
                <span>{result.awayTeam} Win: {result.awayWinPct.toFixed(1)}%</span>
              </div>
              {/* Stacked bar */}
              <div className="w-full h-4 bg-muted rounded-full overflow-hidden flex border border-border">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${result.homeWinPct}%` }}
                  title={`${result.homeTeam} Win`}
                />
                <div
                  className="h-full bg-muted-foreground/30 transition-all duration-500"
                  style={{ width: `${result.drawPct}%` }}
                  title="Draw"
                />
                <div
                  className="h-full bg-indigo-600 transition-all duration-500"
                  style={{ width: `${result.awayWinPct}%` }}
                  title={`${result.awayTeam} Win`}
                />
              </div>
            </div>

            {/* Win/Draw/Win values */}
            <div className="grid grid-cols-3 gap-4 text-center mb-8">
              <div>
                <div className="text-xs text-muted-foreground font-mono uppercase mb-1">Home Win</div>
                <div className="text-4xl md:text-5xl font-bold font-mono text-primary">
                  <AnimatedNumber value={result.homeWinPct} format={(v) => v.toFixed(1) + "%"} />
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground font-mono uppercase mb-1">Draw</div>
                <div className="text-3xl md:text-4xl font-bold font-mono text-muted-foreground mt-2">
                  <AnimatedNumber value={result.drawPct} format={(v) => v.toFixed(1) + "%"} />
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground font-mono uppercase mb-1">Away Win</div>
                <div className="text-4xl md:text-5xl font-bold font-mono text-indigo-500">
                  <AnimatedNumber value={result.awayWinPct} format={(v) => v.toFixed(1) + "%"} />
                </div>
              </div>
            </div>

            {/* Most likely score */}
            <div className="text-center py-6 border-y border-border mb-6 bg-card/30 rounded-md">
              <div className="text-xs text-muted-foreground font-mono uppercase mb-2">Most Likely Score</div>
              <div className="text-6xl md:text-7xl font-bold tracking-tighter text-foreground mb-1">
                {result.mostLikelyScore}
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                DIXON-COLES ADJUSTED POISSON
              </div>
            </div>

            {/* xG + Elo + goal-strength factors */}
            <div className="grid grid-cols-2 gap-8 text-center text-xs font-mono">
              <div className="space-y-3">
                <div className="border-b border-border/40 pb-2">
                  <div className="text-muted-foreground mb-0.5">Expected Goals (xG)</div>
                  <div className="text-xl text-foreground font-bold">{result.homeExpectedGoals.toFixed(2)}</div>
                </div>
                <div className="border-b border-border/40 pb-2">
                  <div className="text-muted-foreground mb-0.5">Elo Rating</div>
                  <div className="text-foreground font-semibold">{Math.round(result.homeElo)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1 flex items-center justify-center gap-1">
                    <Zap className="w-3.5 h-3.5 text-yellow-500" /> Attack / Defense Mult.
                  </div>
                  <div className="text-foreground">
                    {result.homeAttackStrength.toFixed(1)}x / {result.homeDefenseStrength.toFixed(1)}x
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="border-b border-border/40 pb-2">
                  <div className="text-muted-foreground mb-0.5">Expected Goals (xG)</div>
                  <div className="text-xl text-foreground font-bold">{result.awayExpectedGoals.toFixed(2)}</div>
                </div>
                <div className="border-b border-border/40 pb-2">
                  <div className="text-muted-foreground mb-0.5">Elo Rating</div>
                  <div className="text-foreground font-semibold">{Math.round(result.awayElo)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1 flex items-center justify-center gap-1">
                    <Zap className="w-3.5 h-3.5 text-yellow-500" /> Attack / Defense Mult.
                  </div>
                  <div className="text-foreground">
                    {result.awayAttackStrength.toFixed(1)}x / {result.awayDefenseStrength.toFixed(1)}x
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
