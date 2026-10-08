import { describe, it, expect } from 'vitest';
import { ApiError, NetworkError } from './api';
import { classifySaveError } from './submission';

describe('classifySaveError — что форма делает после неудачного сохранения (AC-9, ADR-0003)', () => {
  it('сетевая ошибка → unknown: данные замораживаются, повтор безопасен', () => {
    const failure = classifySaveError(new NetworkError('нет связи с сервером'));
    expect(failure.kind).toBe('unknown');
  });

  it('любая не-ApiError (например, TypeError из fetch) → unknown', () => {
    expect(classifySaveError(new TypeError('Network request failed')).kind).toBe('unknown');
  });

  it('409 → conflict: не повторять и не предлагать «исправить» под тем же id', () => {
    const failure = classifySaveError(new ApiError(409, 'TRIP_CONFLICT', 'conflict'));
    expect(failure.kind).toBe('conflict');
    if (failure.kind === 'conflict') expect(failure.message).toMatch(/уже сохранена/);
  });

  it('400 с issues → invalid: ничего не записано, форма остаётся редактируемой', () => {
    const error = new ApiError(400, 'VALIDATION_ERROR', 'bad', [
      { field: 'amount', message: 'Сумма должна быть больше 0' },
    ]);
    expect(classifySaveError(error)).toEqual({ kind: 'invalid', error });
  });

  it('прочие 4xx → rejected с текстом сервера', () => {
    const failure = classifySaveError(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Нужен JSON'));
    expect(failure).toEqual({ kind: 'rejected', message: 'Нужен JSON' });
  });
});
