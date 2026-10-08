import { describe, it, expect } from 'vitest';
import type { TripInput } from '@diary/core';
import { buildTrip, issuesToFormErrors, type TripFormValues } from './tripForm';

const ctx = { id: 'trip-0b7c1e9a', date: '2026-10-01', utcOffset: '+05:00' };

const valid: TripFormValues = {
  start: '08:10',
  end: '08:32',
  amount: '2400',
  commission: '360',
  payment: 'card',
};

type FormErrors = Partial<Record<keyof TripFormValues, string>>;

function tripOf(values: Partial<TripFormValues>, c = ctx): TripInput {
  const result = buildTrip({ ...valid, ...values }, c);
  if (!result.ok) throw new Error(`ожидался ok, а получено: ${JSON.stringify(result.errors)}`);
  return result.trip;
}

function errorsOf(values: Partial<TripFormValues>, c = ctx): FormErrors {
  const result = buildTrip({ ...valid, ...values }, c);
  if (result.ok) throw new Error(`ожидалась ошибка, а получено ok: ${JSON.stringify(result.trip)}`);
  return result.errors;
}

const CYRILLIC = /[А-Яа-яЁё]/;

describe('buildTrip: корректная форма (AC-9)', () => {
  it('AC-9: валидная форма → TripInput со временем в ISO со смещением дня', () => {
    expect(tripOf({})).toEqual({
      id: 'trip-0b7c1e9a',
      start: '2026-10-01T08:10:00+05:00',
      end: '2026-10-01T08:32:00+05:00',
      amount: 2400,
      commission: 360,
      payment: 'card',
    });
  });

  it('AC-9: id переносится как есть', () => {
    const id = 'A1_b2-C3_550e8400-e29b-41d4-a716-446655440000';
    expect(tripOf({}, { ...ctx, id }).id).toBe(id);
  });

  it('AC-9: одинаковые значения формы с тем же id дают одинаковое тело (повтор безопасен)', () => {
    expect(tripOf({})).toEqual(tripOf({}));
  });

  it('AC-9: сумма с пробелом-разделителем «2 400» → 2400', () => {
    expect(tripOf({ amount: '2 400' }).amount).toBe(2400);
  });

  it('AC-9: сумма с неразрывным пробелом «2 400» → 2400', () => {
    expect(tripOf({ amount: '2 400' }).amount).toBe(2400);
  });

  it('AC-9: пробелы вокруг времени не мешают', () => {
    expect(tripOf({ start: ' 08:10 ' }).start).toBe('2026-10-01T08:10:00+05:00');
  });

  it('AC-3: ночная поездка 00:10–00:40 по Алматы остаётся в выбранном дне со смещением +05:00', () => {
    const t = tripOf({ start: '00:10', end: '00:40' });
    expect(t.start).toBe('2026-10-01T00:10:00+05:00');
    expect(t.end).toBe('2026-10-01T00:40:00+05:00');
  });

  it('AC-9: смещение дня берётся из контекста', () => {
    expect(tripOf({}, { ...ctx, utcOffset: '+06:00' }).start).toBe('2026-10-01T08:10:00+06:00');
  });

  it('AC-9: комиссия 0 допустима', () => {
    expect(tripOf({ commission: '0' }).commission).toBe(0);
  });

  it('AC-9: комиссия равна сумме допустима', () => {
    expect(tripOf({ amount: '1500', commission: '1500' }).commission).toBe(1500);
  });

  it('AC-9: наличные переносятся как payment cash', () => {
    expect(tripOf({ payment: 'cash' }).payment).toBe('cash');
  });
});

describe('buildTrip: ошибки времени (AC-9)', () => {
  it.each(['8:10', '24:00', '', '08:60', '0810', '08:10:00', 'abc'])(
    'AC-9: начало %j — ошибка на поле start',
    (start) => {
      const errors = errorsOf({ start });
      expect(errors.start).toMatch(CYRILLIC);
    },
  );

  it.each(['8:10', '24:00', ''])('AC-9: окончание %j — ошибка на поле end', (end) => {
    const errors = errorsOf({ end });
    expect(errors.end).toMatch(CYRILLIC);
    expect(errors.start).toBeUndefined();
  });

  it('AC-9: окончание раньше начала — ошибка на end по-русски', () => {
    const errors = errorsOf({ start: '09:00', end: '08:30' });
    expect(errors.end).toMatch(CYRILLIC);
    expect(errors.start).toBeUndefined();
  });

  it('AC-9: end === start — ошибка на end по-русски', () => {
    const errors = errorsOf({ start: '08:10', end: '08:10' });
    expect(errors.end).toMatch(CYRILLIC);
  });
});

describe('buildTrip: ошибки суммы и комиссии (AC-9, AC-5)', () => {
  it.each(['0', '', 'abc', '10.5', '10,5', '-100', '1e3'])(
    'AC-9: сумма %j — ошибка на поле amount',
    (amount) => {
      const errors = errorsOf({ amount, commission: '0' });
      expect(errors.amount).toMatch(CYRILLIC);
    },
  );

  it('AC-9: комиссия больше суммы — ошибка на commission', () => {
    const errors = errorsOf({ amount: '1000', commission: '1001' });
    expect(errors.commission).toMatch(CYRILLIC);
    expect(errors.amount).toBeUndefined();
  });

  it.each(['abc', '1.5', '-1'])('AC-9: комиссия %j — ошибка на commission', (commission) => {
    const errors = errorsOf({ commission });
    expect(errors.commission).toMatch(CYRILLIC);
  });
});

describe('issuesToFormErrors', () => {
  it('AC-5: ошибки сервера раскладываются по полям формы', () => {
    expect(
      issuesToFormErrors([
        { field: 'end', message: 'Окончание должно быть позже начала' },
        { field: 'commission', message: 'Комиссия не может быть больше суммы' },
      ]),
    ).toEqual({
      end: 'Окончание должно быть позже начала',
      commission: 'Комиссия не может быть больше суммы',
    });
  });

  it('AC-5: на поле остаётся первое сообщение', () => {
    expect(
      issuesToFormErrors([
        { field: 'amount', message: 'первое' },
        { field: 'amount', message: 'второе' },
      ]),
    ).toEqual({ amount: 'первое' });
  });

  it('AC-5: пустой список — нет ошибок', () => {
    expect(issuesToFormErrors([])).toEqual({});
  });

  it('AC-5: ошибка неизвестного поля не теряется', () => {
    const errors = issuesToFormErrors([{ field: 'id', message: 'id: обязателен' }]);
    expect(Object.values(errors)).toContain('id: обязателен');
  });
});

describe('buildTrip: все ошибки за одно нажатие (AC-9)', () => {
  it('неверное время и пустая сумма показываются вместе', () => {
    const errors = errorsOf({ start: '8:10', amount: '' });
    expect(errors.start).toBe('Время в формате ЧЧ:ММ');
    expect(errors.amount).toMatch(CYRILLIC);
  });

  it('end < start и пустая сумма показываются вместе', () => {
    const errors = errorsOf({ end: '08:00', amount: '' });
    expect(errors.end).toBe('Окончание должно быть позже начала');
    expect(errors.amount).toMatch(CYRILLIC);
  });
});
