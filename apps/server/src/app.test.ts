import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type AppOptions } from './app';

// ---------- типы ответов (как их описывает контракт API) ----------

interface TripView {
  id: string;
  start: string;
  end: string;
  amount: number;
  commission: number;
  payment: 'cash' | 'card';
}

interface Summary {
  trips: number;
  revenue: number;
  commission: number;
  net: number;
  cash: number;
  card: number;
}

interface DayResponse {
  date: string;
  timeZone: string;
  utcOffset: string;
  summary: Summary;
  trips: TripView[];
}

interface DaysResponse {
  days: { date: string; trips: number }[];
}

interface PostTripResponse {
  created: boolean;
  trip: TripView;
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    issues?: { field: string; message: string }[];
  };
}

// ---------- хелперы ----------

/** Валидная поездка из примера задания (t1) с переопределениями. */
function trip(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't1',
    start: '2026-10-01T08:10:00+05:00',
    end: '2026-10-01T08:32:00+05:00',
    amount: 2400,
    payment: 'card',
    commission: 360,
    ...overrides,
  };
}

/** Вторая поездка из примера задания (t2). */
const T2 = {
  id: 't2',
  start: '2026-10-01T09:05:00+05:00',
  end: '2026-10-01T09:20:00+05:00',
  amount: 1500,
  payment: 'cash',
  commission: 225,
};

/** Поездка без указанного поля. */
function tripWithout(field: string): Record<string, unknown> {
  const t = trip();
  delete t[field];
  return t;
}

const EMPTY_SUMMARY: Summary = { trips: 0, revenue: 0, commission: 0, net: 0, cash: 0, card: 0 };

const openApps: FastifyInstance[] = [];
const tmpFiles: string[] = [];

function makeApp(options?: AppOptions): FastifyInstance {
  const app = buildApp(options);
  openApps.push(app);
  return app;
}

function tmpDbPath(): string {
  const p = join(tmpdir(), `driver-shift-diary-test-${randomUUID()}.sqlite`);
  tmpFiles.push(p);
  return p;
}

function postTrip(app: FastifyInstance, body: unknown) {
  return app.inject({ method: 'POST', url: '/api/trips', payload: body as object });
}

async function getDay(app: FastifyInstance, date: string): Promise<DayResponse> {
  const res = await app.inject({ method: 'GET', url: `/api/days/${date}` });
  expect(res.statusCode).toBe(200);
  return res.json<DayResponse>();
}

async function expectCreated(app: FastifyInstance, body: unknown): Promise<PostTripResponse> {
  const res = await postTrip(app, body);
  expect(res.statusCode, res.body).toBe(201);
  const json = res.json<PostTripResponse>();
  expect(json.created).toBe(true);
  return json;
}

async function expectValidationError(app: FastifyInstance, body: unknown, field: string) {
  const res = await postTrip(app, body);
  expect(res.statusCode, res.body).toBe(400);
  const json = res.json<ErrorResponse>();
  expect(json.error.code).toBe('VALIDATION_ERROR');
  expect(typeof json.error.message).toBe('string');
  expect(json.error.message.length).toBeGreaterThan(0);
  expect(Array.isArray(json.error.issues)).toBe(true);
  expect(json.error.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ field, message: expect.any(String) })]),
  );
  for (const issue of json.error.issues ?? []) {
    expect(issue.message.length).toBeGreaterThan(0);
  }
}

let app: FastifyInstance;

beforeEach(() => {
  app = makeApp();
});

afterEach(async () => {
  while (openApps.length > 0) {
    const a = openApps.pop();
    try {
      await a?.close();
    } catch {
      // уже закрыт
    }
  }
  while (tmpFiles.length > 0) {
    const p = tmpFiles.pop() as string;
    for (const f of [p, `${p}-wal`, `${p}-shm`, `${p}-journal`]) {
      try {
        rmSync(f, { force: true });
      } catch {
        // на Windows sqlite может ещё держать файл — не валим тест
      }
    }
  }
});

// ---------- тесты ----------

describe('GET /health', () => {
  it('отвечает 200 {"ok":true}', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('GET /api/days/:date — сводка и список (AC-1, AC-2)', () => {
  it('AC-2: пример из задания — 2 поездки, 3900 ₸, комиссия 585, на руки 3315, нал/карта 1500/2400', async () => {
    await expectCreated(app, trip());
    await expectCreated(app, T2);

    const day = await getDay(app, '2026-10-01');
    expect(day.date).toBe('2026-10-01');
    expect(day.timeZone).toBe('Asia/Almaty');
    expect(day.utcOffset).toBe('+05:00');
    expect(day.summary).toEqual({
      trips: 2,
      revenue: 3900,
      commission: 585,
      net: 3315,
      cash: 1500,
      card: 2400,
    });
  });

  it('AC-1: поездки дня отдаются со всеми полями и отсортированы по start', async () => {
    await expectCreated(app, trip());
    await expectCreated(app, T2);

    const day = await getDay(app, '2026-10-01');
    expect(day.trips).toEqual([
      {
        id: 't1',
        start: '2026-10-01T08:10:00+05:00',
        end: '2026-10-01T08:32:00+05:00',
        amount: 2400,
        commission: 360,
        payment: 'card',
      },
      {
        id: 't2',
        start: '2026-10-01T09:05:00+05:00',
        end: '2026-10-01T09:20:00+05:00',
        amount: 1500,
        commission: 225,
        payment: 'cash',
      },
    ]);
  });

  it('AC-1: порядок по start, даже если поездки добавлены в обратном порядке', async () => {
    await expectCreated(app, T2);
    await expectCreated(app, trip());
    // id не определяет порядок: «a» раньше по алфавиту, но позже по времени
    await expectCreated(
      app,
      trip({ id: 'a-late', start: '2026-10-01T21:00:00+05:00', end: '2026-10-01T21:30:00+05:00' }),
    );

    const day = await getDay(app, '2026-10-01');
    expect(day.trips.map((t) => t.id)).toEqual(['t1', 't2', 'a-late']);
  });

  it('AC-1: сортировка по моменту, а не по строке, если поездки пришли в разных смещениях', async () => {
    // '2026-10-01T10:05:00+07:00' = 03:05Z = 08:05+05:00 — раньше t1 (08:10+05:00),
    // хотя как строка она «позже» и t1, и t2 (09:05+05:00).
    await expectCreated(app, trip());
    await expectCreated(app, T2);
    await expectCreated(
      app,
      trip({
        id: 't0',
        start: '2026-10-01T10:05:00+07:00',
        end: '2026-10-01T10:08:00+07:00',
      }),
    );

    const day = await getDay(app, '2026-10-01');
    expect(day.trips.map((t) => t.id)).toEqual(['t0', 't1', 't2']);
    expect(day.trips[0]).toMatchObject({
      start: '2026-10-01T08:05:00+05:00',
      end: '2026-10-01T08:08:00+05:00',
    });
  });

  it('AC-1: поездки соседних дней не попадают в день', async () => {
    await expectCreated(app, trip());
    await expectCreated(app, T2);
    await expectCreated(
      app,
      trip({ id: 'prev', start: '2026-09-30T12:00:00+05:00', end: '2026-09-30T12:30:00+05:00' }),
    );
    await expectCreated(
      app,
      trip({ id: 'next', start: '2026-10-02T12:00:00+05:00', end: '2026-10-02T12:30:00+05:00' }),
    );

    const day = await getDay(app, '2026-10-01');
    expect(day.trips.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(day.summary).toEqual({
      trips: 2,
      revenue: 3900,
      commission: 585,
      net: 3315,
      cash: 1500,
      card: 2400,
    });

    const prev = await getDay(app, '2026-09-30');
    expect(prev.trips.map((t) => t.id)).toEqual(['prev']);
    expect(prev.summary).toEqual({
      trips: 1,
      revenue: 2400,
      commission: 360,
      net: 2040,
      cash: 0,
      card: 2400,
    });
  });

  it('AC-2: граничные комиссии 0 и равная сумме принимаются и считаются в сводке', async () => {
    await expectCreated(app, trip({ id: 'free', amount: 1000, commission: 0, payment: 'cash' }));
    await expectCreated(
      app,
      trip({
        id: 'all',
        start: '2026-10-01T10:00:00+05:00',
        end: '2026-10-01T10:10:00+05:00',
        amount: 700,
        commission: 700,
        payment: 'card',
      }),
    );

    const day = await getDay(app, '2026-10-01');
    expect(day.summary).toEqual({
      trips: 2,
      revenue: 1700,
      commission: 700,
      net: 1000,
      cash: 1000,
      card: 700,
    });
  });
});

describe('Граница дня в часовом поясе водителя (AC-3)', () => {
  it('AC-3: поездка в 02:00 по Алматы (по UTC — предыдущий день) попадает в свой локальный день', async () => {
    await expectCreated(
      app,
      trip({ id: 'night', start: '2026-10-02T02:00:00+05:00', end: '2026-10-02T02:30:00+05:00' }),
    );

    const day2 = await getDay(app, '2026-10-02');
    expect(day2.trips.map((t) => t.id)).toEqual(['night']);
    expect(day2.summary.trips).toBe(1);

    const day1 = await getDay(app, '2026-10-01');
    expect(day1.trips).toEqual([]);
    expect(day1.summary).toEqual(EMPTY_SUMMARY);
  });

  it('AC-3: ночная поездка, присланная в Z (2026-10-01T21:00Z), относится к 2026-10-02 и отдаётся в +05:00', async () => {
    await expectCreated(
      app,
      trip({ id: 'nightZ', start: '2026-10-01T21:00:00Z', end: '2026-10-01T21:30:00Z' }),
    );

    const day2 = await getDay(app, '2026-10-02');
    expect(day2.trips).toEqual([
      {
        id: 'nightZ',
        start: '2026-10-02T02:00:00+05:00',
        end: '2026-10-02T02:30:00+05:00',
        amount: 2400,
        commission: 360,
        payment: 'card',
      },
    ]);

    const day1 = await getDay(app, '2026-10-01');
    expect(day1.trips).toEqual([]);
  });

  it('AC-3: граница ровно в полночь — 00:00:00+05:00 это уже новый день, 23:59:59 — ещё старый', async () => {
    await expectCreated(
      app,
      trip({
        id: 'midnight',
        start: '2026-10-02T00:00:00+05:00',
        end: '2026-10-02T00:15:00+05:00',
      }),
    );
    await expectCreated(
      app,
      trip({ id: 'late', start: '2026-10-01T23:59:59+05:00', end: '2026-10-02T00:05:00+05:00' }),
    );

    expect((await getDay(app, '2026-10-02')).trips.map((t) => t.id)).toEqual(['midnight']);
    expect((await getDay(app, '2026-10-01')).trips.map((t) => t.id)).toEqual(['late']);
  });

  it('AC-3: поездка 23:50–00:20 относится к дню начала', async () => {
    await expectCreated(
      app,
      trip({ id: 'cross', start: '2026-10-01T23:50:00+05:00', end: '2026-10-02T00:20:00+05:00' }),
    );

    const day1 = await getDay(app, '2026-10-01');
    expect(day1.trips).toEqual([
      {
        id: 'cross',
        start: '2026-10-01T23:50:00+05:00',
        end: '2026-10-02T00:20:00+05:00',
        amount: 2400,
        commission: 360,
        payment: 'card',
      },
    ]);
    expect(day1.summary.trips).toBe(1);

    const day2 = await getDay(app, '2026-10-02');
    expect(day2.trips).toEqual([]);
    expect(day2.summary).toEqual(EMPTY_SUMMARY);
  });

  it('AC-3: поездка, присланная в Z, отдаётся во времени водителя (+05:00)', async () => {
    await expectCreated(app, trip({ start: '2026-10-01T03:10:00Z', end: '2026-10-01T03:32:00Z' }));

    const day = await getDay(app, '2026-10-01');
    expect(day.trips).toHaveLength(1);
    expect(day.trips[0]).toMatchObject({
      id: 't1',
      start: '2026-10-01T08:10:00+05:00',
      end: '2026-10-01T08:32:00+05:00',
    });
  });

  it('AC-3: часовой пояс водителя берётся из опции timeZone (Asia/Tokyo, +09:00)', async () => {
    const tokyo = makeApp({ timeZone: 'Asia/Tokyo' });
    // 20:00+05:00 = 15:00Z = 00:00+09:00 следующего дня
    await expectCreated(
      tokyo,
      trip({ id: 'tk', start: '2026-10-01T20:00:00+05:00', end: '2026-10-01T20:30:00+05:00' }),
    );

    const day2 = await getDay(tokyo, '2026-10-02');
    expect(day2.timeZone).toBe('Asia/Tokyo');
    expect(day2.utcOffset).toBe('+09:00');
    expect(day2.trips).toEqual([
      expect.objectContaining({
        id: 'tk',
        start: '2026-10-02T00:00:00+09:00',
        end: '2026-10-02T00:30:00+09:00',
      }),
    ]);
    expect((await getDay(tokyo, '2026-10-01')).trips).toEqual([]);
  });
});

describe('Пустой день и некорректная дата (AC-4)', () => {
  it('AC-4: день без поездок — 200, нулевая сводка и пустой список', async () => {
    const day = await getDay(app, '2026-10-01');
    expect(day).toEqual({
      date: '2026-10-01',
      timeZone: 'Asia/Almaty',
      utcOffset: '+05:00',
      summary: EMPTY_SUMMARY,
      trips: [],
    });
  });

  it.each([
    '2026-02-30',
    '2026-13-01',
    'yesterday',
    '2025-02-29',
    '2026-10-1',
    '2026-00-10',
    '2026-10-32',
  ])('AC-4: некорректная дата %s → 400 INVALID_DATE', async (date) => {
    const res = await app.inject({ method: 'GET', url: `/api/days/${date}` });
    expect(res.statusCode).toBe(400);
    const json = res.json<ErrorResponse>();
    expect(json.error.code).toBe('INVALID_DATE');
    expect(typeof json.error.message).toBe('string');
    expect(json.error.message.length).toBeGreaterThan(0);
  });

  it('AC-4: 29 февраля високосного года — корректная дата', async () => {
    const day = await getDay(app, '2028-02-29');
    expect(day.date).toBe('2028-02-29');
    expect(day.summary).toEqual(EMPTY_SUMMARY);
  });
});

describe('GET /api/days — список дней с поездками (AC-8)', () => {
  it('AC-8: пустая БД → пустой список дней', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/days' });
    expect(res.statusCode).toBe(200);
    expect(res.json<DaysResponse>()).toEqual({ days: [] });
  });

  it('AC-8/AC-3: только дни с поездками, от новых к старым, ночная поездка — в своём локальном дне', async () => {
    await expectCreated(
      app,
      trip({ id: 'old', start: '2026-09-30T12:00:00+05:00', end: '2026-09-30T12:30:00+05:00' }),
    );
    await expectCreated(app, trip());
    await expectCreated(app, T2);
    // 02:00+05:00 2 октября = 21:00Z 1 октября
    await expectCreated(
      app,
      trip({ id: 'night', start: '2026-10-01T21:00:00Z', end: '2026-10-01T21:30:00Z' }),
    );

    const res = await app.inject({ method: 'GET', url: '/api/days' });
    expect(res.statusCode).toBe(200);
    expect(res.json<DaysResponse>()).toEqual({
      days: [
        { date: '2026-10-02', trips: 1 },
        { date: '2026-10-01', trips: 2 },
        { date: '2026-09-30', trips: 1 },
      ],
    });
  });
});

describe('POST /api/trips — валидация (AC-5)', () => {
  it('AC-5: валидная поездка → 201 { created: true, trip }', async () => {
    const res = await postTrip(app, trip());
    expect(res.statusCode).toBe(201);
    expect(res.json<PostTripResponse>()).toEqual({
      created: true,
      trip: expect.objectContaining({
        id: 't1',
        amount: 2400,
        commission: 360,
        payment: 'card',
      }),
    });
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['amount = 0', trip({ amount: 0, commission: 0 }), 'amount'],
    ['amount = -1', trip({ amount: -1, commission: 0 }), 'amount'],
    ['amount дробный 10.5', trip({ amount: 10.5, commission: 0 }), 'amount'],
    ['amount строкой "2400"', trip({ amount: '2400' }), 'amount'],
    ['amount = null', trip({ amount: null }), 'amount'],
    ['нет amount', tripWithout('amount'), 'amount'],
    ['end === start', trip({ end: '2026-10-01T08:10:00+05:00' }), 'end'],
    ['end раньше start', trip({ end: '2026-10-01T08:00:00+05:00' }), 'end'],
    [
      'end === start в другом смещении (тот же момент)',
      trip({ end: '2026-10-01T03:10:00Z' }),
      'end',
    ],
    ['payment = "crypto"', trip({ payment: 'crypto' }), 'payment'],
    ['payment = "CARD"', trip({ payment: 'CARD' }), 'payment'],
    ['commission > amount', trip({ amount: 1000, commission: 1001 }), 'commission'],
    ['commission < 0', trip({ commission: -1 }), 'commission'],
    ['commission дробная', trip({ commission: 360.5 }), 'commission'],
    ['start без смещения', trip({ start: '2026-10-01T08:10:00' }), 'start'],
    ['end без смещения', trip({ end: '2026-10-01T08:32:00' }), 'end'],
    ['start — не дата', trip({ start: 'вчера утром' }), 'start'],
    ['нет id', tripWithout('id'), 'id'],
    ['id пустой', trip({ id: '' }), 'id'],
    ['id длиннее 64 символов', trip({ id: 'a'.repeat(65) }), 'id'],
    ['id с недопустимыми символами', trip({ id: 'trip 1/../x' }), 'id'],
  ])('AC-5: %s → 400 VALIDATION_ERROR с полем %s', async (_name, body, field) => {
    await expectValidationError(app, body, field);
    // невалидная поездка не записывается
    expect((await getDay(app, '2026-10-01')).trips).toEqual([]);
  });

  it('AC-5: id ровно 64 символа из [A-Za-z0-9_-] принимается', async () => {
    const id = `${'a'.repeat(30)}_-${'Z9'.repeat(16)}`;
    expect(id).toHaveLength(64);
    await expectCreated(app, trip({ id }));
  });

  it('AC-5: несколько ошибок — все поля перечислены в issues', async () => {
    const res = await postTrip(app, trip({ amount: 0, payment: 'crypto', start: 'nope' }));
    expect(res.statusCode).toBe(400);
    const json = res.json<ErrorResponse>();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    const fields = (json.error.issues ?? []).map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining(['amount', 'payment', 'start']));
  });

  it('AC-5: битый JSON → 400 BAD_REQUEST', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: { 'content-type': 'application/json' },
      payload: '{"id": "t1", "amount": ',
    });
    expect(res.statusCode).toBe(400);
    const json = res.json<ErrorResponse>();
    expect(json.error.code).toBe('BAD_REQUEST');
    expect(typeof json.error.message).toBe('string');
    expect(json.error.message.length).toBeGreaterThan(0);
  });

  it('AC-5: тело — не объект (массив) → 400', async () => {
    const res = await postTrip(app, [trip()]);
    expect(res.statusCode).toBe(400);
    expect(res.json<ErrorResponse>().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/trips — идемпотентность (AC-6)', () => {
  it('AC-6: повтор с тем же id и теми же данными → 200 created:false, дубля нет', async () => {
    const first = await expectCreated(app, trip());

    const res = await postTrip(app, trip());
    expect(res.statusCode).toBe(200);
    const second = res.json<PostTripResponse>();
    expect(second.created).toBe(false);
    expect(second.trip).toEqual(first.trip);

    const day = await getDay(app, '2026-10-01');
    expect(day.trips).toHaveLength(1);
    expect(day.summary).toEqual({
      trips: 1,
      revenue: 2400,
      commission: 360,
      net: 2040,
      cash: 0,
      card: 2400,
    });
  });

  it.each([
    ['Z', '2026-10-01T03:10:00Z', '2026-10-01T03:32:00Z'],
    ['+00:00', '2026-10-01T03:10:00+00:00', '2026-10-01T03:32:00+00:00'],
    ['дробные секунды .000Z', '2026-10-01T03:10:00.000Z', '2026-10-01T03:32:00.000Z'],
  ])('AC-6: тот же момент в другом смещении (%s) — это повтор, 200', async (_name, start, end) => {
    const first = await expectCreated(app, trip());

    const res = await postTrip(app, trip({ start, end }));
    expect(res.statusCode, res.body).toBe(200);
    const second = res.json<PostTripResponse>();
    expect(second.created).toBe(false);
    expect(second.trip).toEqual(first.trip);

    const day = await getDay(app, '2026-10-01');
    expect(day.trips).toHaveLength(1);
    expect(day.trips[0]?.start).toBe('2026-10-01T08:10:00+05:00');
  });

  it('AC-6: 20 параллельных одинаковых POST → ровно один 201, остальные 200, в дне 1 поездка', async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, () => postTrip(app, trip())));
    const codes = responses.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 200)).toHaveLength(19);

    const created = responses.map((r) => r.json<PostTripResponse>().created);
    expect(created.filter(Boolean)).toHaveLength(1);

    const day = await getDay(app, '2026-10-01');
    expect(day.trips).toHaveLength(1);
    expect(day.summary.revenue).toBe(2400);
  });

  it('AC-6: повтор после перезапуска сервера (та же БД-файл) → 200 created:false', async () => {
    const dbPath = tmpDbPath();

    const app1 = makeApp({ dbPath });
    const first = await expectCreated(app1, trip());
    await app1.close();

    const app2 = makeApp({ dbPath });
    const res = await postTrip(app2, trip());
    expect(res.statusCode, res.body).toBe(200);
    const second = res.json<PostTripResponse>();
    expect(second.created).toBe(false);
    expect(second.trip).toEqual(first.trip);

    const day = await getDay(app2, '2026-10-01');
    expect(day.trips).toHaveLength(1);
    expect(day.summary.revenue).toBe(2400);
  });

  it('AC-6: две разные поездки с одинаковыми данными, но разными id — обе записываются', async () => {
    await expectCreated(app, trip({ id: 'same-a' }));
    await expectCreated(app, trip({ id: 'same-b' }));

    const day = await getDay(app, '2026-10-01');
    expect(day.trips.map((t) => t.id).sort()).toEqual(['same-a', 'same-b']);
    expect(day.summary.revenue).toBe(4800);
  });
});

describe('POST /api/trips — конфликт (AC-7)', () => {
  it('AC-7: тот же id с другой суммой → 409 TRIP_CONFLICT, сохранена исходная сумма', async () => {
    await expectCreated(app, trip());

    const res = await postTrip(app, trip({ amount: 9999 }));
    expect(res.statusCode).toBe(409);
    const json = res.json<ErrorResponse>();
    expect(json.error.code).toBe('TRIP_CONFLICT');
    expect(typeof json.error.message).toBe('string');
    expect(json.error.message.length).toBeGreaterThan(0);

    const day = await getDay(app, '2026-10-01');
    expect(day.trips).toHaveLength(1);
    expect(day.trips[0]?.amount).toBe(2400);
    expect(day.summary.revenue).toBe(2400);
  });

  it.each<[string, Record<string, unknown>]>([
    ['другая комиссия', { commission: 0 }],
    ['другой способ оплаты', { payment: 'cash' }],
    ['другое начало', { start: '2026-10-01T08:11:00+05:00' }],
    ['другой конец', { end: '2026-10-01T08:33:00+05:00' }],
    [
      'другой момент при той же «стенной» записи в другом смещении',
      {
        start: '2026-10-01T08:10:00Z',
        end: '2026-10-01T08:32:00Z',
      },
    ],
    [
      'перенос в другой день',
      {
        start: '2026-10-02T08:10:00+05:00',
        end: '2026-10-02T08:32:00+05:00',
      },
    ],
  ])('AC-7: тот же id, %s → 409, запись не меняется', async (_name, overrides) => {
    await expectCreated(app, trip());

    const res = await postTrip(app, trip(overrides));
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json<ErrorResponse>().error.code).toBe('TRIP_CONFLICT');

    const day = await getDay(app, '2026-10-01');
    expect(day.trips).toEqual([
      {
        id: 't1',
        start: '2026-10-01T08:10:00+05:00',
        end: '2026-10-01T08:32:00+05:00',
        amount: 2400,
        commission: 360,
        payment: 'card',
      },
    ]);
    expect((await getDay(app, '2026-10-02')).trips).toEqual([]);
  });

  it('AC-7: после конфликта повтор исходных данных по-прежнему 200', async () => {
    await expectCreated(app, trip());
    expect((await postTrip(app, trip({ amount: 3000 }))).statusCode).toBe(409);

    const res = await postTrip(app, trip());
    expect(res.statusCode).toBe(200);
    expect(res.json<PostTripResponse>().created).toBe(false);
  });

  it('AC-7: конфликт определяется и после перезапуска сервера', async () => {
    const dbPath = tmpDbPath();

    const app1 = makeApp({ dbPath });
    await expectCreated(app1, trip());
    await app1.close();

    const app2 = makeApp({ dbPath });
    const res = await postTrip(app2, trip({ amount: 2500 }));
    expect(res.statusCode).toBe(409);
    expect(res.json<ErrorResponse>().error.code).toBe('TRIP_CONFLICT');
    expect((await getDay(app2, '2026-10-01')).trips[0]?.amount).toBe(2400);
  });
});

describe('Ошибки транспорта и конфигурации (находки reviewer и api-qa)', () => {
  let app: FastifyInstance;
  beforeEach(() => {
    app = makeApp();
  });

  it('AC-5: text/plain с корректной поездкой → 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: { 'content-type': 'text/plain' },
      payload: JSON.stringify(trip()),
    });
    expect(res.statusCode).toBe(415);
    expect(res.json<ErrorResponse>().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('AC-5: тело больше 16 КБ → 413 PAYLOAD_TOO_LARGE с русским сообщением', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ ...trip(), pad: 'x'.repeat(20_000) }),
    });
    expect(res.statusCode).toBe(413);
    const { error } = res.json<ErrorResponse>();
    expect(error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(error.message).toMatch(/[А-Яа-я]/);
  });

  it('опечатка в часовом поясе — ошибка при старте, а не 500 на каждый запрос', () => {
    expect(() => buildApp({ timeZone: 'Asia/Almatyy' })).toThrow(/Asia\/Almatyy/);
  });
});
