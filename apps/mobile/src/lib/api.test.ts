import { describe, it, expect } from 'vitest';
import type { TripInput } from '@diary/core';
import { ApiError, NetworkError, createApiClient, type ApiClientOptions } from './api';

const BASE = 'http://api.test';

const trip: TripInput = {
  id: 'trip-0b7c1e9a',
  start: '2026-10-01T08:10:00+05:00',
  end: '2026-10-01T08:32:00+05:00',
  amount: 2400,
  payment: 'card',
  commission: 360,
};

interface FetchCall {
  url: string;
  init: RequestInit;
}

type Step = (init: RequestInit) => Promise<Response>;

const json = (status: number, body: unknown): Step => {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
};

const networkDown: Step = () => Promise.reject(new TypeError('Network request failed'));

/** Never answers on its own; rejects only when the request signal is aborted. */
const hanging: Step = (init) =>
  new Promise<Response>((_, reject) => {
    const signal = init.signal;
    if (!signal) return;
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });

/** Fake fetch that plays `steps` in order (the last one repeats) and records every call. */
function fakeFetch(...steps: Step[]) {
  const calls: FetchCall[] = [];
  const fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]!;
    return step(init);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function recordingSleep() {
  const delays: number[] = [];
  const sleep = (ms: number) => {
    delays.push(ms);
    return Promise.resolve();
  };
  return { sleep, delays };
}

function client(fetch: typeof globalThis.fetch, extra: Partial<ApiClientOptions> = {}) {
  const { sleep, delays } = recordingSleep();
  const api = createApiClient({
    baseUrl: BASE,
    fetch,
    retryDelaysMs: [100, 200, 400],
    timeoutMs: 1_000,
    sleep,
    ...extra,
  });
  return { api, delays };
}

const created = { created: true, trip };
const replayed = { created: false, trip };

describe('createTrip: повтор после сетевой ошибки (AC-9, ADR-0003)', () => {
  it('AC-9: после обрыва сети запрос повторяется с тем же телом и тем же id', async () => {
    const { fetch, calls } = fakeFetch(networkDown, json(201, created));
    const { api } = client(fetch);

    const result = await api.createTrip(trip);

    expect(calls).toHaveLength(2);
    const bodies = calls.map((c) => c.init.body);
    expect(bodies[1]).toBe(bodies[0]);
    for (const body of bodies) {
      expect(JSON.parse(String(body))).toEqual(trip);
      expect(JSON.parse(String(body)).id).toBe('trip-0b7c1e9a');
    }
    expect(result).toEqual(created);
  });

  it('AC-9: несколько обрывов подряд — все попытки несут один и тот же id, результат — ответ успешной', async () => {
    const { fetch, calls } = fakeFetch(networkDown, networkDown, networkDown, json(200, replayed));
    const { api } = client(fetch);

    const result = await api.createTrip(trip);

    expect(calls).toHaveLength(4);
    const ids = calls.map((c) => JSON.parse(String(c.init.body)).id);
    expect(ids).toEqual(['trip-0b7c1e9a', 'trip-0b7c1e9a', 'trip-0b7c1e9a', 'trip-0b7c1e9a']);
    expect(new Set(calls.map((c) => c.init.body)).size).toBe(1);
    expect(result).toEqual(replayed);
  });

  it('AC-9: createTrip — POST на /api/trips с content-type application/json', async () => {
    const { fetch, calls } = fakeFetch(json(201, created));
    const { api } = client(fetch);

    await api.createTrip(trip);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://api.test/api/trips');
    expect(calls[0]!.init.method).toBe('POST');
    expect(new Headers(calls[0]!.init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(trip);
  });

  it('AC-9: таймаут попытки считается сетевой ошибкой и повторяется с тем же id', async () => {
    const { fetch, calls } = fakeFetch(hanging, json(201, created));
    const { api } = client(fetch, { timeoutMs: 5 });

    const result = await api.createTrip(trip);

    expect(calls).toHaveLength(2);
    expect(calls[1]!.init.body).toBe(calls[0]!.init.body);
    expect(result).toEqual(created);
  });
});

describe('повторы: только сеть и 5xx (ADR-0003)', () => {
  it('AC-9: 5xx повторяется, затем успешный ответ возвращается', async () => {
    const { fetch, calls } = fakeFetch(json(503, {}), json(500, {}), json(201, created));
    const { api, delays } = client(fetch);

    const result = await api.createTrip(trip);

    expect(calls).toHaveLength(3);
    expect(delays).toEqual([100, 200]);
    expect(result).toEqual(created);
  });

  it('AC-9: после исчерпания попыток на 5xx — NetworkError; попыток = retryDelaysMs.length + 1', async () => {
    const { fetch, calls } = fakeFetch(json(502, {}));
    const { api, delays } = client(fetch);

    await expect(api.createTrip(trip)).rejects.toBeInstanceOf(NetworkError);

    expect(calls).toHaveLength(4);
    expect(delays).toEqual([100, 200, 400]);
    expect(new Set(calls.map((c) => c.init.body)).size).toBe(1);
  });

  it('AC-9: после исчерпания попыток на обрывах сети — NetworkError', async () => {
    const { fetch, calls } = fakeFetch(networkDown);
    const { api, delays } = client(fetch, { retryDelaysMs: [7, 3] });

    await expect(api.createTrip(trip)).rejects.toBeInstanceOf(NetworkError);

    expect(calls).toHaveLength(3);
    expect(delays).toEqual([7, 3]);
  });

  it('AC-9: retryDelaysMs = [] — ровно одна попытка, без sleep', async () => {
    const { fetch, calls } = fakeFetch(networkDown);
    const { api, delays } = client(fetch, { retryDelaysMs: [] });

    await expect(api.createTrip(trip)).rejects.toBeInstanceOf(NetworkError);

    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it('AC-9: NetworkError не является ApiError', async () => {
    const { fetch } = fakeFetch(networkDown);
    const { api } = client(fetch);

    const error = await api.createTrip(trip).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(ApiError);
  });

  it('AC-5: 400 не повторяется — ApiError со status, code и issues из тела', async () => {
    const issues = [{ field: 'amount', message: 'Сумма должна быть больше 0' }];
    const { fetch, calls } = fakeFetch(
      json(400, { error: { code: 'VALIDATION_ERROR', message: 'Неверные данные', issues } }),
    );
    const { api, delays } = client(fetch);

    const error = await api.createTrip(trip).catch((e: unknown) => e);

    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Неверные данные',
      issues,
    });
  });

  it('AC-7: 409 не повторяется — ApiError со status 409 и code из тела', async () => {
    const { fetch, calls } = fakeFetch(
      json(409, { error: { code: 'TRIP_CONFLICT', message: 'id уже занят другой поездкой' } }),
    );
    const { api, delays } = client(fetch);

    const error = await api.createTrip(trip).catch((e: unknown) => e);

    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'TRIP_CONFLICT', issues: [] });
  });

  it('AC-7: 409 после обрыва сети — не повторяется дальше, ApiError', async () => {
    const { fetch, calls } = fakeFetch(
      networkDown,
      json(409, { error: { code: 'TRIP_CONFLICT', message: 'конфликт' } }),
      json(201, created),
    );
    const { api } = client(fetch);

    await expect(api.createTrip(trip)).rejects.toMatchObject({ status: 409 });
    expect(calls).toHaveLength(2);
  });

  it('AC-4: 400 на getDay не повторяется', async () => {
    const { fetch, calls } = fakeFetch(
      json(400, { error: { code: 'INVALID_DATE', message: 'Некорректная дата' } }),
    );
    const { api } = client(fetch);

    await expect(api.getDay('2026-13-01')).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_DATE',
    });
    expect(calls).toHaveLength(1);
  });
});

describe('getDay / listDays', () => {
  it('AC-8: getDay запрашивает ${baseUrl}/api/days/2026-10-01 и возвращает тело', async () => {
    const day = {
      date: '2026-10-01',
      timeZone: 'Asia/Almaty',
      utcOffset: '+05:00',
      summary: {},
      trips: [],
    };
    const { fetch, calls } = fakeFetch(json(200, day));
    const { api } = client(fetch);

    const result = await api.getDay('2026-10-01');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://api.test/api/days/2026-10-01');
    expect(calls[0]!.init.method ?? 'GET').toBe('GET');
    expect(result).toEqual(day);
  });

  it('AC-8: getDay кодирует дату в пути', async () => {
    const { fetch, calls } = fakeFetch(json(400, { error: { code: 'X', message: 'x' } }));
    const { api } = client(fetch);

    await api.getDay('2026/10 01?x').catch(() => undefined);

    expect(calls[0]!.url).toBe('http://api.test/api/days/2026%2F10%2001%3Fx');
  });

  it('AC-8: getDay повторяется при сетевой ошибке', async () => {
    const { fetch, calls } = fakeFetch(networkDown, json(200, { date: '2026-10-01' }));
    const { api, delays } = client(fetch);

    await expect(api.getDay('2026-10-01')).resolves.toEqual({ date: '2026-10-01' });
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([100]);
  });

  it('AC-8: listDays запрашивает ${baseUrl}/api/days', async () => {
    const days = { days: [{ date: '2026-10-01', trips: 2 }] };
    const { fetch, calls } = fakeFetch(json(200, days));
    const { api } = client(fetch);

    await expect(api.listDays()).resolves.toEqual(days);
    expect(calls[0]!.url).toBe('http://api.test/api/days');
  });
});

describe('getDay: отмена через AbortSignal', () => {
  it('AC-8: отмена во время запроса — запрос прерывается, повторов нет', async () => {
    const { fetch, calls } = fakeFetch(hanging);
    const { api, delays } = client(fetch);
    const controller = new AbortController();

    const promise = api.getDay('2026-10-01', controller.signal);
    controller.abort();

    await expect(promise).rejects.toBeDefined();
    await expect(promise).rejects.not.toBeInstanceOf(NetworkError);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.signal?.aborted).toBe(true);
    expect(delays).toEqual([]);
  });

  it('AC-8: отмена во время паузы между попытками — следующей попытки нет', async () => {
    const controller = new AbortController();
    const { fetch, calls } = fakeFetch(networkDown, json(200, { date: '2026-10-01' }));
    const delays: number[] = [];
    const api = createApiClient({
      baseUrl: BASE,
      fetch,
      retryDelaysMs: [100, 200, 400],
      timeoutMs: 1_000,
      sleep: (ms) => {
        delays.push(ms);
        controller.abort();
        return Promise.resolve();
      },
    });

    await expect(api.getDay('2026-10-01', controller.signal)).rejects.toBeDefined();
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([100]);
  });

  it('AC-8: уже отменённый сигнал — fetch не вызывается', async () => {
    const { fetch, calls } = fakeFetch(json(200, {}));
    const { api } = client(fetch);
    const controller = new AbortController();
    controller.abort();

    await expect(api.getDay('2026-10-01', controller.signal)).rejects.toBeDefined();
    expect(calls).toHaveLength(0);
  });
});
