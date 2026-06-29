import React, { useState, useEffect, useRef } from "react";
import { useGetTeams, usePredictMatch } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AnimatedNumber } from "@/components/ui/animated-number";

const MIN_LOADING_MS = 2200;

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
      // ease-out curve
      const eased = 1 - Math.pow(1 - progress, 2);
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

  const homeFlag = teams.find((t) => t.name === homeTeam)?.flagEmoji ?? "";
  const awayFlag = teams.find((t) => t.name === awayTeam)?.flagEmoji ?? "";

  return (
    <Card className="border-card-border bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-xl uppercase tracking-wider text-muted-foreground font-mono">
          Match Simulator
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Controls row */}
        <div className="flex flex-col md:flex-row gap-4 items-end mb-8">
          <div className="flex-1 w-full">
            <label className="text-xs text-muted-foreground uppercase font-mono mb-2 block">Team 1</label>
            <select
              value={homeTeam}
              onChange={(e) => setHomeTeam(e.target.value)}
              disabled={teamsLoading || isSimulating}
              className="w-full h-9 rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">Select team...</option>
              {teams.map((team) => (
                <option key={team.code} value={team.name}>
                  {team.flagEmoji} {team.name}
                </option>
              ))}
            </select>
          </div>

          <div className="text-muted-foreground pb-2 px-2 font-mono text-sm hidden md:block">VS</div>

          <div className="flex-1 w-full">
            <label className="text-xs text-muted-foreground uppercase font-mono mb-2 block">Team 2</label>
            <select
              value={awayTeam}
              onChange={(e) => setAwayTeam(e.target.value)}
              disabled={teamsLoading || isSimulating}
              className="w-full h-9 rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">Select team...</option>
              {teams.map((team) => (
                <option key={team.code} value={team.name}>
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
                <span className="text-foreground">{homeTeam}</span>
                {" vs "}
                <span className="text-foreground">{awayTeam}</span>
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
            <div className="grid grid-cols-3 gap-2 text-center mb-6">
              <div className="text-lg font-bold font-mono">
                {homeFlag} {result.homeTeam}
              </div>
              <div className="text-muted-foreground font-mono text-sm self-center">VS</div>
              <div className="text-lg font-bold font-mono">
                {awayFlag} {result.awayTeam}
              </div>
            </div>

            {/* Win/Draw/Win */}
            <div className="grid grid-cols-3 gap-4 text-center mb-8">
              <div>
                <div className="text-xs text-muted-foreground font-mono uppercase mb-1">Win</div>
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
                <div className="text-xs text-muted-foreground font-mono uppercase mb-1">Win</div>
                <div className="text-4xl md:text-5xl font-bold font-mono text-primary">
                  <AnimatedNumber value={result.awayWinPct} format={(v) => v.toFixed(1) + "%"} />
                </div>
              </div>
            </div>

            {/* Most likely score */}
            <div className="text-center py-6 border-y border-border mb-6 bg-card/30">
              <div className="text-xs text-muted-foreground font-mono uppercase mb-2">Most Likely Score</div>
              <div className="text-6xl md:text-7xl font-bold tracking-tighter">
                {result.mostLikelyScore}
              </div>
            </div>

            {/* xG + Elo */}
            <div className="grid grid-cols-2 gap-8 text-center text-sm font-mono">
              <div>
                <div className="text-muted-foreground mb-1">Expected Goals</div>
                <div className="text-xl text-foreground font-bold">{result.homeExpectedGoals.toFixed(2)}</div>
                <div className="text-muted-foreground mt-4 mb-1">Elo Rating</div>
                <div className="text-foreground">{Math.round(result.homeElo)}</div>
              </div>
              <div>
                <div className="text-muted-foreground mb-1">Expected Goals</div>
                <div className="text-xl text-foreground font-bold">{result.awayExpectedGoals.toFixed(2)}</div>
                <div className="text-muted-foreground mt-4 mb-1">Elo Rating</div>
                <div className="text-foreground">{Math.round(result.awayElo)}</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
