import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, DayResponse } from './lib/api';

type DayState =
  | { status: 'loading'; data?: DayResponse }
  | { status: 'ready'; data: DayResponse }
  | { status: 'error'; message: string; data?: DayResponse };

/**
 * Loads one day. Switching days quickly aborts the previous request, so a slow response
 * for an old day can never overwrite the day the driver is looking at.
 */
export function useDay(api: ApiClient, date: string) {
  const [state, setState] = useState<DayState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({
      status: 'loading',
      data: prev.data?.date === date ? prev.data : undefined,
    }));
    api
      .getDay(date, controller.signal)
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
        setState((prev) => ({ status: 'error', message, data: prev.data }));
      });
    return () => controller.abort();
  }, [api, date, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  return { state, reload };
}
