import React from "react";
import {
  useGetOracleStatus,
  getGetOracleStatusQueryKey,
} from "@workspace/api-client-react";
import { Leaderboard } from "@/components/leaderboard";
import { MatchSimulator } from "@/components/match-simulator";
import { useEnforceDarkMode } from "@/hooks/use-dark-mode";
import { Activity } from "lucide-react";

export default function Dashboard() {
  useEnforceDarkMode();

  const { data: status } = useGetOracleStatus({
    query: {
      queryKey: getGetOracleStatusQueryKey(),
      refetchInterval: (query) => (query.state.data?.ready ? false : 2000),
    }
  });

  const isReady = status?.ready;

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 selection:bg-primary/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12">
        {/* Header */}
        <header className="mb-12 border-b border-border pb-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-2">
                World Cup <span className="text-primary">Oracle</span>
              </h1>
              <p className="text-muted-foreground font-mono text-sm uppercase tracking-widest">
                2026 FIFA World Cup · Monte Carlo Simulation · 10,000 runs
              </p>
            </div>
            
            <div className="flex items-center gap-3 bg-secondary/50 px-4 py-2 rounded-full border border-border">
              {isReady ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="font-mono text-sm uppercase text-primary font-bold tracking-wider">Ready</span>
                </>
              ) : (
                <>
                  <Activity className="w-4 h-4 text-yellow-500 animate-spin" />
                  <span className="font-mono text-sm uppercase text-yellow-500 tracking-wider">
                    {status?.message || "Loading..."}
                  </span>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="space-y-12">
          {/* Top Level Simulator */}
          <section>
            <MatchSimulator />
          </section>

          {/* Main Leaderboard */}
          <section>
            <div className="flex justify-between items-end mb-6">
              <h2 className="text-2xl font-bold font-mono uppercase tracking-wider">Tournament Predictions</h2>
            </div>
            <Leaderboard />
          </section>
        </main>
      </div>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-24 pt-8 border-t border-border text-center">
        <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
          Data: 49,000+ international matches since 1872 · Model: Elo ratings + Poisson distribution
        </p>
      </footer>
    </div>
  );
}
