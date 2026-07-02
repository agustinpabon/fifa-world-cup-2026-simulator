import React, { useMemo } from "react";
import {
  getGetMatchContextQueryKey,
  useGetMatchContext,
  type MatchWeather,
  type TeamSquad,
} from "@workspace/api-client-react";
import { CloudSun, Database, MapPin, Mountain, Users } from "lucide-react";
import {
  formatContextDate,
  SourceStatusBadge,
  type SourceStatus,
} from "@/components/source-status-badge";

interface MatchContextPanelProps {
  homeTeam: string;
  awayTeam: string;
  homeSquad?: TeamSquad;
  awaySquad?: TeamSquad;
  squadsProvider: string;
  squadsSourceStatus: SourceStatus;
  squadsLastUpdated?: string | null;
}

interface ContextMetricProps {
  icon: React.ReactNode;
  label: string;
  status: SourceStatus;
  value: string;
  title?: string;
}

function getWeatherSourceStatus(weather: MatchWeather | undefined): SourceStatus {
  if (!weather) {
    return "unavailable";
  }

  if (weather.provenance.state === "error" || weather.reason === "provider_error") {
    return "error";
  }

  if (weather.provenance.stale || weather.provenance.state === "stale") {
    return "stale";
  }

  return weather.status === "available" ? "loaded" : "unavailable";
}

function formatWeatherValue(weather: MatchWeather | undefined): string {
  const forecast = weather?.forecast;

  if (forecast) {
    const parts = [
      forecast.temperatureC !== null ? `${forecast.temperatureC.toFixed(1)}°C` : null,
      forecast.precipitationProbabilityPct !== null
        ? `${Math.round(forecast.precipitationProbabilityPct)}% precip`
        : null,
      forecast.windSpeed10mKph !== null ? `${Math.round(forecast.windSpeed10mKph)} km/h wind` : null,
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(" · ") : "available";
  }

  switch (weather?.reason) {
    case "outside_forecast_horizon":
      return "Fuera de ventana";
    case "venue_unavailable":
      return "Venue N/D";
    case "provider_error":
      return "Provider error";
    case "forecast_missing":
      return "Forecast N/D";
    default:
      return "N/D";
  }
}

function formatSquadsValue(homeSquad: TeamSquad | undefined, awaySquad: TeamSquad | undefined): string {
  if (!homeSquad && !awaySquad) {
    return "N/D";
  }

  const homeCount = homeSquad
    ? `${homeSquad.completeness.playerCount}/${homeSquad.completeness.expectedPlayerCount}`
    : "N/D";
  const awayCount = awaySquad
    ? `${awaySquad.completeness.playerCount}/${awaySquad.completeness.expectedPlayerCount}`
    : "N/D";

  return `${homeCount} · ${awayCount}`;
}

function ContextMetric({ icon, label, status, value, title }: ContextMetricProps) {
  return (
    <div className="min-w-0 rounded-md border border-border/50 bg-background/30 px-2.5 py-2">
      <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <span className="shrink-0 text-primary/80">{icon}</span>
          <span>{label}</span>
        </span>
        <SourceStatusBadge status={status} className="h-4 px-1 text-[8px]" />
      </div>
      <div className="truncate text-[11px] font-semibold text-foreground" title={title ?? value}>
        {value}
      </div>
    </div>
  );
}

export function MatchContextPanel({
  homeTeam,
  awayTeam,
  homeSquad,
  awaySquad,
  squadsProvider,
  squadsSourceStatus,
  squadsLastUpdated,
}: MatchContextPanelProps) {
  const params = useMemo(() => ({ homeTeam, awayTeam }), [homeTeam, awayTeam]);
  const { data: contextResponse, isError } = useGetMatchContext(params, {
    query: {
      queryKey: getGetMatchContextQueryKey(params),
      retry: false,
      staleTime: 15 * 60_000,
    },
  });

  const context = contextResponse?.data;
  const venue = context?.venue;
  const weather = context?.weather;
  const weatherStatus = getWeatherSourceStatus(weather);
  const panelStatus: SourceStatus = isError
    ? "error"
    : context
      ? weatherStatus === "stale"
        ? "stale"
        : "loaded"
      : "unavailable";
  const venueValue = venue ? `${venue.stadium}, ${venue.city}` : "N/D";
  const altitudeValue = venue ? `${Math.round(venue.altitudeMeters).toLocaleString()} m` : "N/D";
  const squadsValue = formatSquadsValue(homeSquad, awaySquad);
  const squadsTitle = `${homeTeam}: ${homeSquad?.completeness.playerCount ?? "N/D"} players; ${awayTeam}: ${
    awaySquad?.completeness.playerCount ?? "N/D"
  } players`;
  const sourceLabel = weather?.provider ? `open-meteo · ${context?.fixture.source ?? "fixture"}` : "fixture";
  const lastUpdated = weather?.provenance.loadedAt ?? squadsLastUpdated ?? null;

  return (
    <div
      data-testid="match-context-panel"
      className="mt-3 rounded-lg border border-border/50 bg-background/25 p-3"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Database className="h-3.5 w-3.5 text-primary/80" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Contexto
          </span>
          <SourceStatusBadge status={panelStatus} />
        </div>
        <span className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-primary">
          No incluido en el modelo
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ContextMetric
          icon={<MapPin className="h-3.5 w-3.5" />}
          label="Venue"
          status={venue ? "loaded" : isError ? "error" : "unavailable"}
          value={venueValue}
        />
        <ContextMetric
          icon={<Mountain className="h-3.5 w-3.5" />}
          label="Altitud"
          status={venue ? "loaded" : isError ? "error" : "unavailable"}
          value={altitudeValue}
        />
        <ContextMetric
          icon={<CloudSun className="h-3.5 w-3.5" />}
          label="Clima"
          status={isError ? "error" : weatherStatus}
          value={formatWeatherValue(weather)}
        />
        <ContextMetric
          icon={<Users className="h-3.5 w-3.5" />}
          label="Squads"
          status={homeSquad || awaySquad ? squadsSourceStatus : "unavailable"}
          value={squadsValue}
          title={squadsTitle}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border/40 pt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="truncate">
          Fuente: <span className="text-foreground/80">{sourceLabel}</span>
        </span>
        <span className="truncate">
          Squads: <span className="text-foreground/80">{squadsProvider}</span>
        </span>
        <span className="truncate">
          Última actualización: <span className="text-foreground/80">{formatContextDate(lastUpdated)}</span>
        </span>
      </div>
    </div>
  );
}
