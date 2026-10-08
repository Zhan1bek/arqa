import { parseTrip, type PaymentMethod, type TripInput, type ValidationIssue } from '@diary/core';

/** Raw text from the form inputs. */
export interface TripFormValues {
  start: string; // 'HH:MM'
  end: string;
  amount: string;
  commission: string;
  payment: PaymentMethod;
}

export type TripFormResult =
  | { ok: true; trip: TripInput }
  | { ok: false; errors: Partial<Record<keyof TripFormValues, string>> };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** '08:10' → '2026-10-01T08:10:00+05:00'; anything else is kept as-is for the schema to reject. */
function toIso(time: string, date: string, utcOffset: string): string {
  const t = time.trim();
  return TIME_RE.test(t) ? `${date}T${t}:00${utcOffset}` : t;
}

/** Digits-only text → integer tenge; anything else → undefined (schema reports "нужно число"). */
function toTenge(text: string): number | undefined {
  const digits = text.replace(/\s/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : undefined;
}

/**
 * Turns form text into a trip and validates it with the same schema the server uses
 * (AGENTS.md invariant 4). Only input *parsing* (HH:MM, digits) lives here.
 */
export function buildTrip(
  values: TripFormValues,
  ctx: { id: string; date: string; utcOffset: string },
): TripFormResult {
  const parsed = parseTrip({
    id: ctx.id,
    start: toIso(values.start, ctx.date, ctx.utcOffset),
    end: toIso(values.end, ctx.date, ctx.utcOffset),
    amount: toTenge(values.amount),
    commission: toTenge(values.commission),
    payment: values.payment,
  });
  if (parsed.ok) return { ok: true, trip: parsed.trip };

  // Report every field at once; a malformed HH:MM gets a form-specific message.
  const errors = issuesToFormErrors(parsed.issues);
  if (!TIME_RE.test(values.start.trim())) errors.start = 'Время в формате ЧЧ:ММ';
  if (!TIME_RE.test(values.end.trim())) errors.end = 'Время в формате ЧЧ:ММ';
  return { ok: false, errors };
}

/** Maps server/schema issues onto form fields; unknown fields go to `amount` as a fallback. */
export function issuesToFormErrors(
  issues: ValidationIssue[],
): Partial<Record<keyof TripFormValues, string>> {
  const errors: Partial<Record<keyof TripFormValues, string>> = {};
  for (const { field, message } of issues) {
    const key = (
      ['start', 'end', 'amount', 'commission', 'payment'].includes(field) ? field : 'amount'
    ) as keyof TripFormValues;
    errors[key] ??= message;
  }
  return errors;
}
