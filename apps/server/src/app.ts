import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import {
  isValidLocalDate,
  parseTrip,
  summarizeDay,
  toZonedIso,
  utcOffsetOf,
  type DaySummary,
  type PaymentMethod,
} from '@diary/core';
import { TripRepository, type StoredTrip } from './repository';

export interface AppOptions {
  /** SQLite file path; ':memory:' by default. */
  dbPath?: string;
  /** Driver's IANA time zone; defines what "a day" is (ADR-0002). */
  timeZone?: string;
  logger?: boolean;
}

/** Trip as returned by the API: times are rendered in the driver's offset. */
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

interface ApiError {
  error: { code: string; message: string; issues?: Array<{ field: string; message: string }> };
}

function apiError(code: string, message: string, extra: Partial<ApiError['error']> = {}): ApiError {
  return { error: { code, message, ...extra } };
}

const FRAMEWORK_ERRORS: Record<number, [code: string, message: string]> = {
  400: ['BAD_REQUEST', 'Тело запроса должно быть корректным JSON'],
  413: ['PAYLOAD_TOO_LARGE', 'Тело запроса слишком большое'],
  415: ['UNSUPPORTED_MEDIA_TYPE', 'Нужен content-type: application/json'],
};

/** Fail at startup on a typo in DRIVER_TZ instead of answering 500 to every request. */
function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new Error(`Unknown time zone "${timeZone}" (DRIVER_TZ must be an IANA name)`);
  }
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const timeZone = options.timeZone ?? 'Asia/Almaty';
  assertTimeZone(timeZone);
  const repo = new TripRepository(options.dbPath ?? ':memory:', timeZone);
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 16 * 1024 });

  app.decorate('trips', repo);
  app.addHook('onClose', async () => repo.close());
  void app.register(cors, { origin: true });

  const toView = (trip: StoredTrip): TripView => ({
    id: trip.id,
    start: toZonedIso(trip.startMs, timeZone),
    end: toZonedIso(trip.endMs, timeZone),
    amount: trip.amount,
    commission: trip.commission,
    payment: trip.payment,
  });

  app.setErrorHandler((error: { statusCode?: number; message: string }, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error(error);
      return reply.status(500).send(apiError('INTERNAL', 'Внутренняя ошибка сервера'));
    }
    // Fastify's own 4xx (malformed JSON, wrong content type, body too large).
    const known = FRAMEWORK_ERRORS[status] ?? ['BAD_REQUEST', 'Некорректный запрос'];
    return reply.status(status).send(apiError(known[0], known[1]));
  });

  // Only JSON bodies are accepted; text/plain would otherwise reach the schema as a string.
  app.removeContentTypeParser('text/plain');

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send(apiError('NOT_FOUND', 'Маршрут не найден')),
  );

  app.get('/health', async () => ({ ok: true }));

  app.get('/api/days', async () => ({ days: repo.listDays() }));

  app.get<{ Params: { date: string } }>('/api/days/:date', async (request, reply) => {
    const { date } = request.params;
    if (!isValidLocalDate(date)) {
      return reply
        .status(400)
        .send(
          apiError('INVALID_DATE', 'Дата должна быть в формате YYYY-MM-DD, например 2026-10-01'),
        );
    }
    const trips = repo.listByDay(date);
    // Offset at local noon is the offset of that day (no DST in Kazakhstan; see ADR-0002).
    const noonUtc = Date.parse(`${date}T12:00:00Z`);
    const body: DayResponse = {
      date,
      timeZone,
      utcOffset: utcOffsetOf(noonUtc, timeZone),
      summary: summarizeDay(trips),
      trips: trips.map(toView),
    };
    return body;
  });

  app.post('/api/trips', async (request, reply) => {
    const parsed = parseTrip(request.body);
    if (!parsed.ok) {
      return reply
        .status(400)
        .send(
          apiError('VALIDATION_ERROR', 'Поездка не прошла проверку', { issues: parsed.issues }),
        );
    }
    const result = repo.insert(parsed.trip);
    switch (result.status) {
      case 'created':
        return reply.status(201).send({ created: true, trip: toView(result.trip) });
      case 'duplicate':
        return reply.status(200).send({ created: false, trip: toView(result.trip) });
      case 'conflict':
        return reply
          .status(409)
          .send(
            apiError(
              'TRIP_CONFLICT',
              `Поездка ${result.trip.id} уже записана с другими данными; для новой поездки нужен новый id`,
            ),
          );
    }
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    trips: TripRepository;
  }
}
