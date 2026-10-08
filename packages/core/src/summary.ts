import type { TripInput } from './trip';

export interface DaySummary {
  trips: number;
  revenue: number;
  commission: number;
  /** "На руки": revenue − commission. */
  net: number;
  /** Revenue split by payment method. */
  cash: number;
  card: number;
}

export function summarizeDay(
  trips: ReadonlyArray<Pick<TripInput, 'amount' | 'commission' | 'payment'>>,
): DaySummary {
  const summary: DaySummary = { trips: 0, revenue: 0, commission: 0, net: 0, cash: 0, card: 0 };
  for (const trip of trips) {
    summary.trips += 1;
    summary.revenue += trip.amount;
    summary.commission += trip.commission;
    summary[trip.payment] += trip.amount;
  }
  summary.net = summary.revenue - summary.commission;
  return summary;
}
