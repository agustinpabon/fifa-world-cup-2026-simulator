import React from "react";
import {
  useGetOracleStatus,
  getGetOracleStatusQueryKey,
} from "@workspace/api-client-react";
import { Leaderboard } from "@/components/leaderboard";
import { GroupStandings } from "@/components/group-standings";
import { MatchSimulator } from "@/components/match-simulator";
import { LiveMatchCenter } from "@/components/live-match-center";
import { useEnforceDarkMode } from "@/hooks/use-dark-mode";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, Database, Flame, Trophy, CalendarDays } from "lucide-react";

export default function Dashboard() {
  useEnforceDarkMode();

  const { data: status } = useGetOracleStatus({
    query: {
      queryKey: getGetOracleStatusQueryKey(),
      refetchInterval: (query) => (query.state.data?.ready ? false : 2000),
    }
  });

  const isReady = status?.ready;
  const liveCount = status?.liveMatchesRecorded ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 selection:bg-primary/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12">
        {/* Header */}
        <header className="mb-8 border-b border-border pb-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="flex items-center gap-4">
              <Trophy className="w-12 h-12 text-yellow-500 hidden sm:block animate-pulse" />
              <div>
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-1 bg-gradient-to-r from-foreground via-foreground to-primary/80 bg-clip-text text-transparent">
                  World Cup <span className="text-primary font-extrabold">Oracle</span>
                </h1>
                <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
                  2026 FIFA World Cup · AI Simulation Portal
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3 bg-secondary/50 px-4 py-2 rounded-full border border-border self-start md:self-auto">
              {isReady ? (
                <>
                  <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
                  <span className="font-mono text-xs uppercase text-primary font-bold tracking-wider">Oracle Active</span>
                </>
              ) : (
                <>
                  <Activity className="w-4 h-4 text-yellow-500 animate-spin" />
                  <span className="font-mono text-xs uppercase text-yellow-500 tracking-wider">
                    {status?.message || "Loading Database..."}
                  </span>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card className="border-card-border bg-card/30 backdrop-blur-sm">
            <CardContent className="p-4 flex items-center gap-4">
              <Database className="w-8 h-8 text-primary/80 hidden sm:block" />
              <div>
                <span className="text-xs font-mono text-muted-foreground uppercase block">Historical Data</span>
                <span className="text-lg sm:text-xl font-bold font-mono">49,000+</span>
                <span className="text-[10px] text-muted-foreground font-mono block">Matches since 1872</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-card-border bg-card/30 backdrop-blur-sm">
            <CardContent className="p-4 flex items-center gap-4">
              <Flame className="w-8 h-8 text-yellow-500 hidden sm:block animate-pulse" />
              <div>
                <span className="text-xs font-mono text-muted-foreground uppercase block">Monte Carlo</span>
                <span className="text-lg sm:text-xl font-bold font-mono">10,000</span>
                <span className="text-[10px] text-muted-foreground font-mono block">Simulated runs</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-card-border bg-card/30 backdrop-blur-sm">
            <CardContent className="p-4 flex items-center gap-4">
              <Activity className="w-8 h-8 text-emerald-500/80 hidden sm:block" />
              <div>
                <span className="text-xs font-mono text-muted-foreground uppercase block">Qualified Teams</span>
                <span className="text-lg sm:text-xl font-bold font-mono">48</span>
                <span className="text-[10px] text-muted-foreground font-mono block">FIFA 2026 participants</span>
              </div>
            </CardContent>
          </Card>

          <Card className={`border-card-border bg-card/30 backdrop-blur-sm transition-all duration-300 ${
            liveCount > 0 ? "border-primary/45 shadow-sm shadow-primary/5 bg-primary/5" : ""
          }`}>
            <CardContent className="p-4 flex items-center gap-4">
              <CalendarDays className={`w-8 h-8 hidden sm:block ${liveCount > 0 ? "text-primary animate-bounce" : "text-muted-foreground/80"}`} />
              <div>
                <span className="text-xs font-mono text-muted-foreground uppercase block">Live Match Center</span>
                <span className={`text-lg sm:text-xl font-bold font-mono ${liveCount > 0 ? "text-primary" : ""}`}>
                  {liveCount}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono block">
                  {liveCount > 0 ? "Active simulation overrides" : "No results overridden"}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs Navigation */}
        <Tabs defaultValue="leaderboard" className="w-full space-y-6">
          <div className="flex justify-center border-b border-border pb-4">
            <TabsList className="bg-secondary/40 border border-border p-1 w-full max-w-2xl grid grid-cols-4 font-mono text-xs uppercase tracking-wider">
              <TabsTrigger value="leaderboard" className="cursor-pointer">Leaderboard</TabsTrigger>
              <TabsTrigger value="groups" className="cursor-pointer">Groups</TabsTrigger>
              <TabsTrigger value="simulator" className="cursor-pointer">Simulator</TabsTrigger>
              <TabsTrigger value="livecenter" className="cursor-pointer">Match Center</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="leaderboard" className="space-y-6 outline-none animate-in fade-in duration-300">
            <div>
              <h2 className="text-xl font-bold font-mono uppercase tracking-wider text-muted-foreground mb-1">
                Tournament Predictions
              </h2>
              <p className="text-xs text-muted-foreground">
                Rankings represent the simulated probability of each team winning the World Cup 2026. Click a row to see detailed offensive/defensive multipliers.
              </p>
            </div>
            <Leaderboard />
          </TabsContent>

          <TabsContent value="groups" className="space-y-6 outline-none animate-in fade-in duration-300">
            <div>
              <h2 className="text-xl font-bold font-mono uppercase tracking-wider text-muted-foreground mb-1">
                Group Standings
              </h2>
              <p className="text-xs text-muted-foreground">
                Simulated probabilities for winning and advancing from the 12 groups (A to L) under official FIFA 2026 tiebreakers.
              </p>
            </div>
            <GroupStandings />
          </TabsContent>

          <TabsContent value="simulator" className="outline-none animate-in fade-in duration-300">
            <MatchSimulator />
          </TabsContent>

          <TabsContent value="livecenter" className="outline-none animate-in fade-in duration-300">
            <LiveMatchCenter />
          </TabsContent>
        </Tabs>
      </div>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-24 pt-8 border-t border-border text-center">
        <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
          Data: 49,000+ international matches since 1872 · Model: Elo ratings + Poisson distribution + Dixon-Coles adjustments
        </p>
      </footer>
    </div>
  );
}
