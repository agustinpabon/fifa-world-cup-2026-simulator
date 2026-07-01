import React, { useState } from "react";
import {
  useGetSimulation,
  useGetTeams,
  type ProbabilityUncertainty,
  type TeamSimResult,
} from "@workspace/api-client-react";
import { AnimatedBar } from "@/components/ui/animated-bar";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TeamSquadContext } from "@/components/team-squad-context";
import { AlertTriangle, Search, ChevronUp, ChevronDown, SlidersHorizontal, Info, Shield, Zap } from "lucide-react";

type ColumnKey = "elo" | "groupWinPct" | "groupAdvancePct" | "roundOf16Pct" | "quarterFinalPct" | "semiFinalPct" | "finalPct" | "titlePct";

interface ColumnDef {
  key: ColumnKey;
  label: string;
  shortLabel: string;
  defaultVisible: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: "elo", label: "Elo Rating", shortLabel: "Elo", defaultVisible: true },
  { key: "groupWinPct", label: "Win Group", shortLabel: "Group Win", defaultVisible: true },
  { key: "groupAdvancePct", label: "Advance Group", shortLabel: "Group Adv", defaultVisible: true },
  { key: "roundOf16Pct", label: "Reach Round of 16", shortLabel: "R16", defaultVisible: false },
  { key: "quarterFinalPct", label: "Reach Quarter-Finals", shortLabel: "QF", defaultVisible: false },
  { key: "semiFinalPct", label: "Reach Semi-Finals", shortLabel: "SF", defaultVisible: false },
  { key: "finalPct", label: "Reach Final", shortLabel: "Final", defaultVisible: true },
  { key: "titlePct", label: "Win Title", shortLabel: "Champion", defaultVisible: true },
];

function formatProbability(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatInterval(uncertainty: ProbabilityUncertainty): string {
  return `${uncertainty.confidenceIntervalLowPct.toFixed(1)}-${uncertainty.confidenceIntervalHighPct.toFixed(1)}%`;
}

function getConfidenceMargin(probabilityPct: number, uncertainty: ProbabilityUncertainty): number {
  return Math.max(
    probabilityPct - uncertainty.confidenceIntervalLowPct,
    uncertainty.confidenceIntervalHighPct - probabilityPct
  );
}

function isNonSignificantTitleDifference(
  current: TeamSimResult,
  previous: TeamSimResult | undefined,
  zScore: number
): boolean {
  if (!previous) return false;

  const standardError = Math.hypot(
    current.uncertainty.titlePct.standardErrorPct,
    previous.uncertainty.titlePct.standardErrorPct
  );

  if (standardError === 0) {
    return current.titlePct === previous.titlePct;
  }

  return Math.abs(previous.titlePct - current.titlePct) <= zScore * standardError;
}

export function Leaderboard() {
  const { data: simulationResponse, isLoading: simLoading, isError: simError } = useGetSimulation();
  const { data: teamsResponse, isLoading: teamsLoading, isError: teamsError } = useGetTeams();

  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<ColumnKey>("titlePct");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [visibleCols, setVisibleCols] = useState<Record<ColumnKey, boolean>>(() => {
    const initial: Partial<Record<ColumnKey, boolean>> = {};
    COLUMNS.forEach((col) => {
      initial[col.key] = col.defaultVisible;
    });
    return initial as Record<ColumnKey, boolean>;
  });
  const [showFilters, setShowFilters] = useState(false);
  const [expandedTeamCode, setExpandedTeamCode] = useState<string | null>(null);

  const isLoading = simLoading || teamsLoading;
  const readiness = simulationResponse?.meta.readiness ?? teamsResponse?.meta.readiness;

  if (isLoading) {
    return (
      <div data-testid="leaderboard-loading" className="space-y-4">
        {[...Array(10)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full bg-card-border/50" />
        ))}
      </div>
    );
  }

  if (simError || teamsError) {
    return (
      <div
        data-testid="leaderboard-error"
        className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>Unable to load tournament predictions.</span>
      </div>
    );
  }

  if (readiness && readiness.state !== "ready") {
    return (
      <div
        data-testid="leaderboard-readiness"
        className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-4 text-sm text-muted-foreground"
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500" />
        <span>{readiness.message}</span>
      </div>
    );
  }

  const results = simulationResponse?.data.results ?? [];
  const activeResults = results.filter((team) => !team.eliminated);
  const hiddenEliminatedCount = results.length - activeResults.length;
  const teamsInfo = teamsResponse?.data.teams ?? [];
  const uncertainty = simulationResponse?.data.uncertainty;
  const confidenceLevelPct = Math.round((uncertainty?.confidenceLevel ?? 0.95) * 100);
  const maxConfidenceMarginPct = (uncertainty?.zScore ?? 1.96) * (uncertainty?.maxStandardErrorPct ?? 0);

  // Precompute absolute global ranks (based on win title % then Elo)
  const globalSorted = [...activeResults].sort((a, b) => b.titlePct - a.titlePct || b.elo - a.elo);
  const absoluteRanks = new Map<string, number>();
  const titleTies = new Map<string, boolean>();
  globalSorted.forEach((team, index) => {
    absoluteRanks.set(team.code, index + 1);
    titleTies.set(team.code, isNonSignificantTitleDifference(team, globalSorted[index - 1], uncertainty?.zScore ?? 1.96));
  });

  const handleSort = (key: ColumnKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("desc");
    }
  };

  const toggleColumn = (key: ColumnKey) => {
    setVisibleCols((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const filteredAndSorted = results
    .filter((t) => !t.eliminated)
    .filter((t) => t.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      const valA = a[sortKey] ?? 0;
      const valB = b[sortKey] ?? 0;
      return sortOrder === "asc" ? valA - valB : valB - valA;
    });

  const getSortIcon = (key: ColumnKey) => {
    if (sortKey !== key) return null;
    return sortOrder === "asc" ? (
      <ChevronUp className="w-3.5 h-3.5 inline ml-1 text-primary" />
    ) : (
      <ChevronDown className="w-3.5 h-3.5 inline ml-1 text-primary" />
    );
  };

  const toggleExpandRow = (code: string) => {
    setExpandedTeamCode(expandedTeamCode === code ? null : code);
  };

  const getTeamStats = (name: string) => {
    return teamsInfo.find((t) => t.name === name);
  };

  return (
    <div className="space-y-6">
      {/* Search and Column Filters controls */}
      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="leaderboard-search"
              placeholder="Search team..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-card/40 border-card-border"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            className={`border-card-border font-mono text-xs uppercase tracking-wider flex gap-2 items-center ${
              showFilters ? "bg-secondary text-primary" : "bg-card/45"
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Columns
          </Button>
        </div>

        {/* Column selectors panel */}
        {showFilters && (
          <div className="p-4 border border-card-border rounded-lg bg-card/30 backdrop-blur-sm animate-in slide-in-from-top-2 duration-200">
            <div className="text-xs font-mono uppercase text-muted-foreground mb-3 tracking-widest">
              Select Visible Columns
            </div>
            <div className="flex flex-wrap gap-2">
              {COLUMNS.map((col) => {
                const active = visibleCols[col.key];
                return (
                  <button
                    key={col.key}
                    onClick={() => toggleColumn(col.key)}
                    className={`px-3 py-1.5 rounded-full border text-xs font-mono transition-all duration-200 cursor-pointer ${
                      active
                        ? "bg-primary/10 text-primary border-primary/40 shadow-sm shadow-primary/10"
                        : "bg-background/40 text-muted-foreground border-border/60 hover:border-muted-foreground/35"
                    }`}
                  >
                    {col.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {uncertainty && results.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-card-border bg-card/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            Probabilities are Monte Carlo estimates. {confidenceLevelPct}% intervals are at most ±
            {maxConfidenceMarginPct.toFixed(1)} pts; ≈ marks title odds statistically tied with the team above.
          </span>
        </div>
      )}

      {hiddenEliminatedCount > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-card-border bg-card/30 px-3 py-2 text-xs text-muted-foreground">
          <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            {hiddenEliminatedCount} eliminated teams hidden from the leaderboard.
          </span>
        </div>
      )}

      {/* Leaderboard Table */}
      <div
        data-testid="leaderboard-table"
        className="w-full overflow-x-auto border border-card-border rounded-lg bg-card/50 backdrop-blur-sm"
      >
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-background text-muted-foreground font-mono border-b border-card-border">
            <tr>
              <th className="px-4 py-4 w-12 text-center">Rnk</th>
              <th className="px-4 py-4 min-w-[180px]">Team</th>
              <th className="px-4 py-4 w-16 text-center">Grp</th>
              {COLUMNS.map((col) => {
                if (!visibleCols[col.key]) return null;
                return (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="px-4 py-4 text-right cursor-pointer select-none hover:text-foreground hover:bg-background/25 transition-colors font-mono"
                  >
                    <div className="flex items-center justify-end gap-0.5">
                      {col.shortLabel}
                      {getSortIcon(col.key)}
                    </div>
                  </th>
                );
              })}
              {visibleCols["titlePct"] && <th className="px-4 py-4 min-w-[130px] hidden md:table-cell">Probability</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border font-mono">
            {filteredAndSorted.map((team) => {
              const isExpanded = expandedTeamCode === team.code;
              const absRank = absoluteRanks.get(team.code) ?? 0;
              const details = getTeamStats(team.name);
              const isTitleTie = titleTies.get(team.code) ?? false;
              const titleUncertainty = team.uncertainty.titlePct;
              const titleMargin = getConfidenceMargin(team.titlePct, titleUncertainty);

              return (
                <React.Fragment key={team.code}>
                  <tr
                    data-testid="leaderboard-row"
                    data-team-name={team.name}
                    onClick={() => toggleExpandRow(team.code)}
                    className={`hover:bg-background/40 transition-colors cursor-pointer select-none ${
                      isExpanded ? "bg-secondary/40 border-b-0" : ""
                    }`}
                  >
                    <td className="px-4 py-4 text-center text-muted-foreground font-bold">
                      <span>{absRank}</span>
                      {isTitleTie && (
                        <span
                          className="ml-1 text-primary"
                          title={`${confidenceLevelPct}% title interval overlaps the team above`}
                        >
                          ≈
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 font-sans font-medium text-foreground">
                      <span className="mr-2 text-lg">{team.flagEmoji}</span>
                      {team.name}
                      <Info className="w-3.5 h-3.5 ml-1.5 inline text-muted-foreground/60 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </td>
                    <td className="px-4 py-4 text-center text-muted-foreground">{team.group}</td>

                    {visibleCols["elo"] && (
                      <td className="px-4 py-4 text-right text-muted-foreground">
                        {Math.round(team.elo)}
                      </td>
                    )}
                    {visibleCols["groupWinPct"] && (
                      <td className="px-4 py-4 text-right text-muted-foreground">
                        <AnimatedNumber value={team.groupWinPct} format={(v) => v.toFixed(1) + "%"} />
                      </td>
                    )}
                    {visibleCols["groupAdvancePct"] && (
                      <td className="px-4 py-4 text-right text-muted-foreground font-semibold">
                        <AnimatedNumber value={team.groupAdvancePct} format={(v) => v.toFixed(1) + "%"} />
                      </td>
                    )}
                    {visibleCols["roundOf16Pct"] && (
                      <td className="px-4 py-4 text-right text-foreground">
                        <AnimatedNumber value={team.roundOf16Pct} format={(v) => v.toFixed(1) + "%"} />
                      </td>
                    )}
                    {visibleCols["quarterFinalPct"] && (
                      <td className="px-4 py-4 text-right text-foreground">
                        <AnimatedNumber value={team.quarterFinalPct} format={(v) => v.toFixed(1) + "%"} />
                      </td>
                    )}
                    {visibleCols["semiFinalPct"] && (
                      <td className="px-4 py-4 text-right text-foreground">
                        <AnimatedNumber value={team.semiFinalPct} format={(v) => v.toFixed(1) + "%"} />
                      </td>
                    )}
                    {visibleCols["finalPct"] && (
                      <td className="px-4 py-4 text-right text-foreground">
                        <AnimatedNumber value={team.finalPct} format={(v) => v.toFixed(1) + "%"} />
                      </td>
                    )}
                    {visibleCols["titlePct"] && (
                      <td className="px-4 py-4 text-right text-primary font-bold text-base">
                        <span
                          className="inline-flex flex-col items-end leading-tight"
                          title={`${confidenceLevelPct}% interval ${formatInterval(titleUncertainty)}`}
                        >
                          <AnimatedNumber value={team.titlePct} format={formatProbability} />
                          <span className="text-[10px] font-normal text-muted-foreground">
                            ±{titleMargin.toFixed(1)}
                          </span>
                        </span>
                      </td>
                    )}

                    {visibleCols["titlePct"] && (
                      <td className="px-4 py-4 hidden md:table-cell">
                        <AnimatedBar value={team.titlePct} className="w-full" />
                      </td>
                    )}
                  </tr>

                  {/* Expanded Row details */}
                  {isExpanded && (
                    <tr
                      data-testid="leaderboard-details"
                      className="bg-secondary/20 hover:bg-secondary/20 border-b border-card-border"
                    >
                      <td colSpan={11} className="p-4 font-sans">
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 animate-in fade-in duration-300">
                          {/* Profile Card */}
                          <div className="p-4 rounded-lg bg-card/60 border border-card-border flex flex-col justify-center">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-3xl">{team.flagEmoji}</span>
                              <div>
                                <h4 className="font-bold text-lg leading-tight text-foreground">{team.name}</h4>
                                <span className="font-mono text-xs text-muted-foreground uppercase">
                                  Group {team.group} · Code: {team.code}
                                </span>
                              </div>
                            </div>
                            <div className="mt-2 text-sm text-muted-foreground">
                              Ranked <span className="font-mono font-bold text-foreground">#{absRank}</span> in simulations
                              {isTitleTie ? "; title odds are statistically tied with the team above." : "."}
                            </div>
                          </div>

                          <TeamSquadContext teamName={team.name} />

                          {/* Goal strength multipliers */}
                          <div className="p-4 rounded-lg bg-card/60 border border-card-border">
                            <h5 className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1">
                              <Zap className="w-3.5 h-3.5 text-yellow-500" />
                              Goal Multipliers
                            </h5>
                            <div className="space-y-3">
                              <div>
                                <div className="flex justify-between text-xs font-mono mb-1 text-muted-foreground">
                                  <span>Attack Multiplier</span>
                                  <span className="text-foreground font-bold">{details?.attackStrength ? details.attackStrength.toFixed(1) : "1.0"}x</span>
                                </div>
                                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-primary rounded-full"
                                    style={{ width: `${Math.min(100, ((details?.attackStrength ?? 1) / 1.5) * 100)}%` }}
                                  />
                                </div>
                              </div>
                              <div>
                                <div className="flex justify-between text-xs font-mono mb-1 text-muted-foreground">
                                  <span>Defense Multiplier</span>
                                  <span className="text-foreground font-bold">{details?.defenseStrength ? details.defenseStrength.toFixed(1) : "1.0"}x</span>
                                </div>
                                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-destructive rounded-full"
                                    style={{ width: `${Math.min(100, ((details?.defenseStrength ?? 1) / 1.5) * 100)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-muted-foreground font-mono mt-1 block">
                                  *Lower defense strength factor is better (concedes fewer expected goals).
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Simulation overview */}
                          <div className="p-4 rounded-lg bg-card/60 border border-card-border font-mono text-xs space-y-2 flex flex-col justify-center">
                            <h5 className="uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1 font-bold">
                              <Shield className="w-3.5 h-3.5 text-primary" />
                              Simulation Progress
                            </h5>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Group Win:</span>
                              <span className="text-foreground font-bold">{team.groupWinPct.toFixed(1)}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Group Advance:</span>
                              <span className="text-foreground font-bold">{team.groupAdvancePct.toFixed(1)}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Reach Final:</span>
                              <span className="text-foreground font-bold">{team.finalPct.toFixed(1)}%</span>
                            </div>
                            <div className="flex justify-between border-t border-border pt-1.5">
                              <span className="text-primary font-bold">Win World Cup:</span>
                              <span className="text-right text-primary font-bold">
                                {team.titlePct.toFixed(1)}%
                                <span className="block text-[10px] font-normal text-muted-foreground">
                                  {confidenceLevelPct}% CI {formatInterval(titleUncertainty)}
                                </span>
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
