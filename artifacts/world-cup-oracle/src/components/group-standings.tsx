import React from "react";
import { useGetSimulation } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedNumber } from "@/components/ui/animated-number";

const GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

export function GroupStandings() {
  const { data: simulationData, isLoading } = useGetSimulation();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {GROUPS.map((g) => (
          <Skeleton key={g} className="h-64 w-full bg-card-border/50" />
        ))}
      </div>
    );
  }

  const results = simulationData?.results ?? [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {GROUPS.map((group) => {
        // Filter and sort teams in this group by advance percentage (simulated performance)
        const groupTeams = results
          .filter((t) => t.group === group)
          .sort((a, b) => {
            if (b.groupAdvancePct !== a.groupAdvancePct) {
              return b.groupAdvancePct - a.groupAdvancePct;
            }
            return b.elo - a.elo;
          });

        return (
          <Card key={group} className="border-card-border bg-card/40 backdrop-blur-sm overflow-hidden hover:border-primary/30 transition-all duration-300">
            <CardHeader className="bg-secondary/40 border-b border-border/60 py-3 px-4 flex flex-row justify-between items-center">
              <CardTitle className="text-sm font-bold font-mono tracking-wider text-muted-foreground">
                GROUP {group}
              </CardTitle>
              <span className="text-[10px] uppercase font-mono bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded">
                Simulated
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-xs font-mono text-left">
                <thead>
                  <tr className="text-[10px] text-muted-foreground border-b border-border/40 uppercase bg-background/20">
                    <th className="py-2 px-3 w-8 text-center">Pos</th>
                    <th className="py-2 px-2">Team</th>
                    <th className="py-2 px-2 text-right">Elo</th>
                    <th className="py-2 px-2 text-right">Win Grp</th>
                    <th className="py-2 px-3 text-right">Adv</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {groupTeams.map((team, idx) => {
                    const isQualifyingDirect = idx < 2;
                    const isWildcardZone = idx === 2;

                    return (
                      <tr 
                        key={team.code} 
                        className={`hover:bg-background/30 transition-colors ${
                          isQualifyingDirect 
                            ? "bg-primary/5 hover:bg-primary/10" 
                            : isWildcardZone 
                            ? "bg-yellow-500/5 hover:bg-yellow-500/10" 
                            : ""
                        }`}
                      >
                        <td className="py-2.5 px-3 text-center text-muted-foreground">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-2 font-sans font-medium text-foreground flex items-center gap-1.5 min-w-[110px]">
                          <span className="text-base leading-none">{team.flagEmoji}</span>
                          <span className="truncate">{team.name}</span>
                        </td>
                        <td className="py-2.5 px-2 text-right text-muted-foreground">
                          {Math.round(team.elo)}
                        </td>
                        <td className="py-2.5 px-2 text-right text-muted-foreground">
                          <AnimatedNumber value={team.groupWinPct} format={(v) => v.toFixed(1) + "%"} />
                        </td>
                        <td className={`py-2.5 px-3 text-right font-bold ${
                          isQualifyingDirect 
                            ? "text-primary" 
                            : isWildcardZone 
                            ? "text-yellow-500" 
                            : "text-muted-foreground"
                        }`}>
                          <AnimatedNumber value={team.groupAdvancePct} format={(v) => v.toFixed(1) + "%"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
