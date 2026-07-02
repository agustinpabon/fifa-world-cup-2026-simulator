import { useCallback, useSyncExternalStore } from "react";
import type { LiveMatchRequest } from "@workspace/api-client-react";

const CUSTOM_MATCHES_STORAGE_KEY = "world-cup-oracle:custom-matches:v1";
const MAX_REASONABLE_SCORE = 30;

export type CustomMatch = LiveMatchRequest & {
  source: "custom";
  status: "finished";
};

type MatchRecord = LiveMatchRequest & {
  source?: string;
  status?: string;
};

const listeners = new Set<() => void>();
let customMatchesSnapshot: CustomMatch[] | null = null;

function isBrowser(): boolean {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

function isSameMatchup(
  match: Pick<LiveMatchRequest, "homeTeam" | "awayTeam">,
  homeTeam: string,
  awayTeam: string,
): boolean {
  return (
    (match.homeTeam === homeTeam && match.awayTeam === awayTeam) ||
    (match.homeTeam === awayTeam && match.awayTeam === homeTeam)
  );
}

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

function normalizeCustomMatch(value: unknown): CustomMatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const homeTeam =
    typeof record.homeTeam === "string" ? record.homeTeam.trim() : "";
  const awayTeam =
    typeof record.awayTeam === "string" ? record.awayTeam.trim() : "";
  const homeScore = record.homeScore;
  const awayScore = record.awayScore;

  if (!homeTeam || !awayTeam || homeTeam === awayTeam) {
    return null;
  }

  if (
    typeof homeScore !== "number" ||
    typeof awayScore !== "number" ||
    !Number.isInteger(homeScore) ||
    !Number.isInteger(awayScore) ||
    homeScore < 0 ||
    awayScore < 0 ||
    homeScore > MAX_REASONABLE_SCORE ||
    awayScore > MAX_REASONABLE_SCORE
  ) {
    return null;
  }

  return {
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    source: "custom",
    status: "finished",
  };
}

function upsertCustomMatchInList(
  matches: readonly CustomMatch[],
  nextMatch: CustomMatch,
): CustomMatch[] {
  return [
    ...matches.filter(
      (match) => !isSameMatchup(match, nextMatch.homeTeam, nextMatch.awayTeam),
    ),
    { ...nextMatch },
  ];
}

function readStoredCustomMatches(): CustomMatch[] {
  if (!isBrowser()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(CUSTOM_MATCHES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.reduce<CustomMatch[]>((matches, value) => {
      const match = normalizeCustomMatch(value);
      return match ? upsertCustomMatchInList(matches, match) : matches;
    }, []);
  } catch {
    return [];
  }
}

function getCustomMatchesSnapshot(): CustomMatch[] {
  customMatchesSnapshot ??= readStoredCustomMatches();
  return customMatchesSnapshot;
}

function getServerSnapshot(): CustomMatch[] {
  return [];
}

function writeCustomMatches(matches: readonly CustomMatch[]): void {
  customMatchesSnapshot = matches.map((match) => ({ ...match }));

  if (isBrowser()) {
    const payloads = toCustomMatchPayloads(customMatchesSnapshot);

    if (payloads.length > 0) {
      window.localStorage.setItem(
        CUSTOM_MATCHES_STORAGE_KEY,
        JSON.stringify(payloads),
      );
    } else {
      window.localStorage.removeItem(CUSTOM_MATCHES_STORAGE_KEY);
    }
  }

  notifyListeners();
}

function subscribeToCustomMatches(listener: () => void): () => void {
  listeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== CUSTOM_MATCHES_STORAGE_KEY) {
      return;
    }

    customMatchesSnapshot = readStoredCustomMatches();
    notifyListeners();
  };

  if (isBrowser()) {
    window.addEventListener("storage", handleStorage);
  }

  return () => {
    listeners.delete(listener);

    if (isBrowser()) {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

export function toCustomMatchPayloads(
  matches: readonly CustomMatch[],
): LiveMatchRequest[] {
  return matches.map((match) => ({
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
  }));
}

export function serializeCustomMatches(
  matches: readonly CustomMatch[],
): string | undefined {
  const payloads = toCustomMatchPayloads(matches);
  return payloads.length > 0 ? JSON.stringify(payloads) : undefined;
}

function isLockedExternalMatch(match: MatchRecord): boolean {
  return (
    (match.source === "official" || match.source === "espn") &&
    match.status !== "scheduled"
  );
}

export function mergeCustomMatches<TMatch extends MatchRecord>(
  matches: readonly TMatch[],
  customMatches: readonly CustomMatch[],
): Array<TMatch | CustomMatch> {
  return customMatches.reduce<Array<TMatch | CustomMatch>>(
    (merged, customMatch) => {
      const index = merged.findIndex((match) =>
        isSameMatchup(match, customMatch.homeTeam, customMatch.awayTeam),
      );

      if (index === -1) {
        return [...merged, { ...customMatch }];
      }

      const existing = merged[index];
      if (isLockedExternalMatch(existing)) {
        return merged;
      }

      return [
        ...merged.slice(0, index),
        { ...customMatch },
        ...merged.slice(index + 1),
      ];
    },
    matches.map((match) => ({ ...match })),
  );
}

export function useCustomMatches() {
  const customMatches = useSyncExternalStore(
    subscribeToCustomMatches,
    getCustomMatchesSnapshot,
    getServerSnapshot,
  );

  const upsertCustomMatch = useCallback((match: LiveMatchRequest) => {
    const normalized = normalizeCustomMatch(match);
    if (!normalized) {
      return false;
    }

    writeCustomMatches(
      upsertCustomMatchInList(getCustomMatchesSnapshot(), normalized),
    );
    return true;
  }, []);

  const removeCustomMatch = useCallback(
    (homeTeam: string, awayTeam: string) => {
      writeCustomMatches(
        getCustomMatchesSnapshot().filter(
          (match) => !isSameMatchup(match, homeTeam, awayTeam),
        ),
      );
    },
    [],
  );

  const clearCustomMatches = useCallback(() => {
    writeCustomMatches([]);
  }, []);

  return {
    customMatches,
    upsertCustomMatch,
    removeCustomMatch,
    clearCustomMatches,
  };
}
