import { describe, it, expect } from 'vitest';
import { parseTrip, PAYMENT_METHODS, type TripInput, type ValidationIssue } from './index';

const valid: TripInput = {
  id: 't1',
  start: '2026-10-01T08:10:00+05:00',
  end: '2026-10-01T08:32:00+05:00',
  amount: 2400,
  payment: 'card',
  commission: 360,
};

function issuesOf(input: unknown): ValidationIssue[] {
  const result = parseTrip(input);
  if (result.ok)
    throw new Error(`ожидалась ошибка валидации, а получено ok: ${JSON.stringify(input)}`);
  return result.issues;
}

function fieldsOf(input: unknown): string[] {
  return issuesOf(input).map((issue) => issue.field);
}

function tripOf(input: unknown): TripInput {
  const result = parseTrip(input);
  if (!result.ok) throw new Error(`ожидался ok, а получено: ${JSON.stringify(result.issues)}`);
  return result.trip;
}

const CYRILLIC = /[А-Яа-яЁё]/;

describe('PAYMENT_METHODS', () => {
  it('содержит ровно cash и card', () => {
    expect([...PAYMENT_METHODS]).toEqual(['cash', 'card']);
  });
});

describe('parseTrip: корректные поездки', () => {
  it('AC-5: поездка из примера задания проходит валидацию без изменений', () => {
    expect(tripOf(valid)).toEqual(valid);
  });

  it('AC-5: вторая поездка из примера (наличные) проходит валидацию', () => {
    const t2 = {
      id: 't2',
      start: '2026-10-01T09:05:00+05:00',
      end: '2026-10-01T09:20:00+05:00',
      amount: 1500,
      payment: 'cash',
      commission: 225,
    };
    expect(tripOf(t2)).toEqual(t2);
  });

  it('AC-5: время в UTC с суффиксом Z допустимо', () => {
    const trip = { ...valid, start: '2026-10-01T03:10:00Z', end: '2026-10-01T03:32:00Z' };
    expect(tripOf(trip)).toEqual(trip);
  });

  it('AC-5: лишние поля отбрасываются, а не считаются ошибкой', () => {
    const trip = tripOf({ ...valid, driver: 'Иван', note: 42 });
    expect(trip).toEqual(valid);
    expect(trip).not.toHaveProperty('driver');
    expect(trip).not.toHaveProperty('note');
  });

  it('AC-5: commission = 0 допустима', () => {
    expect(tripOf({ ...valid, commission: 0 }).commission).toBe(0);
  });

  it('AC-5: commission = amount допустима', () => {
    expect(tripOf({ ...valid, amount: 1000, commission: 1000 }).commission).toBe(1000);
  });

  it('AC-5: amount = 1 (минимальная положительная сумма) допустим', () => {
    expect(tripOf({ ...valid, amount: 1, commission: 0 }).amount).toBe(1);
  });

  it('AC-5: id из 1 и из 64 символов [A-Za-z0-9_-] допустим', () => {
    expect(tripOf({ ...valid, id: 'a' }).id).toBe('a');
    const id64 = 'Az09_-'.repeat(10) + 'abcd';
    expect(id64).toHaveLength(64);
    expect(tripOf({ ...valid, id: id64 }).id).toBe(id64);
  });

  it('AC-5: UUID в качестве id допустим', () => {
    const id = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c';
    expect(tripOf({ ...valid, id }).id).toBe(id);
  });

  it('AC-5: end сравнивается с start как момент, а не как строка (через полночь, разные смещения)', () => {
    // 23:50 по Алматы = 18:50Z; конец 19:20Z = 00:20 по Алматы следующего дня.
    // Строковое сравнение '2026-10-01T19:20:00Z' < '2026-10-01T23:50:00+05:00' дало бы ошибку.
    const trip = { ...valid, start: '2026-10-01T23:50:00+05:00', end: '2026-10-01T19:20:00Z' };
    expect(tripOf(trip)).toEqual(trip);
  });

  it('AC-5: поездка через полночь принимается', () => {
    const trip = { ...valid, start: '2026-10-01T23:50:00+05:00', end: '2026-10-02T00:20:00+05:00' };
    expect(tripOf(trip)).toEqual(trip);
  });
});

describe('parseTrip: amount', () => {
  it('AC-5: amount = 0 → ошибка в поле amount', () => {
    expect(fieldsOf({ ...valid, amount: 0, commission: 0 })).toContain('amount');
  });

  it('AC-5: отрицательный amount → ошибка в поле amount', () => {
    expect(fieldsOf({ ...valid, amount: -100, commission: 0 })).toContain('amount');
  });

  it('AC-5: дробный amount → ошибка в поле amount', () => {
    expect(fieldsOf({ ...valid, amount: 2400.5 })).toContain('amount');
  });

  it('AC-5: amount строкой → ошибка (без молчаливого приведения типа)', () => {
    expect(fieldsOf({ ...valid, amount: '2400' })).toContain('amount');
  });

  it('AC-5: amount = NaN / Infinity → ошибка', () => {
    expect(fieldsOf({ ...valid, amount: Number.NaN })).toContain('amount');
    expect(fieldsOf({ ...valid, amount: Number.POSITIVE_INFINITY })).toContain('amount');
  });

  it('AC-5: amount за пределами безопасного целого → ошибка', () => {
    expect(fieldsOf({ ...valid, amount: 2 ** 53, commission: 0 })).toContain('amount');
  });
});

describe('parseTrip: commission', () => {
  it('AC-5: commission > amount → ошибка в поле commission', () => {
    expect(fieldsOf({ ...valid, amount: 1000, commission: 1001 })).toEqual(['commission']);
  });

  it('AC-5: отрицательная commission → ошибка в поле commission', () => {
    expect(fieldsOf({ ...valid, commission: -1 })).toContain('commission');
  });

  it('AC-5: дробная commission → ошибка в поле commission', () => {
    expect(fieldsOf({ ...valid, commission: 360.5 })).toContain('commission');
  });

  it('AC-5: commission строкой → ошибка', () => {
    expect(fieldsOf({ ...valid, commission: '360' })).toContain('commission');
  });
});

describe('parseTrip: payment', () => {
  it('AC-5: неизвестный способ оплаты → ошибка в поле payment', () => {
    expect(fieldsOf({ ...valid, payment: 'kaspi' })).toContain('payment');
    expect(fieldsOf({ ...valid, payment: 'CASH' })).toContain('payment');
    expect(fieldsOf({ ...valid, payment: '' })).toContain('payment');
  });
});

describe('parseTrip: id', () => {
  it('AC-5: пустой id → ошибка в поле id', () => {
    expect(fieldsOf({ ...valid, id: '' })).toContain('id');
  });

  it('AC-5: id длиннее 64 символов → ошибка в поле id', () => {
    expect(fieldsOf({ ...valid, id: 'a'.repeat(65) })).toContain('id');
  });

  it('AC-5: недопустимые символы в id → ошибка в поле id', () => {
    for (const id of ['a b', 'поездка', 'a/b', 'a.b', 'a\n']) {
      expect(fieldsOf({ ...valid, id }), id).toContain('id');
    }
  });

  it('AC-5: id числом → ошибка в поле id', () => {
    expect(fieldsOf({ ...valid, id: 123 })).toContain('id');
  });
});

describe('parseTrip: start / end', () => {
  it('AC-5: время без смещения отвергается как неоднозначное', () => {
    expect(fieldsOf({ ...valid, start: '2026-10-01T08:10:00' })).toContain('start');
    expect(fieldsOf({ ...valid, end: '2026-10-01T08:32:00' })).toContain('end');
  });

  it('AC-5: время без секунд → ошибка', () => {
    expect(fieldsOf({ ...valid, start: '2026-10-01T08:10+05:00' })).toContain('start');
  });

  it('AC-5: не-ISO форматы времени → ошибка', () => {
    for (const start of [
      '',
      '2026-10-01',
      '08:10',
      '2026-10-01 08:10:00+05:00',
      '01.10.2026 08:10',
      'Thu, 01 Oct 2026 03:10:00 GMT',
    ]) {
      expect(fieldsOf({ ...valid, start }), start).toContain('start');
    }
  });

  it('AC-5: время числом (epoch ms) → ошибка', () => {
    expect(fieldsOf({ ...valid, start: Date.parse(valid.start) })).toContain('start');
  });

  it('AC-5: несуществующая дата 30 февраля → ошибка', () => {
    expect(fieldsOf({ ...valid, start: '2026-02-30T08:00:00+05:00' })).toContain('start');
  });

  it('AC-5: несуществующее время (25 часов, 60 минут) → ошибка', () => {
    expect(fieldsOf({ ...valid, start: '2026-10-01T25:00:00+05:00' })).toContain('start');
    expect(fieldsOf({ ...valid, start: '2026-10-01T08:60:00+05:00' })).toContain('start');
  });

  it('AC-5: end === start → ошибка в поле end', () => {
    expect(fieldsOf({ ...valid, end: valid.start })).toEqual(['end']);
  });

  it('AC-5: end раньше start → ошибка в поле end', () => {
    expect(
      fieldsOf({ ...valid, start: '2026-10-01T08:32:00+05:00', end: '2026-10-01T08:10:00+05:00' }),
    ).toEqual(['end']);
  });

  it('AC-5: end равен start как момент, но записан в другом смещении → ошибка в поле end', () => {
    // 08:10+05:00 и 03:10Z — одно и то же время.
    expect(
      fieldsOf({ ...valid, start: '2026-10-01T08:10:00+05:00', end: '2026-10-01T03:10:00Z' }),
    ).toEqual(['end']);
  });

  it('AC-5: end раньше start как момент, хотя строкой «больше» → ошибка в поле end', () => {
    // start 08:00Z (13:00 по Алматы), end 10:00+05:00 = 05:00Z — на 3 часа раньше.
    expect(
      fieldsOf({ ...valid, start: '2026-10-01T08:00:00Z', end: '2026-10-01T10:00:00+05:00' }),
    ).toEqual(['end']);
  });
});

describe('parseTrip: структура и сообщения', () => {
  it('AC-5: не объект → ошибка верхнего уровня с field ""', () => {
    for (const input of [null, undefined, 'trip', 42, true, [valid]]) {
      const issues = issuesOf(input);
      expect(issues.length, String(input)).toBeGreaterThan(0);
      expect(
        issues.map((i) => i.field),
        String(input),
      ).toContain('');
    }
  });

  it('AC-5: пустой объект → ошибка по каждому обязательному полю', () => {
    const fields = fieldsOf({});
    for (const field of ['id', 'start', 'end', 'amount', 'payment', 'commission']) {
      expect(fields).toContain(field);
    }
  });

  it('AC-5: несколько ошибок перечисляются все сразу', () => {
    const fields = fieldsOf({ ...valid, id: '', amount: '2400', payment: 'bitcoin' });
    expect(fields).toContain('id');
    expect(fields).toContain('amount');
    expect(fields).toContain('payment');
  });

  it('AC-5: сообщения об ошибках понятные и на русском', () => {
    const issues = [
      ...issuesOf({}),
      ...issuesOf(null),
      ...issuesOf({ ...valid, amount: 0, commission: 0 }),
      ...issuesOf({ ...valid, commission: 9999 }),
      ...issuesOf({ ...valid, end: valid.start }),
      ...issuesOf({ ...valid, start: '2026-10-01T08:10:00' }),
      ...issuesOf({ ...valid, payment: 'kaspi' }),
      ...issuesOf({ ...valid, id: 'a b' }),
    ];
    for (const issue of issues) {
      expect(typeof issue.field).toBe('string');
      expect(issue.message, `${issue.field}: ${issue.message}`).toMatch(CYRILLIC);
    }
  });

  it('не мутирует входной объект', () => {
    const input = { ...valid, extra: 1 };
    const snapshot = { ...input };
    parseTrip(input);
    expect(input).toEqual(snapshot);
  });
});

describe('parseTrip: кросс-полевые правила не прячутся за другими ошибками', () => {
  it('AC-5: неверная сумма и end < start → обе ошибки сразу', () => {
    const fields = fieldsOf({ ...valid, amount: 0, end: '2026-10-01T08:00:00+05:00' });
    expect(fields).toEqual(expect.arrayContaining(['amount', 'end']));
  });

  it('AC-5: неверное время и commission > amount → обе ошибки сразу', () => {
    const fields = fieldsOf({ ...valid, start: 'утром', commission: 9999 });
    expect(fields).toEqual(expect.arrayContaining(['start', 'commission']));
  });
});
