import { describe, it, expect } from 'vitest';
import { formatTenge } from './index';

const NBSP = String.fromCharCode(0x00a0);
const MINUS = String.fromCharCode(0x2212);

describe('formatTenge', () => {
  it('AC-2: суммы из примера задания форматируются группами через NBSP', () => {
    expect(formatTenge(3900)).toBe(`3${NBSP}900${NBSP}₸`);
    expect(formatTenge(585)).toBe(`585${NBSP}₸`);
    expect(formatTenge(3315)).toBe(`3${NBSP}315${NBSP}₸`);
    expect(formatTenge(1500)).toBe(`1${NBSP}500${NBSP}₸`);
    expect(formatTenge(2400)).toBe(`2${NBSP}400${NBSP}₸`);
  });

  it('ноль', () => {
    expect(formatTenge(0)).toBe(`0${NBSP}₸`);
  });

  it('границы групп разрядов', () => {
    expect(formatTenge(1)).toBe(`1${NBSP}₸`);
    expect(formatTenge(999)).toBe(`999${NBSP}₸`);
    expect(formatTenge(1000)).toBe(`1${NBSP}000${NBSP}₸`);
    expect(formatTenge(100000)).toBe(`100${NBSP}000${NBSP}₸`);
    expect(formatTenge(1234567)).toBe(`1${NBSP}234${NBSP}567${NBSP}₸`);
    expect(formatTenge(1000000000)).toBe(`1${NBSP}000${NBSP}000${NBSP}000${NBSP}₸`);
  });

  it('отрицательная сумма — со знаком минус U+2212, а не дефисом', () => {
    expect(formatTenge(-585)).toBe(`${MINUS}585${NBSP}₸`);
    expect(formatTenge(-1234567)).toBe(`${MINUS}1${NBSP}234${NBSP}567${NBSP}₸`);
  });

  it('не использует обычные пробелы, узкие NBSP и дефис-минус', () => {
    const out = formatTenge(-1234567);
    for (const bad of [' ', '-', String.fromCharCode(0x202f), String.fromCharCode(0x2009)]) {
      expect(out).not.toContain(bad);
    }
  });

  it('нецелые суммы и NaN отвергаются RangeError (деньги — целые тенге)', () => {
    expect(() => formatTenge(0.5)).toThrow(RangeError);
    expect(() => formatTenge(2400.1)).toThrow(RangeError);
    expect(() => formatTenge(Number.NaN)).toThrow(RangeError);
    expect(() => formatTenge(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
