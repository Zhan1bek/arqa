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

/** Years outside this range are typos, and years 0–99 break JS Date arithmetic. */
export const MIN_TRIP_YEAR = 2000;
export const MAX_TRIP_YEAR = 2100;

// Whole seconds only: the API renders times without fractions, so a non-zero millisecond would
// make the echoed trip differ from the stored instant (and a replay of it a 409). A zero fraction
// is fine — JS clients send `toISOString()`, which always has `.000`.
const instant = (label: string) =>
  z.iso
    .datetime({
      offset: true,
      error: `${label}: нужны дата и время ISO 8601 с секундами и смещением, например 2026-10-01T08:10:00+05:00`,
    })
    .refine((value) => Date.parse(value) % 1000 === 0, {
      error: `${label}: время с точностью до секунды, без долей`,
    })
    .refine(
      (value) => {
        const year = Number(value.slice(0, 4));
        return year >= MIN_TRIP_YEAR && year <= MAX_TRIP_YEAR;
      },
      { error: `${label}: год должен быть от ${MIN_TRIP_YEAR} до ${MAX_TRIP_YEAR}` },
    );

const tripObject = z.object(
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
);

/**
 * By default Zod skips object-level refinements when *any* field is invalid, so a form with a
 * bad amount would hide "end before start" until the next submit. Run each cross-field rule
 * as soon as the fields it reads are valid.
 */
const timesOnly = tripObject.pick({ start: true, end: true });
const moneyOnly = tripObject.pick({ amount: true, commission: true });

export const tripInputSchema = tripObject
  .refine((t) => Date.parse(t.end) > Date.parse(t.start), {
    path: ['end'],
    error: 'Окончание должно быть позже начала',
    when: (payload) => timesOnly.safeParse(payload.value).success,
  })
  .refine((t) => t.commission <= t.amount, {
    path: ['commission'],
    error: 'Комиссия не может быть больше суммы',
    when: (payload) => moneyOnly.safeParse(payload.value).success,
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
