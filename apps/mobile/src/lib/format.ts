// Display helpers. No Intl with time zones on purpose: the server already renders times in the
// driver's offset (ADR-0002), and Intl support differs between Hermes builds.

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];
const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** '2026-10-01T08:10:00+05:00' → '08:10' (wall-clock time as sent by the server). */
export function formatTime(zonedIso: string): string {
  return zonedIso.slice(11, 16);
}

/** '2026-10-01' → { title: '1 октября', subtitle: 'чт, 2026' } */
export function formatDay(date: string): { title: string; subtitle: string } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { title: `${d} ${MONTHS_GENITIVE[m - 1]}`, subtitle: `${WEEKDAYS_SHORT[weekday]}, ${y}` };
}

/** Device-local calendar date. The device is assumed to be in the driver's time zone. */
export function deviceToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
