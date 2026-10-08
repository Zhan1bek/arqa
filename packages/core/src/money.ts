// Money is integer tenge everywhere (ADR-0001). This module is the only place that formats it.

const NBSP = ' ';
const MINUS = '−';

/** 2400 → "2 400 ₸" (NBSP-separated groups). Deterministic across Hermes/V8, unlike Intl. */
export function formatTenge(amount: number): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`Amount must be an integer number of tenge, got ${amount}`);
  }
  const digits = String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${amount < 0 ? MINUS : ''}${digits}${NBSP}₸`;
}
