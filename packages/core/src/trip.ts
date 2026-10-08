import { z } from 'zod';

// Single source of validation rules for both server and client (AGENTS.md, invariant 4).

export const PAYMENT_METHODS = ['cash', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Upper bound for one trip; keeps sums far below Number.MAX_SAFE_INTEGER. */
export const MAX_TRIP_AMOUNT = 10_000_000;

const tenge = (label: string) =>
  z
    .number({ error: `${label}: нужно число` })
    .int({ error: `${label}: только целые тенге` })
    .max(MAX_TRIP_AMOUNT, { error: `${label}: не больше ${MAX_TRIP_AMOUNT}` });

const instant = (label: string) =>
  z.iso.datetime({
    offset: true,
    error: `${label}: нужна дата и время ISO 8601 со смещением, например 2026-10-01T08:10:00+05:00`,
  });

export const tripInputSchema = z
  .object(
    {
      id: z
        .string({ error: 'id: обязателен' })
        .regex(/^[A-Za-z0-9_-]{1,64}$/, { error: 'id: 1–64 символа A-Z, a-z, 0-9, _ или -' }),
      start: instant('Начало'),
      end: instant('Окончание'),
      amount: tenge('Сумма').positive({ error: 'Сумма должна быть больше 0' }),
      payment: z.enum(PAYMENT_METHODS, { error: 'Способ оплаты: cash или card' }),
      commission: tenge('Комиссия').nonnegative({ error: 'Комиссия не может быть отрицательной' }),
    },
    { error: 'Ожидается объект поездки: id, start, end, amount, payment, commission' },
  )
  .refine((t) => Date.parse(t.end) > Date.parse(t.start), {
    path: ['end'],
    error: 'Окончание должно быть позже начала',
  })
  .refine((t) => t.commission <= t.amount, {
    path: ['commission'],
    error: 'Комиссия не может быть больше суммы',
  });

export type TripInput = z.infer<typeof tripInputSchema>;

export interface ValidationIssue {
  field: string;
  message: string;
}

export type ParseTripResult =
  { ok: true; trip: TripInput } | { ok: false; issues: ValidationIssue[] };

export function parseTrip(input: unknown): ParseTripResult {
  const result = tripInputSchema.safeParse(input);
  if (result.success) return { ok: true, trip: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
