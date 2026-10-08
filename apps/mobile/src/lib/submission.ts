import { ApiError } from './api';

/**
 * What the add-trip form does after a failed save.
 *
 * The trip id is the idempotency key (ADR-0003). Once a request with that id *may* have reached
 * the server, the payload under that id is frozen: retrying must resend exactly the same trip.
 * Letting the driver edit the amount and resend under the same id gets a 409, and opening a new
 * form "to fix it" creates a second trip — the duplicate we are protecting against.
 */
export type SaveFailure =
  /** Outcome unknown (offline, timeout, 5xx): freeze the payload, offer "send again". */
  | { kind: 'unknown'; message: string }
  /** The server rejected the fields: nothing was written, the form stays editable. */
  | { kind: 'invalid'; error: ApiError }
  /** This id is already stored with other data: refresh the day, never resend. */
  | { kind: 'conflict'; message: string }
  | { kind: 'rejected'; message: string };

export function classifySaveError(error: unknown): SaveFailure {
  if (!(error instanceof ApiError)) {
    return {
      kind: 'unknown',
      message:
        'Нет связи с сервером, и неизвестно, сохранилась ли поездка. ' +
        'Нажмите «Отправить ещё раз» — она не задвоится.',
    };
  }
  if (error.status === 409) {
    return {
      kind: 'conflict',
      message: 'Эта поездка уже сохранена. Список дня обновлён; изменить её из приложения нельзя.',
    };
  }
  if (error.issues.length > 0) return { kind: 'invalid', error };
  return { kind: 'rejected', message: error.message };
}
