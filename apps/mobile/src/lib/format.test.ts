import { describe, it, expect } from 'vitest';
import { deviceToday, formatDay, formatTime } from './format';

describe('formatTime (AC-8)', () => {
  it('AC-8: показывает время в смещении, присланном сервером', () => {
    expect(formatTime('2026-10-01T08:10:00+05:00')).toBe('08:10');
  });

  it('AC-3: ночное время по Алматы не сдвигается в UTC', () => {
    expect(formatTime('2026-10-01T00:20:00+05:00')).toBe('00:20');
  });
});

describe('formatDay (AC-8)', () => {
  it('AC-8: 2026-10-01 → «1 октября», «чт, 2026»', () => {
    expect(formatDay('2026-10-01')).toEqual({ title: '1 октября', subtitle: 'чт, 2026' });
  });

  it('AC-8: 2026-01-01 → «1 января», «чт, 2026»', () => {
    expect(formatDay('2026-01-01')).toEqual({ title: '1 января', subtitle: 'чт, 2026' });
  });

  it('AC-8: 2026-12-31 → «31 декабря», «чт, 2026»', () => {
    expect(formatDay('2026-12-31')).toEqual({ title: '31 декабря', subtitle: 'чт, 2026' });
  });

  it('AC-8: воскресенье 2026-10-04 → «вс»', () => {
    expect(formatDay('2026-10-04')).toEqual({ title: '4 октября', subtitle: 'вс, 2026' });
  });

  it('AC-8: 29 февраля високосного года', () => {
    expect(formatDay('2028-02-29')).toEqual({ title: '29 февраля', subtitle: 'вт, 2028' });
  });
});

describe('deviceToday (AC-3, AC-8)', () => {
  it('AC-3: 23:30 по местному времени — всё ещё тот же календарный день', () => {
    expect(deviceToday(new Date(2026, 9, 1, 23, 30))).toBe('2026-10-01');
  });

  it('AC-3: 00:30 по местному времени — уже новый день, не предыдущий по UTC', () => {
    expect(deviceToday(new Date(2026, 9, 2, 0, 30))).toBe('2026-10-02');
  });

  it('AC-8: месяц и день дополняются нулями', () => {
    expect(deviceToday(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });
});
