import { describe, it, expect } from 'vitest';
import { isValidLocalDate, localDateOf, shiftLocalDate, toZonedIso, utcOffsetOf } from './index';

const ALMATY = 'Asia/Almaty';

describe('isValidLocalDate', () => {
  it('AC-4: корректные даты YYYY-MM-DD', () => {
    expect(isValidLocalDate('2026-10-01')).toBe(true);
    expect(isValidLocalDate('2026-01-31')).toBe(true);
    expect(isValidLocalDate('2026-12-31')).toBe(true);
  });

  it('AC-4: 29 февраля — только в високосный год', () => {
    expect(isValidLocalDate('2028-02-29')).toBe(true);
    expect(isValidLocalDate('2000-02-29')).toBe(true);
    expect(isValidLocalDate('2026-02-29')).toBe(false);
    expect(isValidLocalDate('2100-02-29')).toBe(false);
  });

  it('AC-4: некорректные даты из спецификации → false', () => {
    expect(isValidLocalDate('2026-13-01')).toBe(false);
    expect(isValidLocalDate('2026-02-30')).toBe(false);
    expect(isValidLocalDate('yesterday')).toBe(false);
  });

  it('AC-4: несуществующие день и месяц → false', () => {
    expect(isValidLocalDate('2026-00-10')).toBe(false);
    expect(isValidLocalDate('2026-10-00')).toBe(false);
    expect(isValidLocalDate('2026-04-31')).toBe(false);
    expect(isValidLocalDate('2026-10-32')).toBe(false);
  });

  it('AC-4: неверный формат → false', () => {
    for (const value of [
      '',
      '2026-1-01',
      '2026-10-1',
      '26-10-01',
      '20261001',
      '2026/10/01',
      '01.10.2026',
      ' 2026-10-01',
      '2026-10-01 ',
      '2026-10-01T00:00:00',
      '2026-10-01T00:00:00+05:00',
    ]) {
      expect(isValidLocalDate(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe('localDateOf', () => {
  it('AC-3: 21:30Z — это уже 02:30 следующего дня по Алматы', () => {
    expect(localDateOf('2026-10-01T21:30:00Z', ALMATY)).toBe('2026-10-02');
  });

  it('AC-3: поездка 00:00–05:00 по Алматы относится к местному дню, а не к дню по UTC', () => {
    // 02:30+05:00 — по UTC это 2026-10-01T21:30Z, то есть предыдущий день.
    expect(localDateOf('2026-10-02T02:30:00+05:00', ALMATY)).toBe('2026-10-02');
    expect(localDateOf('2026-10-02T00:00:00+05:00', ALMATY)).toBe('2026-10-02');
    expect(localDateOf('2026-10-02T04:59:59+05:00', ALMATY)).toBe('2026-10-02');
  });

  it('AC-3: один и тот же момент в разных смещениях даёт одну дату', () => {
    expect(localDateOf('2026-10-01T08:10:00+05:00', ALMATY)).toBe('2026-10-01');
    expect(localDateOf('2026-10-01T03:10:00Z', ALMATY)).toBe('2026-10-01');
    expect(localDateOf('2026-10-02T02:30:00+05:00', ALMATY)).toBe(
      localDateOf('2026-10-01T21:30:00Z', ALMATY),
    );
  });

  it('AC-3: дата берётся в поясе водителя, а не из строки (смещение строки ≠ поясу)', () => {
    // 23:30+03:00 = 20:30Z = 01:30 по Алматы следующего дня; slice(0, 10) дал бы 2026-10-01.
    expect(localDateOf('2026-10-01T23:30:00+03:00', ALMATY)).toBe('2026-10-02');
  });

  it('AC-3: граница полуночи по Алматы', () => {
    expect(localDateOf('2026-10-01T18:59:59Z', ALMATY)).toBe('2026-10-01');
    expect(localDateOf('2026-10-01T19:00:00Z', ALMATY)).toBe('2026-10-02');
  });

  it('AC-3: поездка, начатая в 23:50, относится к дню начала', () => {
    expect(localDateOf('2026-10-01T23:50:00+05:00', ALMATY)).toBe('2026-10-01');
  });

  it('AC-3: принимает epoch ms', () => {
    expect(localDateOf(Date.parse('2026-10-01T21:30:00Z'), ALMATY)).toBe('2026-10-02');
    expect(localDateOf(Date.parse('2026-10-01T18:59:59Z'), ALMATY)).toBe('2026-10-01');
  });

  it('AC-3: учитывает переданный пояс (UTC, New York)', () => {
    expect(localDateOf('2026-10-01T21:30:00Z', 'UTC')).toBe('2026-10-01');
    // 02:00Z 2 октября = 22:00 1 октября в Нью-Йорке (EDT, −04:00).
    expect(localDateOf('2026-10-02T02:00:00Z', 'America/New_York')).toBe('2026-10-01');
  });

  it('AC-3: переход через год', () => {
    expect(localDateOf('2026-12-31T20:00:00Z', ALMATY)).toBe('2027-01-01');
  });
});

describe('utcOffsetOf', () => {
  const october = Date.parse('2026-10-01T03:10:00Z');

  it('Asia/Almaty → +05:00', () => {
    expect(utcOffsetOf(october, ALMATY)).toBe('+05:00');
    expect(utcOffsetOf(Date.parse('2026-01-15T12:00:00Z'), ALMATY)).toBe('+05:00');
  });

  it('UTC → +00:00', () => {
    expect(utcOffsetOf(october, 'UTC')).toBe('+00:00');
  });

  it('America/New_York: летом −04:00, зимой −05:00', () => {
    expect(utcOffsetOf(Date.parse('2026-07-01T12:00:00Z'), 'America/New_York')).toBe('-04:00');
    expect(utcOffsetOf(Date.parse('2026-01-15T12:00:00Z'), 'America/New_York')).toBe('-05:00');
  });

  it('смещение с минутами (Asia/Kolkata → +05:30)', () => {
    expect(utcOffsetOf(october, 'Asia/Kolkata')).toBe('+05:30');
  });
});

describe('toZonedIso', () => {
  it('AC-3: момент отдаётся во времени водителя со смещением', () => {
    expect(toZonedIso(Date.parse('2026-10-01T03:10:00Z'), ALMATY)).toBe(
      '2026-10-01T08:10:00+05:00',
    );
  });

  it('AC-3: ночное время по Алматы — уже следующий день', () => {
    expect(toZonedIso(Date.parse('2026-10-01T21:30:00Z'), ALMATY)).toBe(
      '2026-10-02T02:30:00+05:00',
    );
  });

  it('AC-3: полночь — это 00, а не 24', () => {
    expect(toZonedIso(Date.parse('2026-10-01T19:00:00Z'), ALMATY)).toBe(
      '2026-10-02T00:00:00+05:00',
    );
  });

  it('учитывает переданный пояс', () => {
    expect(toZonedIso(Date.parse('2026-10-01T03:10:00Z'), 'UTC')).toBe('2026-10-01T03:10:00+00:00');
    expect(toZonedIso(Date.parse('2026-07-01T12:00:00Z'), 'America/New_York')).toBe(
      '2026-07-01T08:00:00-04:00',
    );
  });

  it('результат обратно парсится в тот же момент', () => {
    const instant = Date.parse('2026-10-01T21:30:45Z');
    expect(Date.parse(toZonedIso(instant, ALMATY))).toBe(instant);
  });
});

describe('shiftLocalDate', () => {
  it('сдвиг через конец месяца', () => {
    expect(shiftLocalDate('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftLocalDate('2026-11-01', -1)).toBe('2026-10-31');
  });

  it('февраль в обычный и високосный год', () => {
    expect(shiftLocalDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftLocalDate('2028-03-01', -1)).toBe('2028-02-29');
    expect(shiftLocalDate('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('сдвиг через конец года', () => {
    expect(shiftLocalDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftLocalDate('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('нулевой сдвиг возвращает ту же дату', () => {
    expect(shiftLocalDate('2026-10-01', 0)).toBe('2026-10-01');
  });

  it('сдвиг на несколько дней', () => {
    expect(shiftLocalDate('2026-10-01', 7)).toBe('2026-10-08');
    expect(shiftLocalDate('2026-10-01', -30)).toBe('2026-09-01');
    expect(shiftLocalDate('2026-01-01', 365)).toBe('2027-01-01');
  });

  it('не спотыкается о дни перехода на летнее время (США, Европа)', () => {
    expect(shiftLocalDate('2026-03-08', 1)).toBe('2026-03-09');
    expect(shiftLocalDate('2026-03-29', 1)).toBe('2026-03-30');
    expect(shiftLocalDate('2026-11-02', -1)).toBe('2026-11-01');
    expect(shiftLocalDate('2026-10-26', -1)).toBe('2026-10-25');
  });
});
