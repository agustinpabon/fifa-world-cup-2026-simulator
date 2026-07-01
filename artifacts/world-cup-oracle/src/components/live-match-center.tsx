import React, { useState, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTeams,
  useGetLiveMatches,
  useGetOracleStatus,
  useRecordLiveMatch,
  useDeleteLiveMatch,
  useClearLiveMatches,
  getGetSimulationQueryKey,
  getGetOracleStatusQueryKey,
  getGetLiveMatchesQueryKey,
  getGetSquadsQueryKey,
  useGetSquads,
  type TeamSquad,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { getApiErrorMessage } from "@/lib/api-errors";
import { Activity, RotateCcw, AlertTriangle, Search } from "lucide-react";
import { MatchContextPanel } from "@/components/match-context-panel";
import {
  getSquadsProviderLabel,
  getSquadsSourceStatus,
} from "@/components/team-squad-context";
import type { SourceStatus } from "@/components/source-status-badge";

interface PlayedMatch {
  matchNumber?: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  stage?: string;
  source?: "fixture" | "official" | "espn" | "custom";
  date?: string;
  kickoffTimeEt?: string;
  status?: "scheduled" | "live" | "finished";
  statusDetail?: string;
  group?: string;
  venue?: string;
  region?: string;
  winnerTeam?: string;
}

type MatchStageTab = "results" | "group" | "knockout";

export function LiveMatchCenter() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: teamsResponse, isLoading: teamsLoading } = useGetTeams();
  const { data: matchesResponse, isLoading: matchesLoading } = useGetLiveMatches({
    query: {
      queryKey: getGetLiveMatchesQueryKey(),
      refetchInterval: 15_000,
    },
  });
  const { data: squadsResponse, isError: squadsError } = useGetSquads({
    query: {
      queryKey: getGetSquadsQueryKey(),
      retry: false,
      staleTime: 10 * 60_000,
    },
  });
  const { data: oracleStatus } = useGetOracleStatus({
    query: {
      queryKey: getGetOracleStatusQueryKey(),
      refetchInterval: (query) => (query.state.data?.data.recalculating ? 1000 : false),
    },
  });

  const recordLiveMatch = useRecordLiveMatch();
  const deleteLiveMatch = useDeleteLiveMatch();
  const clearLiveMatches = useClearLiveMatches();

  const [stageTab, setStageTab] = useState<MatchStageTab>("results");
  const [activeGroup, setActiveGroup] = useState<string>("A");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const teams = teamsResponse?.data.teams ?? [];
  const playedMatches = (matchesResponse?.data.playedMatches ?? []) as PlayedMatch[];
  const groups = useMemo(() => [...new Set(teams.map((team) => team.group))].sort(), [teams]);
  const squadsByTeam = useMemo(() => {
    return new Map((squadsResponse?.data.squads ?? []).map((squad) => [squad.team, squad]));
  }, [squadsResponse]);
  const squadsSourceStatus = getSquadsSourceStatus(squadsResponse, squadsError);
  const squadsProvider = getSquadsProviderLabel(squadsResponse);
  const squadsLastUpdated =
    squadsResponse?.data.externalProvenance.loadedAt ?? squadsResponse?.data.provenance.accessedDate ?? null;

  useEffect(() => {
    if (groups.length > 0 && !groups.includes(activeGroup)) {
      setActiveGroup(groups[0]);
    }
  }, [activeGroup, groups]);

  const handleInvalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetSimulationQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetOracleStatusQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetLiveMatchesQueryKey() });
  };

  const handleRecordMatch = async (mHome: string, mAway: string, hScore: number, aScore: number) => {
    return new Promise<void>((resolve, reject) => {
      recordLiveMatch.mutate(
        {
          data: {
            homeTeam: mHome,
            awayTeam: mAway,
            homeScore: hScore,
            awayScore: aScore,
          },
        },
        {
          onSuccess: (res) => {
            toast({
              title: "Manual Override Recorded",
              description: res.data.message || `Recorded: ${mHome} ${hScore} - ${aScore} ${mAway}`,
            });
            handleInvalidate();
            resolve();
          },
          onError: (err: unknown) => {
            toast({
              title: "Error Recording Match",
              description: getApiErrorMessage(err),
              variant: "destructive",
            });
            reject(err);
          },
        }
      );
    });
  };

  const handleDeleteMatch = async (mHome: string, mAway: string) => {
    return new Promise<void>((resolve, reject) => {
      deleteLiveMatch.mutate(
        {
          data: {
            homeTeam: mHome,
            awayTeam: mAway,
          },
        },
        {
          onSuccess: () => {
            toast({
              title: "Override Removed",
              description: `Removed manual override for ${mHome} vs ${mAway}`,
            });
            handleInvalidate();
            resolve();
          },
          onError: (err: unknown) => {
            toast({
              title: "Error Removing Match",
              description: getApiErrorMessage(err),
              variant: "destructive",
            });
            reject(err);
          },
        }
      );
    });
  };

  const handleClearAll = () => {
    setIsSubmitting(true);
    clearLiveMatches.mutate(
      undefined,
      {
        onSuccess: (res) => {
          toast({
            title: "Overrides Cleared",
            description: res.data.message || "All manual scenario overrides have been cleared.",
          });
          handleInvalidate();
        },
        onError: (err: unknown) => {
          toast({
            title: "Error Clearing Overrides",
            description: getApiErrorMessage(err),
            variant: "destructive",
          });
        },
        onSettled: () => {
          setIsSubmitting(false);
        },
      }
    );
  };

  const getFlag = (teamName: string) => {
    return teams.find((t) => t.name === teamName)?.flagEmoji ?? "🏳️";
  };

  const getTeamGroup = (teamName: string) => {
    return teams.find((t) => t.name === teamName)?.group;
  };

  const isKnockoutMatch = (home: string, away: string) => {
    const groupA = getTeamGroup(home);
    const groupB = getTeamGroup(away);
    return groupA && groupB && groupA !== groupB;
  };

  const scheduledGroupMatches = useMemo(() => {
    return playedMatches
      .filter((match) => match.stage === "Group Stage")
      .map((match) => ({
        ...match,
        group: match.group ?? getTeamGroup(match.homeTeam) ?? "",
        stage: "Group Stage" as const,
      }))
      .sort((a, b) => (a.matchNumber ?? Number.MAX_SAFE_INTEGER) - (b.matchNumber ?? Number.MAX_SAFE_INTEGER));
  }, [playedMatches, teams]);

  const resultMatches = useMemo(() => {
    return playedMatches
      .filter((match) => {
        const hasScore = match.homeScore >= 0 && match.awayScore >= 0;
        const isLiveOrFinal = match.status === "live" || match.status === "finished" || hasScore;
        return isLiveOrFinal && match.source !== "fixture";
      })
      .map((match) => {
        const isKnockout = match.stage === "Knockout" || isKnockoutMatch(match.homeTeam, match.awayTeam);
        return {
          ...match,
          group: match.group ?? getTeamGroup(match.homeTeam) ?? "",
          stage: isKnockout ? ("Knockout" as const) : ("Group Stage" as const),
        };
      })
      .sort((a, b) => {
        if (a.status === "live" && b.status !== "live") return -1;
        if (b.status === "live" && a.status !== "live") return 1;
        return (b.matchNumber ?? 0) - (a.matchNumber ?? 0);
      });
  }, [playedMatches, teams]);

  // Extract knockout matches currently in the match list from manual scenario overrides.
  const knockoutMatches = useMemo(() => {
    return playedMatches.filter((m) => m.stage === "Knockout" || isKnockoutMatch(m.homeTeam, m.awayTeam));
  }, [playedMatches, teams]);

  // Filter matches based on search query or active stage/group tab
  const matchesToDisplay = useMemo(() => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      // In search mode, search across all matches (results + group + knockout)
      const resultsFiltered = resultMatches.filter(
        (m) =>
          m.homeTeam.toLowerCase().includes(query) ||
          m.awayTeam.toLowerCase().includes(query)
      );

      const groupFiltered = scheduledGroupMatches.filter(
        (m) =>
          m.homeTeam.toLowerCase().includes(query) ||
          m.awayTeam.toLowerCase().includes(query)
      ).map(m => ({ ...m, stage: "Group Stage" as const }));

      const knockoutFiltered = knockoutMatches.filter(
        (m) =>
          m.homeTeam.toLowerCase().includes(query) ||
          m.awayTeam.toLowerCase().includes(query)
      ).map(m => ({ ...m, group: getTeamGroup(m.homeTeam) || "", stage: "Knockout" as const }));

      return [...resultsFiltered, ...knockoutFiltered, ...groupFiltered];
    }

    if (stageTab === "results") {
      return resultMatches;
    }

    if (stageTab === "knockout") {
      return knockoutMatches.map(m => ({ ...m, group: getTeamGroup(m.homeTeam) || "", stage: "Knockout" as const }));
    } else {
      return scheduledGroupMatches.filter((m) => m.group === activeGroup).map(m => ({ ...m, stage: "Group Stage" as const }));
    }
  }, [resultMatches, scheduledGroupMatches, knockoutMatches, stageTab, activeGroup, searchQuery, teams]);

  // Statistics calculations
  const totalTournamentMatches = 104; // 72 group stage + 32 knockout matches
  const finishedMatches = playedMatches.filter((m) => m.homeScore >= 0 && m.awayScore >= 0);
  const importedFixtureCount = playedMatches.filter((m) => m.source === "fixture").length;
  const externalFeedCount = playedMatches.filter((m) => m.source === "espn" || m.source === "official").length;
  const customCount = finishedMatches.filter((m) => m.source === "custom").length;
  const resultCount = resultMatches.length;
  const progressPct = Math.min(100, Math.max(0, (customCount / totalTournamentMatches) * 100));
  const isRecalculating = oracleStatus?.data.recalculating ?? false;

  const isLoading = teamsLoading || matchesLoading;

  return (
    <div data-testid="match-center" className="space-y-6">
      {/* Progress & Quick Stats Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 border-border/60 bg-card/45 backdrop-blur-sm">
          <CardContent className="p-5 flex flex-col justify-between h-full gap-4">
            <div className="flex items-center justify-between text-xs font-mono font-bold text-muted-foreground uppercase tracking-wider">
              <span>Manual Scenario Overrides</span>
              <span className="text-primary font-bold">{customCount} / {totalTournamentMatches} Overrides</span>
            </div>
            <div className="w-full bg-secondary/60 h-2.5 rounded-full overflow-hidden border border-border/20">
              <div
                className="bg-primary h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground font-sans">
              {importedFixtureCount} local fixtures and {externalFeedCount} feed matches loaded.{" "}
              {customCount > 0 ? "Manual overrides active." : "No manual overrides active."}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/45 backdrop-blur-sm flex flex-col justify-center">
          <CardContent className="p-5 flex flex-col justify-between h-full gap-4">
            <div>
              <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-widest block mb-1">
                Tournament Simulation
              </span>
              <span className={`text-2xl font-bold font-mono leading-none ${
                isRecalculating ? "text-primary" : "text-foreground"
              }`}>
                {isRecalculating ? "Updating" : "10,000 runs"}
              </span>
              {isRecalculating && (
                <span className="mt-2 text-[11px] text-primary font-mono uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 animate-spin" />
                  Last simulation stays visible
                </span>
              )}
            </div>
            {customCount > 0 && (
              <Button
                onClick={handleClearAll}
                variant="destructive"
                size="sm"
                className="w-full h-8 font-sans text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer font-bold"
                disabled={isSubmitting}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Clear {customCount} Overrides
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Tab Navigation & Controls */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between pb-2 border-b border-border/40">
          {/* Main Stage Tabs */}
          {!searchQuery && (
            <div className="flex items-center gap-2 bg-secondary/20 p-1 rounded-lg border border-border/40">
              <button
                data-testid="match-stage-results"
                onClick={() => setStageTab("results")}
                className={`px-4 py-1.5 rounded-md text-xs font-semibold font-sans transition-all ${
                  stageTab === "results"
                    ? "bg-primary text-primary-foreground shadow-sm font-bold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Results & Live
              </button>
              <button
                data-testid="match-stage-knockout"
                onClick={() => setStageTab("knockout")}
                className={`px-4 py-1.5 rounded-md text-xs font-semibold font-sans transition-all ${
                  stageTab === "knockout"
                    ? "bg-primary text-primary-foreground shadow-sm font-bold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Knockout Stage
              </button>
              <button
                data-testid="match-stage-group"
                onClick={() => setStageTab("group")}
                className={`px-4 py-1.5 rounded-md text-xs font-semibold font-sans transition-all ${
                  stageTab === "group"
                    ? "bg-primary text-primary-foreground shadow-sm font-bold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Group Stage
              </button>
            </div>
          )}

          {/* Search bar */}
          <div className="relative w-full sm:max-w-xs ml-auto">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground/60" />
            <Input
              placeholder="Search country (e.g. Argentina)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 bg-background/50 border-border/80 placeholder:text-muted-foreground/60 text-sm font-sans pl-9 pr-8"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Group stage sub-navigation */}
        {stageTab === "group" && !searchQuery && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none">
            {groups.map((g) => (
              <button
                key={g}
                onClick={() => setActiveGroup(g)}
                className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold uppercase transition-all shrink-0 ${
                  activeGroup === g
                    ? "bg-primary/20 text-primary border border-primary/30 font-bold"
                    : "bg-secondary/40 text-muted-foreground border border-border/40 hover:text-foreground hover:bg-secondary/80"
                }`}
              >
                Group {g}
              </button>
            ))}
          </div>
        )}

        {stageTab === "results" && !searchQuery && (
          <div
            data-testid="match-results-summary"
            className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-muted-foreground font-sans"
          >
            <span className="font-mono font-bold uppercase tracking-wider text-primary">
              {resultCount} {resultCount === 1 ? "result" : "results"}
            </span>{" "}
            loaded from live feed, official imports, and manual scenario overrides.
          </div>
        )}

        {/* Match cards list */}
        {isLoading ? (
          <div className="py-24 text-center text-muted-foreground font-mono text-sm uppercase tracking-widest animate-pulse">
            Loading imported World Cup fixtures...
          </div>
        ) : matchesToDisplay.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-border/80 rounded-2xl flex flex-col items-center justify-center gap-3 bg-card/20">
            <AlertTriangle className="w-8 h-8 text-muted-foreground/60" />
            <span className="font-sans text-sm font-semibold text-muted-foreground">
              No matches found
            </span>
            <p className="text-xs text-muted-foreground/80 max-w-sm px-4">
              {stageTab === "results"
                ? "No live or finished results are loaded yet. The group tab still shows the full fixture schedule."
                : "Try searching for another country or select a different stage."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {matchesToDisplay.map((match) => {
              // Find if this match has a matching fixture or manual override record.
              const played = playedMatches.find(
                (m) =>
                  (m.homeTeam === match.homeTeam && m.awayTeam === match.awayTeam) ||
                  (m.homeTeam === match.awayTeam && m.awayTeam === match.homeTeam)
              );

              return (
                <MatchCard
                  key={`${match.matchNumber ?? `${match.homeTeam}-${match.awayTeam}`}`}
                  homeTeam={match.homeTeam}
                  awayTeam={match.awayTeam}
                  group={match.group}
                  stage={match.stage}
                  playedMatch={played}
                  onRecord={(hScore, aScore) => handleRecordMatch(match.homeTeam, match.awayTeam, hScore, aScore)}
                  onDelete={() => handleDeleteMatch(match.homeTeam, match.awayTeam)}
                  getFlag={getFlag}
                  homeSquad={squadsByTeam.get(match.homeTeam)}
                  awaySquad={squadsByTeam.get(match.awayTeam)}
                  squadsProvider={squadsProvider}
                  squadsSourceStatus={squadsSourceStatus}
                  squadsLastUpdated={squadsLastUpdated}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Local Sub-component for Match Card
interface MatchCardProps {
  homeTeam: string;
  awayTeam: string;
  group: string;
  stage: "Group Stage" | "Knockout";
  playedMatch?: PlayedMatch;
  onRecord: (homeScore: number, awayScore: number) => Promise<void>;
  onDelete: () => Promise<void>;
  getFlag: (teamName: string) => string;
  homeSquad?: TeamSquad;
  awaySquad?: TeamSquad;
  squadsProvider: string;
  squadsSourceStatus: SourceStatus;
  squadsLastUpdated?: string | null;
}

function MatchCard({
  homeTeam,
  awayTeam,
  group,
  stage,
  playedMatch,
  onRecord,
  onDelete,
  getFlag,
  homeSquad,
  awaySquad,
  squadsProvider,
  squadsSourceStatus,
  squadsLastUpdated,
}: MatchCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [homeInput, setHomeInput] = useState("");
  const [awayInput, setAwayInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Sync inputs when playedMatch changes
  useEffect(() => {
    if (playedMatch) {
      const isUnplayed = playedMatch.homeScore === -1 && playedMatch.awayScore === -1;
      if (isUnplayed) {
        setHomeInput("");
        setAwayInput("");
      } else {
        if (playedMatch.homeTeam === homeTeam) {
          setHomeInput(playedMatch.homeScore.toString());
          setAwayInput(playedMatch.awayScore.toString());
        } else {
          setHomeInput(playedMatch.awayScore.toString());
          setAwayInput(playedMatch.homeScore.toString());
        }
      }
    } else {
      setHomeInput("");
      setAwayInput("");
    }
  }, [playedMatch, homeTeam, isEditing]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const hScore = parseInt(homeInput, 10);
    const aScore = parseInt(awayInput, 10);
    if (isNaN(hScore) || isNaN(aScore) || hScore < 0 || aScore < 0) return;

    setSubmitting(true);
    try {
      await onRecord(hScore, aScore);
      setIsEditing(false);
    } catch {
      // toast shown inside caller handler
    } finally {
      setSubmitting(false);
    }
  };

  const hasRecorded = !!playedMatch;
  const isUnplayed = playedMatch?.homeScore === -1 && playedMatch?.awayScore === -1;
  const isImportedResult = playedMatch?.source === "official";
  const isEspnResult = playedMatch?.source === "espn";
  const isCustom = playedMatch?.source === "custom";
  const isLive = playedMatch?.status === "live";

  // Display mode for imported results or manual overrides with actual scores.
  if (hasRecorded && !isUnplayed && !isEditing) {
    return (
      <div
        data-testid="match-card"
        data-home-team={homeTeam}
        data-away-team={awayTeam}
        className={`p-4 rounded-xl border transition-all ${
          isCustom
            ? "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 shadow-sm"
            : isImportedResult || isEspnResult
            ? "border-emerald-500/20 bg-emerald-500/3 hover:bg-emerald-500/8"
            : "border-emerald-500/20 bg-emerald-500/3 hover:bg-emerald-500/8"
        }`}
      >
        <div className="flex items-center justify-between gap-4">
          <span className="text-[10px] font-mono text-muted-foreground font-bold px-2 py-0.5 bg-secondary/80 rounded uppercase">
            {stage === "Group Stage" ? `Group ${group}` : "Knockout"}
          </span>
          <div className="flex items-center gap-1.5">
            {isLive && (
              <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                Live {playedMatch?.statusDetail ? `· ${playedMatch.statusDetail}` : ""}
              </span>
            )}
            {isImportedResult && (
              <span className="text-[10px] font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                Imported Result
              </span>
            )}
            {isEspnResult && !isLive && (
              <span className="text-[10px] font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                ESPN Feed
              </span>
            )}
            {isCustom && (
              <span className="text-[10px] font-semibold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                Manual Override
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-7 items-center my-4 font-semibold">
          {/* Home team */}
          <div className="col-span-3 flex items-center justify-end gap-2.5 text-right">
            <span className="font-sans text-sm sm:text-base text-foreground leading-tight">{homeTeam}</span>
            <span className="text-2xl leading-none" title={homeTeam}>{getFlag(homeTeam)}</span>
          </div>

          {/* Score display */}
          <div className="col-span-1 flex justify-center">
            <div className="font-mono text-lg sm:text-xl font-bold bg-secondary/90 px-3 py-1 rounded-lg border shadow-inner flex gap-2 text-primary border-border/80">
              <span>{homeInput}</span>
              <span className="text-muted-foreground/60">-</span>
              <span>{awayInput}</span>
            </div>
          </div>

          {/* Away team */}
          <div className="col-span-3 flex items-center justify-start gap-2.5 text-left">
            <span className="text-2xl leading-none" title={awayTeam}>{getFlag(awayTeam)}</span>
            <span className="font-sans text-sm sm:text-base text-foreground leading-tight">{awayTeam}</span>
          </div>
        </div>

        {isCustom && (
          <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-border/40">
            <Button
              onClick={() => setIsEditing(true)}
              variant="ghost"
              size="sm"
              className="h-8 font-sans text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 cursor-pointer"
            >
              Edit
            </Button>
            <Button
              onClick={onDelete}
              variant="ghost"
              size="sm"
              className="h-8 font-sans text-xs text-destructive hover:text-destructive hover:bg-destructive/10 flex items-center gap-1.5 cursor-pointer"
              title="Restore to simulated state"
            >
              Restore
            </Button>
          </div>
        )}
        {!isCustom && playedMatch?.winnerTeam && (
          <div className="text-[11px] text-muted-foreground mt-2 pt-2 border-t border-border/40 text-right font-sans">
            Winner: <span className="text-foreground font-semibold">{playedMatch.winnerTeam}</span>
          </div>
        )}
        <MatchContextPanel
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          homeSquad={homeSquad}
          awaySquad={awaySquad}
          squadsProvider={squadsProvider}
          squadsSourceStatus={squadsSourceStatus}
          squadsLastUpdated={squadsLastUpdated}
        />
      </div>
    );
  }

  // Edit / Input mode (or unplayed match mode)
  const canSave = homeInput !== "" && awayInput !== "" && !submitting;

  return (
    <form
      data-testid="match-card"
      data-home-team={homeTeam}
      data-away-team={awayTeam}
      onSubmit={handleSave}
      className={`p-4 rounded-xl border bg-card/25 hover:bg-card/45 transition-all ${
        isEditing ? "border-primary/40 ring-1 ring-primary/20 shadow-md" : "border-border/60"
      }`}
    >
      <div className="flex items-center justify-between gap-4 mb-3">
        <span className="text-[10px] font-mono text-muted-foreground font-bold px-2 py-0.5 bg-secondary/80 rounded uppercase">
          {stage === "Group Stage" ? `Group ${group}` : "Knockout"}
        </span>
        {isEditing ? (
          <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full font-sans">
            Editing score
          </span>
        ) : (
          <span className="text-[10px] font-semibold text-muted-foreground/60 bg-secondary/60 px-2 py-0.5 rounded-full font-sans">
            Unplayed / Scheduled
          </span>
        )}
      </div>

      <div className="grid grid-cols-7 items-center my-3 font-semibold">
        {/* Home team */}
        <div className="col-span-3 flex items-center justify-end gap-2.5 text-right">
          <span className="font-sans text-sm sm:text-base text-foreground/90 leading-tight">{homeTeam}</span>
          <span className="text-2xl leading-none">{getFlag(homeTeam)}</span>
        </div>

        {/* Input fields */}
        <div className="col-span-1 flex items-center justify-center gap-1 mx-2">
          <input
            data-testid="home-score-input"
            aria-label={`${homeTeam} score`}
            type="number"
            min="0"
            placeholder="-"
            value={homeInput}
            onChange={(e) => setHomeInput(e.target.value)}
            disabled={submitting}
            className="w-10 h-10 text-center font-mono text-base font-bold bg-background border border-border/80 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            required
          />
          <span className="text-muted-foreground/60 font-bold">-</span>
          <input
            data-testid="away-score-input"
            aria-label={`${awayTeam} score`}
            type="number"
            min="0"
            placeholder="-"
            value={awayInput}
            onChange={(e) => setAwayInput(e.target.value)}
            disabled={submitting}
            className="w-10 h-10 text-center font-mono text-base font-bold bg-background border border-border/80 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            required
          />
        </div>

        {/* Away team */}
        <div className="col-span-3 flex items-center justify-start gap-2.5 text-left">
          <span className="text-2xl leading-none">{getFlag(awayTeam)}</span>
          <span className="font-sans text-sm sm:text-base text-foreground/90 leading-tight">{awayTeam}</span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-border/40">
        {isEditing && (
          <Button
            type="button"
            onClick={() => setIsEditing(false)}
            variant="ghost"
            size="sm"
            className="h-8 font-sans text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            disabled={submitting}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="h-8 font-sans text-xs border-primary/30 text-primary hover:bg-primary/10 hover:text-primary flex items-center gap-1.5 cursor-pointer font-bold"
          disabled={!canSave}
        >
          {submitting ? "Saving..." : "Save"}
        </Button>
      </div>
      <MatchContextPanel
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        homeSquad={homeSquad}
        awaySquad={awaySquad}
        squadsProvider={squadsProvider}
        squadsSourceStatus={squadsSourceStatus}
        squadsLastUpdated={squadsLastUpdated}
      />
    </form>
  );
}
