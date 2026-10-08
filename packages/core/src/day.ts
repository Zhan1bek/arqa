// Calendar days are local to the driver's time zone, never UTC (ADR-0002).
// A "local date" is a 'YYYY-MM-DD' string; instants are epoch milliseconds.

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** True only for a real calendar date in strict 'YYYY-MM-DD' form ('2026-02-30' is false). */
export function isValidLocalDate(value: string): boolean {
  const match = LOCAL_DATE_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(instant: number, timeZone: string) {
  let fmt = partsFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(timeZone, fmt);
  }
  const parts: Record<string, string> = {};
  for (const { type, value } of fmt.formatToParts(instant)) parts[type] = value;
  return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string>;
}

function toInstant(instant: string | number): number {
  const ms = typeof instant === 'number' ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) throw new RangeError(`Invalid instant: ${instant}`);
  return ms;
}

/** Calendar date of an instant as seen in `timeZone`. */
export function localDateOf(instant: string | number, timeZone: string): string {
  const p = zonedParts(toInstant(instant), timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Offset of `timeZone` at `instant`, e.g. '+05:00'. */
export function utcOffsetOf(instant: number, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  const wallClockAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMinutes = Math.round((wallClockAsUtc - Math.floor(instant / 1000) * 1000) / 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Instant rendered as ISO 8601 in `timeZone`: '2026-10-01T08:10:00+05:00'. */
export function toZonedIso(instant: number, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${utcOffsetOf(instant, timeZone)}`;
}

/** '2026-10-31' + 1 → '2026-11-01'. Pure calendar arithmetic, no time zones involved. */
export function shiftLocalDate(date: string, days: number): string {
  if (!isValidLocalDate(date)) throw new RangeError(`Invalid local date: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}
