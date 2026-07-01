import React from "react";
import {
  getGetSquadsQueryKey,
  useGetSquads,
  type SquadsResponse,
  type TeamSquad,
} from "@workspace/api-client-react";
import { Users } from "lucide-react";
import {
  formatContextDate,
  SourceStatusBadge,
  type SourceStatus,
} from "@/components/source-status-badge";

interface TeamSquadContextProps {
  teamName: string;
}

export function getSquadsSourceStatus(
  response: SquadsResponse | undefined,
  isError: boolean
): SourceStatus {
  if (isError) {
    return "error";
  }

  const provenance = response?.data.externalProvenance;
  if (!response || response.data.squads.length === 0 || !provenance) {
    return "unavailable";
  }

  if (provenance.error || provenance.state === "error") {
    return "error";
  }

  if (provenance.stale || provenance.state === "stale") {
    return "stale";
  }

  return "loaded";
}

export function getSquadsProviderLabel(response: SquadsResponse | undefined): string {
  const provider = response?.data.externalProvenance.provider;

  if (provider === "api-football") {
    return "API-Football";
  }

  if (provider === "local-snapshot") {
    return "Local snapshot";
  }

  return "Squads";
}

function findSquad(response: SquadsResponse | undefined, teamName: string): TeamSquad | undefined {
  return response?.data.squads.find((squad) => squad.team === teamName);
}

export function TeamSquadContext({ teamName }: TeamSquadContextProps) {
  const { data: squadsResponse, isError } = useGetSquads({
    query: {
      queryKey: getGetSquadsQueryKey(),
      retry: false,
      staleTime: 10 * 60_000,
    },
  });

  const status = getSquadsSourceStatus(squadsResponse, isError);
  const squad = findSquad(squadsResponse, teamName);
  const sourceName = squad?.source.sourceName ?? getSquadsProviderLabel(squadsResponse);
  const lastUpdated =
    squadsResponse?.data.externalProvenance.loadedAt ??
    squad?.source.accessedDate ??
    squadsResponse?.data.provenance.accessedDate ??
    null;
  const playerCount = squad
    ? `${squad.completeness.playerCount}/${squad.completeness.expectedPlayerCount}`
    : "N/D";
  const availability = squad?.completeness.status ?? "unavailable";

  return (
    <div
      data-testid="leaderboard-squad-context"
      className="rounded-lg border border-card-border bg-card/60 p-4 font-mono text-xs"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h5 className="flex min-w-0 items-center gap-1.5 font-bold uppercase tracking-widest text-muted-foreground">
          <Users className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">Squads</span>
        </h5>
        <SourceStatusBadge status={squad ? status : status === "error" ? "error" : "unavailable"} />
      </div>

      <div className="space-y-2">
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Players:</span>
          <span className="text-right font-bold text-foreground">{playerCount}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Disponibilidad:</span>
          <span className="text-right font-bold uppercase text-foreground">{availability}</span>
        </div>
        <div className="flex justify-between gap-3 border-t border-border pt-2">
          <span className="text-muted-foreground">Fuente:</span>
          <span className="truncate text-right text-foreground/85" title={sourceName}>
            {sourceName}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Última actualización:</span>
          <span className="text-right text-foreground/85">{formatContextDate(lastUpdated)}</span>
        </div>
      </div>

      <div className="mt-3 rounded border border-primary/20 bg-primary/10 px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wider text-primary">
        No incluido en el modelo
      </div>
    </div>
  );
}
