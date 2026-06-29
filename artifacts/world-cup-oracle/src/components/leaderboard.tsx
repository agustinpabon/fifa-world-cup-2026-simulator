import React from "react";
import { useGetSimulation } from "@workspace/api-client-react";
import { AnimatedBar } from "@/components/ui/animated-bar";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Skeleton } from "@/components/ui/skeleton";

export function Leaderboard() {
  const { data: simulationData, isLoading } = useGetSimulation();

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(10)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full bg-card-border/50" />
        ))}
      </div>
    );
  }

  if (!simulationData?.results) {
    return null;
  }

  const sortedResults = [...simulationData.results].sort((a, b) => b.titlePct - a.titlePct);

  return (
    <div className="w-full overflow-x-auto border border-card-border rounded-lg bg-card/50 backdrop-blur-sm">
      <table className="w-full text-sm text-left">
        <thead className="text-xs uppercase bg-background text-muted-foreground font-mono border-b border-card-border">
          <tr>
            <th className="px-4 py-4 w-12 text-center">Rnk</th>
            <th className="px-4 py-4 min-w-[180px]">Team</th>
            <th className="px-4 py-4 w-16 text-center">Grp</th>
            <th className="px-4 py-4 text-right">Elo</th>
            <th className="px-4 py-4 min-w-[120px] text-right">Win Title</th>
            <th className="px-4 py-4 hidden sm:table-cell text-right">Reach Final</th>
            <th className="px-4 py-4 hidden md:table-cell text-right">Win Group</th>
            <th className="px-4 py-4 min-w-[150px]">Probability</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-card-border font-mono">
          {sortedResults.map((team, index) => (
            <tr 
              key={team.code} 
              className="hover:bg-background/50 transition-colors animate-in fade-in slide-in-from-bottom-2 fill-mode-both"
              style={{ animationDelay: `${index * 30}ms` }}
            >
              <td className="px-4 py-4 text-center text-muted-foreground">{index + 1}</td>
              <td className="px-4 py-4 font-sans font-medium text-foreground">
                <span className="mr-2 text-lg">{team.flagEmoji}</span>
                {team.name}
              </td>
              <td className="px-4 py-4 text-center text-muted-foreground">{team.group}</td>
              <td className="px-4 py-4 text-right text-muted-foreground">{Math.round(team.elo)}</td>
              <td className="px-4 py-4 text-right text-primary font-bold text-base">
                <AnimatedNumber value={team.titlePct} format={v => v.toFixed(1) + "%"} />
              </td>
              <td className="px-4 py-4 hidden sm:table-cell text-right text-foreground">
                <AnimatedNumber value={team.finalPct} format={v => v.toFixed(1) + "%"} />
              </td>
              <td className="px-4 py-4 hidden md:table-cell text-right text-muted-foreground">
                <AnimatedNumber value={team.groupWinPct} format={v => v.toFixed(1) + "%"} />
              </td>
              <td className="px-4 py-4">
                <AnimatedBar value={team.titlePct} className="w-full" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
