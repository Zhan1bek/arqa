import { describe, it, expect } from 'vitest';
import { summarizeDay, type TripInput } from './index';

const t1: TripInput = {
  id: 't1',
  start: '2026-10-01T08:10:00+05:00',
  end: '2026-10-01T08:32:00+05:00',
  amount: 2400,
  payment: 'card',
  commission: 360,
};

const t2: TripInput = {
  id: 't2',
  start: '2026-10-01T09:05:00+05:00',
  end: '2026-10-01T09:20:00+05:00',
  amount: 1500,
  payment: 'cash',
  commission: 225,
};

describe('summarizeDay', () => {
  it('AC-2: пример из задания — 2 поездки, 3 900 ₸, комиссия 585, на руки 3 315, нал/карта 1 500 / 2 400', () => {
    expect(summarizeDay([t1, t2])).toEqual({
      trips: 2,
      revenue: 3900,
      commission: 585,
      net: 3315,
      cash: 1500,
      card: 2400,
    });
  });

  it('AC-2: принимает минимальные объекты amount/commission/payment', () => {
    expect(
      summarizeDay([
        { amount: 2400, commission: 360, payment: 'card' },
        { amount: 1500, commission: 225, payment: 'cash' },
      ]),
    ).toEqual({ trips: 2, revenue: 3900, commission: 585, net: 3315, cash: 1500, card: 2400 });
  });

  it('AC-4: день без поездок — нулевая сводка', () => {
    expect(summarizeDay([])).toEqual({
      trips: 0,
      revenue: 0,
      commission: 0,
      net: 0,
      cash: 0,
      card: 0,
    });
  });

  it('AC-2: только наличные — card = 0', () => {
    expect(summarizeDay([{ amount: 1500, commission: 225, payment: 'cash' }])).toEqual({
      trips: 1,
      revenue: 1500,
      commission: 225,
      net: 1275,
      cash: 1500,
      card: 0,
    });
  });

  it('AC-2: только карта — cash = 0', () => {
    expect(
      summarizeDay([
        { amount: 2400, commission: 360, payment: 'card' },
        { amount: 800, commission: 120, payment: 'card' },
      ]),
    ).toEqual({ trips: 2, revenue: 3200, commission: 480, net: 2720, cash: 0, card: 3200 });
  });

  it('AC-2: нулевая комиссия — на руки вся выручка', () => {
    expect(summarizeDay([{ amount: 1000, commission: 0, payment: 'cash' }])).toEqual({
      trips: 1,
      revenue: 1000,
      commission: 0,
      net: 1000,
      cash: 1000,
      card: 0,
    });
  });

  it('AC-2: комиссия равна сумме — на руки 0', () => {
    expect(summarizeDay([{ amount: 700, commission: 700, payment: 'card' }])).toEqual({
      trips: 1,
      revenue: 700,
      commission: 700,
      net: 0,
      cash: 0,
      card: 700,
    });
  });

  it('AC-2: две одинаковые поездки считаются обе (дедупликация — не дело сводки)', () => {
    expect(
      summarizeDay([
        { amount: 1500, commission: 225, payment: 'cash' },
        { amount: 1500, commission: 225, payment: 'cash' },
      ]),
    ).toEqual({ trips: 2, revenue: 3000, commission: 450, net: 2550, cash: 3000, card: 0 });
  });

  it('AC-2: результат не зависит от порядка поездок', () => {
    expect(summarizeDay([t2, t1])).toEqual(summarizeDay([t1, t2]));
  });

  it('AC-2: большие суммы складываются точно, без float-погрешностей', () => {
    expect(
      summarizeDay([
        { amount: 1_000_000_001, commission: 150_000_001, payment: 'card' },
        { amount: 2_000_000_003, commission: 300_000_002, payment: 'cash' },
        { amount: 3_000_000_005, commission: 450_000_003, payment: 'card' },
      ]),
    ).toEqual({
      trips: 3,
      revenue: 6_000_000_009,
      commission: 900_000_006,
      net: 5_100_000_003,
      cash: 2_000_000_003,
      card: 4_000_000_006,
    });
  });

  it('не мутирует входной массив', () => {
    const trips = [t1, t2];
    summarizeDay(trips);
    expect(trips).toEqual([t1, t2]);
    expect(t1.amount).toBe(2400);
  });
});
