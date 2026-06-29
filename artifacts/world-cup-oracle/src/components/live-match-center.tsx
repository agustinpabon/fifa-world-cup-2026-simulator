import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTeams,
  useGetLiveMatches,
  useRecordLiveMatch,
  useDeleteLiveMatch,
  useClearLiveMatches,
  getGetSimulationQueryKey,
  getGetOracleStatusQueryKey,
  getGetLiveMatchesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus, RotateCcw, AlertTriangle } from "lucide-react";

export function LiveMatchCenter() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: teamsData, isLoading: teamsLoading } = useGetTeams();
  const { data: matchesData, isLoading: matchesLoading } = useGetLiveMatches();

  const recordLiveMatch = useRecordLiveMatch();
  const deleteLiveMatch = useDeleteLiveMatch();
  const clearLiveMatches = useClearLiveMatches();

  const [homeTeam, setHomeTeam] = useState<string>("");
  const [awayTeam, setAwayTeam] = useState<string>("");
  const [homeScore, setHomeScore] = useState<string>("");
  const [awayScore, setAwayScore] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const teams = teamsData?.teams ?? [];
  const playedMatches = matchesData?.playedMatches ?? [];

  const handleInvalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetSimulationQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetOracleStatusQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetLiveMatchesQueryKey() });
  };

  const handleRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!homeTeam || !awayTeam || homeScore === "" || awayScore === "" || isSubmitting) return;

    if (homeTeam === awayTeam) {
      toast({
        title: "Invalid Matchup",
        description: "A team cannot play against itself.",
        variant: "destructive",
      });
      return;
    }

    const hScore = parseInt(homeScore, 10);
    const aScore = parseInt(awayScore, 10);

    if (isNaN(hScore) || isNaN(aScore) || hScore < 0 || aScore < 0) {
      toast({
        title: "Invalid Scores",
        description: "Scores must be non-negative integers.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    recordLiveMatch.mutate(
      {
        data: {
          homeTeam,
          awayTeam,
          homeScore: hScore,
          awayScore: aScore,
        },
      },
      {
        onSuccess: (res) => {
          toast({
            title: "Live Match Recorded",
            description: res.message || `Recorded: ${homeTeam} ${hScore} - ${aScore} ${awayTeam}`,
          });
          setHomeTeam("");
          setAwayTeam("");
          setHomeScore("");
          setAwayScore("");
          handleInvalidate();
        },
        onError: (err: any) => {
          toast({
            title: "Error Recording Match",
            description: err?.response?.data?.error || "An error occurred.",
            variant: "destructive",
          });
        },
        onSettled: () => {
          setIsSubmitting(false);
        },
      }
    );
  };

  const handleDelete = (mHome: string, mAway: string) => {
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
            title: "Recorded Match Removed",
            description: `Removed result for ${mHome} vs ${mAway}`,
          });
          handleInvalidate();
        },
        onError: (err: any) => {
          toast({
            title: "Error Removing Match",
            description: err?.response?.data?.error || "An error occurred.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleClearAll = () => {
    clearLiveMatches.mutate(
      undefined,
      {
        onSuccess: (res) => {
          toast({
            title: "Simulation Reset",
            description: res.message || "All live match data has been cleared.",
          });
          handleInvalidate();
        },
        onError: () => {
          toast({
            title: "Error resetting simulation",
            description: "An error occurred.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const getFlag = (teamName: string) => {
    return teams.find((t) => t.name === teamName)?.flagEmoji ?? "🏳️";
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Input Form Card */}
      <Card className="lg:col-span-1 border-card-border bg-card/50 backdrop-blur-sm h-fit">
        <CardHeader>
          <CardTitle className="text-xl uppercase tracking-wider text-muted-foreground font-mono">
            Record Result
          </CardTitle>
          <CardDescription>
            Enter a match result. This updates the starting state for the 10,000 tournament simulations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRecord} className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground uppercase font-mono mb-2 block">
                Home Team
              </label>
              <select
                value={homeTeam}
                onChange={(e) => setHomeTeam(e.target.value)}
                disabled={teamsLoading || isSubmitting}
                className="w-full h-9 rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                required
              >
                <option value="">Select home team...</option>
                {teams.map((t) => (
                  <option key={t.code} value={t.name}>
                    {t.flagEmoji} {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground uppercase font-mono mb-2 block">
                  Home Score
                </label>
                <Input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={homeScore}
                  onChange={(e) => setHomeScore(e.target.value)}
                  disabled={isSubmitting}
                  className="bg-background/50 border-border"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground uppercase font-mono mb-2 block">
                  Away Score
                </label>
                <Input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={awayScore}
                  onChange={(e) => setAwayScore(e.target.value)}
                  disabled={isSubmitting}
                  className="bg-background/50 border-border"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground uppercase font-mono mb-2 block">
                Away Team
              </label>
              <select
                value={awayTeam}
                onChange={(e) => setAwayTeam(e.target.value)}
                disabled={teamsLoading || isSubmitting}
                className="w-full h-9 rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                required
              >
                <option value="">Select away team...</option>
                {teams.map((t) => (
                  <option key={t.code} value={t.name}>
                    {t.flagEmoji} {t.name}
                  </option>
                ))}
              </select>
            </div>

            <Button
              type="submit"
              disabled={!homeTeam || !awayTeam || homeScore === "" || awayScore === "" || isSubmitting}
              className="w-full font-mono uppercase tracking-wider mt-2 flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Record Match
            </Button>
          </form>

          {playedMatches.length > 0 && (
            <div className="mt-6 pt-6 border-t border-border">
              <Button
                onClick={handleClearAll}
                variant="destructive"
                className="w-full font-mono uppercase tracking-wider flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Clear All Matches
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recorded Matches List Card */}
      <Card className="lg:col-span-2 border-card-border bg-card/50 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-xl uppercase tracking-wider text-muted-foreground font-mono">
              Recorded Results
            </CardTitle>
            <CardDescription>
              Matches that have been marked as played. These override the simulation's defaults.
            </CardDescription>
          </div>
          {playedMatches.length > 0 && (
            <div className="bg-primary/20 text-primary border border-primary/30 px-3 py-1 rounded-full font-mono text-xs uppercase tracking-wider">
              {playedMatches.length} Recorded
            </div>
          )}
        </CardHeader>
        <CardContent>
          {matchesLoading ? (
            <div className="py-12 text-center text-muted-foreground font-mono">
              Loading recorded matches...
            </div>
          ) : playedMatches.length === 0 ? (
            <div className="py-12 border border-dashed border-border rounded-lg text-center flex flex-col items-center justify-center gap-3">
              <AlertTriangle className="w-8 h-8 text-muted-foreground" />
              <div className="font-mono text-sm text-muted-foreground uppercase tracking-widest">
                No Live Matches Recorded
              </div>
              <p className="text-xs text-muted-foreground max-w-sm px-4">
                The simulation is currently running with standard probabilities based on initial Elo ratings. Use the form to record custom match results.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border border border-border rounded-lg overflow-hidden bg-background/20 font-mono">
              {playedMatches.map((m, idx) => (
                <div
                  key={`${m.homeTeam}-${m.awayTeam}-${idx}`}
                  className="flex items-center justify-between p-4 hover:bg-background/40 transition-colors"
                >
                  <div className="grid grid-cols-7 items-center w-full max-w-lg text-sm sm:text-base font-bold">
                    {/* Home Team */}
                    <div className="col-span-3 text-right flex items-center justify-end gap-2">
                      <span className="font-sans font-medium text-foreground">{m.homeTeam}</span>
                      <span className="text-lg">{getFlag(m.homeTeam)}</span>
                    </div>

                    {/* Scores */}
                    <div className="col-span-1 text-center font-mono text-primary bg-secondary/80 py-1 px-2 rounded border border-border mx-2">
                      {m.homeScore} - {m.awayScore}
                    </div>

                    {/* Away Team */}
                    <div className="col-span-3 text-left flex items-center justify-start gap-2">
                      <span className="text-lg">{getFlag(m.awayTeam)}</span>
                      <span className="font-sans font-medium text-foreground">{m.awayTeam}</span>
                    </div>
                  </div>

                  <Button
                    onClick={() => handleDelete(m.homeTeam, m.awayTeam)}
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="Remove Match"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
