import React, { useState, useEffect, useRef } from "react";
import { useGetTeams, usePredictMatch } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Info, Home, Shield, Zap } from "lucide-react";

const MIN_LOADING_MS = 2200;
const HOST_TEAMS = new Set(["USA", "Mexico", "Canada"]);

export function MatchSimulator() {
  const { data: teamsData, isLoading: teamsLoading } = useGetTeams();
  const [homeTeam, setHomeTeam] = useState<string>("");
  const [awayTeam, setAwayTeam] = useState<string>("");
  const [isSimulating, setIsSimulating] = useState(false);
  const [simCount, setSimCount] = useState(0);
  const [result, setResult] = useState<ReturnType<typeof usePredictMatch>["data"]>(undefined);

  const predictMatch = usePredictMatch();
  const countRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const teams = teamsData?.teams ?? [];

  const startCountAnimation = () => {
    setSimCount(0);
    const start = Date.now();
    startTimeRef.current = start;
    countRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / MIN_LOADING_MS, 1);
      const eased = 1 - Math.pow(1 - progress, 2); // ease-out
      setSimCount(Math.floor(eased * 10_000));
      if (progress >= 1) {
        clearInterval(countRef.current!);
        setSimCount(10_000);
      }
    }, 30);
  };

  const handleSimulate = async () => {
    if (!homeTeam || !awayTeam || isSimulating) return;

    setResult(undefined);
    setIsSimulating(true);
    startCountAnimation();

    const fetchStart = Date.now();

    predictMatch.mutate(
      { data: { homeTeam, awayTeam } },
      {
        onSettled: (data) => {
          const elapsed = Date.now() - fetchStart;
          const remaining = Math.max(0, MIN_LOADING_MS - elapsed);
          setTimeout(() => {
            if (countRef.current) clearInterval(countRef.current);
            setSimCount(10_000);
            setResult(data);
            setIsSimulating(false);
          }, remaining);
        },
      }
    );
  };

  useEffect(() => {
    return () => {
      if (countRef.current) clearInterval(countRef.current);
    };
  }, []);

  const homeTeamInfo = teams.find((t) => t.name === homeTeam);
  const awayTeamInfo = teams.find((t) => t.name === awayTeam);

  const homeFlag = homeTeamInfo?.flagEmoji ?? "";
  const awayFlag = awayTeamInfo?.flagEmoji ?? "";

  const isHomeHost = HOST_TEAMS.has(homeTeam);
  const isAwayHost = HOST_TEAMS.has(awayTeam);

  return (
    <Card className="border-card-border bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-xl uppercase tracking-wider text-muted-foreground font-mono flex items-center justify-between">
          <span>Match Simulator</span>
          <span className="text-[10px] text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded font-bold uppercase tracking-widest font-mono">
            Poisson & Dixon-Coles
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Controls row */}
        <div className="flex flex-col md:flex-row gap-4 items-end mb-8">
          <div className="flex-1 w-full">
            <label className="text-xs text-muted-foreground uppercase font-mono mb-2 block">Team 1 (Home)</label>
            <select
              value={homeTeam}
              onChange={(e) => {
                setHomeTeam(e.target.value);
                setResult(undefined);
              }}
              disabled={teamsLoading || isSimulating}
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
            <label className="text-xs text-muted-foreground uppercase font-mono mb-2 block">Team 2 (Away)</label>
            <select
              value={awayTeam}
              onChange={(e) => {
                setAwayTeam(e.target.value);
                setResult(undefined);
              }}
              disabled={teamsLoading || isSimulating}
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
            onClick={handleSimulate}
            disabled={!homeTeam || !awayTeam || homeTeam === awayTeam || isSimulating}
            className="w-full md:w-auto font-mono uppercase tracking-wider min-w-[120px]"
          >
            {isSimulating ? "Running..." : "Simulate"}
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
                    <span className="text-muted-foreground">Attack Str:</span>
                    <span className="text-foreground font-bold">{homeTeamInfo.attackStrength.toFixed(2)}x</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Defense Str:</span>
                    <span className="text-foreground font-bold">{homeTeamInfo.defenseStrength.toFixed(2)}x</span>
                  </div>
                </div>
              </div>

              {/* Comparison Center */}
              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="bg-secondary px-3 py-1.5 rounded-full font-bold text-xs uppercase tracking-wider border border-border">
                  VS
                </div>
                <div className="text-[10px] text-muted-foreground leading-normal max-w-[120px]">
                  Compare Elo and Dixon-Coles multipliers before starting the simulation.
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
                    <span className="text-muted-foreground">Attack Str:</span>
                    <span className="text-foreground font-bold">{awayTeamInfo.attackStrength.toFixed(2)}x</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Defense Str:</span>
                    <span className="text-foreground font-bold">{awayTeamInfo.defenseStrength.toFixed(2)}x</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading animation */}
        {isSimulating && (
          <div className="rounded-lg bg-background border border-border p-8 text-center">
            <div className="flex flex-col items-center gap-6">
              {/* Pulsing badge */}
              <div className="flex items-center gap-3">
                <span className="text-2xl">{homeFlag}</span>
                <span className="text-muted-foreground font-mono text-sm">VS</span>
                <span className="text-2xl">{awayFlag}</span>
              </div>

              <div className="font-mono text-sm text-muted-foreground uppercase tracking-widest">
                Running 10,000 Simulations of{" "}
                <span className="text-foreground font-sans font-bold">{homeTeam}</span>
                {" vs "}
                <span className="text-foreground font-sans font-bold">{awayTeam}</span>
                {"..."}
              </div>

              {/* Sim counter */}
              <div className="text-4xl font-bold font-mono tabular-nums text-primary">
                {simCount.toLocaleString()}
                <span className="text-muted-foreground text-lg"> / 10,000</span>
              </div>

              {/* Progress bar */}
              <div className="w-full max-w-sm h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-75"
                  style={{ width: `${(simCount / 10_000) * 100}%` }}
                />
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
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 rounded-lg bg-background p-6 border border-border">
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
                BIVARIATE POISSON PROBABILITY
              </div>
            </div>

            {/* xG + Elo + Dixon-Coles Factors */}
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
                    <Zap className="w-3.5 h-3.5 text-yellow-500" /> Atk / Def Strength
                  </div>
                  <div className="text-foreground">
                    {result.homeAttackStrength.toFixed(2)}x / {result.homeDefenseStrength.toFixed(2)}x
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
                    <Zap className="w-3.5 h-3.5 text-yellow-500" /> Atk / Def Strength
                  </div>
                  <div className="text-foreground">
                    {result.awayAttackStrength.toFixed(2)}x / {result.awayDefenseStrength.toFixed(2)}x
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
