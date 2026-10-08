import type { DaySummary, PaymentMethod, TripInput, ValidationIssue } from '@diary/core';

// Response shapes of apps/server (kept in sync by hand: the server owns them).
export interface TripView {
  id: string;
  start: string;
  end: string;
  amount: number;
  commission: number;
  payment: PaymentMethod;
}

export interface DayResponse {
  date: string;
  timeZone: string;
  utcOffset: string;
  summary: DaySummary;
  trips: TripView[];
}

export interface DaysResponse {
  days: Array<{ date: string; trips: number }>;
}

export interface CreateTripResponse {
  created: boolean;
  trip: TripView;
}

/** The server answered with an error status. 4xx are final and never retried. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** No usable answer after all attempts (offline, timeout, 5xx). Safe to retry later. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Delays before attempts 2, 3, ...; its length + 1 is the max number of attempts. */
  retryDelaysMs?: number[];
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? fetch;
  const retryDelays = options.retryDelaysMs ?? [500, 1500, 3000];
  const timeoutMs = options.timeoutMs ?? 10_000;
  const sleep = options.sleep ?? defaultSleep;

  async function attempt(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      return await doFetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Retries only what is safe to retry: network failures and 5xx. Every endpoint here is
   * idempotent (GETs, and POST /api/trips is keyed by trip id — ADR-0003), so a retry after
   * a lost response cannot create a duplicate.
   */
  async function request<T>(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const url = `${options.baseUrl}${path}`;
    let lastError = 'нет ответа от сервера';

    for (let i = 0; i <= retryDelays.length; i++) {
      if (i > 0) await sleep(retryDelays[i - 1] ?? 0);
      if (signal?.aborted) throw signal.reason ?? new Error('Aborted');

      let response: Response;
      try {
        response = await attempt(url, init, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = 'нет связи с сервером';
        continue;
      }

      if (response.status >= 500) {
        lastError = `сервер ответил ${response.status}`;
        continue;
      }

      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const err = (body as { error?: Partial<ApiError> & { issues?: ValidationIssue[] } } | null)
          ?.error;
        throw new ApiError(
          response.status,
          err?.code ?? 'HTTP_ERROR',
          err?.message ?? `Ошибка ${response.status}`,
          err?.issues ?? [],
        );
      }
      return body as T;
    }
    throw new NetworkError(lastError);
  }

  return {
    getDay: (date: string, signal?: AbortSignal) =>
      request<DayResponse>(`/api/days/${encodeURIComponent(date)}`, {}, signal),

    listDays: (signal?: AbortSignal) => request<DaysResponse>('/api/days', {}, signal),

    /** `trip.id` must stay the same across user retries — that is what prevents duplicates. */
    createTrip: (trip: TripInput) =>
      request<CreateTripResponse>('/api/trips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(trip),
      }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
