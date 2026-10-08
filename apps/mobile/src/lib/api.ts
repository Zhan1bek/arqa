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

  interface RawResponse {
    status: number;
    ok: boolean;
    /** `undefined` when the body was not JSON (e.g. a captive-portal HTML page). */
    body: unknown;
  }

  /**
   * One HTTP attempt. The body is read inside the same timeout/abort window as the headers:
   * a response whose body is still streaming must not outlive a cancelled request.
   */
  async function attempt(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<RawResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const response = await doFetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
      if (controller.signal.aborted) throw new Error('Aborted');
      return { status: response.status, ok: response.ok, body };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Retries only what is safe to retry: network failures, timeouts, 5xx and "2xx that is not
   * our JSON". Every endpoint here is idempotent (GETs, and POST /api/trips is keyed by trip
   * id — ADR-0003), so a retry after a lost response cannot create a duplicate.
   */
  async function request<T>(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
    isExpected: (body: unknown) => boolean = (body) => typeof body === 'object' && body !== null,
  ): Promise<T> {
    const url = `${options.baseUrl}${path}`;
    let lastError = 'нет ответа от сервера';

    for (let i = 0; i <= retryDelays.length; i++) {
      if (i > 0) await sleep(retryDelays[i - 1] ?? 0);
      if (signal?.aborted) throw signal.reason ?? new Error('Aborted');

      let response: RawResponse;
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

      if (response.ok) {
        // A 200 with someone else's body (Wi-Fi login page, proxy) is not a success.
        if (isExpected(response.body)) return response.body as T;
        lastError = 'неожиданный ответ сервера';
        continue;
      }

      const err = (
        response.body as { error?: { code?: string; message?: string; issues?: ValidationIssue[] } }
      )?.error;
      throw new ApiError(
        response.status,
        err?.code ?? 'HTTP_ERROR',
        err?.message ?? `Ошибка ${response.status}`,
        err?.issues ?? [],
      );
    }
    throw new NetworkError(lastError);
  }

  return {
    getDay: (date: string, signal?: AbortSignal) =>
      request<DayResponse>(`/api/days/${encodeURIComponent(date)}`, {}, signal),

    listDays: (signal?: AbortSignal) => request<DaysResponse>('/api/days', {}, signal),

    /** `trip.id` must stay the same across user retries — that is what prevents duplicates. */
    createTrip: (trip: TripInput) =>
      request<CreateTripResponse>(
        '/api/trips',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(trip),
        },
        undefined,
        (body) => (body as Partial<CreateTripResponse> | undefined)?.trip?.id === trip.id,
      ),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
