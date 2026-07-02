export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ExternalDataProviderState = "idle" | "fresh" | "stale" | "error";
export type ExternalDataFallbackMode = "none" | "stale-cache" | "local-data";

export interface ExternalDataProvenance<TProvider extends string = string> {
  provider: TProvider;
  loadedAt: string | null;
  sourceUrl: string;
  cacheTtlMs: number;
  stale: boolean;
  error: string | null;
  state: ExternalDataProviderState;
  fallback: ExternalDataFallbackMode;
}

export interface ExternalDataSnapshot<TData, TProvider extends string = string> {
  data: TData;
  provenance: ExternalDataProvenance<TProvider>;
}

export interface ExternalDataLoadContext {
  fetchImpl: FetchLike;
  sourceUrl: string;
  timeoutMs: number;
}

export interface ExternalDataLoadResult<TData> {
  data: TData;
  loadedAt?: string | null;
  sourceUrl?: string;
}

export interface CreateExternalDataProviderOptions<TData, TProvider extends string> {
  provider: TProvider;
  sourceUrl: string;
  cacheTtlMs: number;
  fallbackData: TData;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  load(context: ExternalDataLoadContext): Promise<ExternalDataLoadResult<TData>>;
}

export interface ReadExternalDataOptions {
  force?: boolean;
}

export interface ExternalDataProvider<TData, TProvider extends string = string> {
  read(options?: ReadExternalDataOptions): Promise<ExternalDataSnapshot<TData, TProvider>>;
  peek(): ExternalDataSnapshot<TData, TProvider>;
  clear(): void;
}

const DEFAULT_TIMEOUT_MS = 3_000;

type CacheEntry<TData> = {
  data: TData;
  loadedAt: string;
  sourceUrl: string;
  expiresAt: number;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function buildSnapshot<TData, TProvider extends string>(
  options: {
    provider: TProvider;
    sourceUrl: string;
    cacheTtlMs: number;
    fallbackData: TData;
    cacheEntry: CacheEntry<TData> | null;
    lastError: string | null;
    fallback: ExternalDataFallbackMode;
  }
): ExternalDataSnapshot<TData, TProvider> {
  const { provider, sourceUrl, cacheTtlMs, fallbackData, cacheEntry, lastError, fallback } = options;
  const hasCache = cacheEntry !== null;
  const isExpired = hasCache ? Date.now() >= cacheEntry.expiresAt : false;
  const state = !hasCache ? (lastError ? "error" : "idle") : isExpired || lastError ? "stale" : "fresh";

  return {
    data: cacheEntry?.data ?? fallbackData,
    provenance: {
      provider,
      loadedAt: cacheEntry?.loadedAt ?? null,
      sourceUrl: cacheEntry?.sourceUrl ?? sourceUrl,
      cacheTtlMs,
      stale: state === "stale" || state === "error",
      error: lastError,
      state,
      fallback,
    },
  };
}

export function createExternalDataProvider<TData, TProvider extends string>(
  options: CreateExternalDataProviderOptions<TData, TProvider>
): ExternalDataProvider<TData, TProvider> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const cacheTtlMs = Math.max(1, Math.trunc(options.cacheTtlMs));
  let cacheEntry: CacheEntry<TData> | null = null;
  let lastError: string | null = null;
  let fallback: ExternalDataFallbackMode = "none";
  let inFlight: Promise<ExternalDataSnapshot<TData, TProvider>> | null = null;

  function peek(): ExternalDataSnapshot<TData, TProvider> {
    return buildSnapshot({
      provider: options.provider,
      sourceUrl: options.sourceUrl,
      cacheTtlMs,
      fallbackData: options.fallbackData,
      cacheEntry,
      lastError,
      fallback,
    });
  }

  async function read(readOptions: ReadExternalDataOptions = {}): Promise<ExternalDataSnapshot<TData, TProvider>> {
    const force = readOptions.force ?? false;
    const current = peek();

    if (!force && current.provenance.state === "fresh") {
      return current;
    }

    if (inFlight) {
      return inFlight;
    }

    inFlight = (async () => {
      try {
        const loaded = await options.load({
          fetchImpl,
          sourceUrl: options.sourceUrl,
          timeoutMs,
        });
        const loadedAt = loaded.loadedAt ?? new Date().toISOString();

        cacheEntry = {
          data: loaded.data,
          loadedAt,
          sourceUrl: loaded.sourceUrl ?? options.sourceUrl,
          expiresAt: Date.now() + cacheTtlMs,
        };
        lastError = null;
        fallback = "none";

        return peek();
      } catch (error) {
        lastError = getErrorMessage(error);
        fallback = cacheEntry ? "stale-cache" : "local-data";

        return peek();
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  function clear(): void {
    cacheEntry = null;
    lastError = null;
    fallback = "none";
    inFlight = null;
  }

  return {
    read,
    peek,
    clear,
  };
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
  init: Omit<RequestInit, "signal"> = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`External data fetch timed out after ${timeoutMs}ms: ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJsonWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
  init: Omit<RequestInit, "signal"> = {}
): Promise<unknown> {
  const response = await fetchWithTimeout(fetchImpl, url, timeoutMs, init);

  if (!response.ok) {
    throw new Error(`External data source responded with HTTP ${response.status}`);
  }

  return await response.json();
}
