import { useEffect } from 'react';

/**
 * Hold a screen wake lock for the lifetime of the drive screen so the display
 * does not sleep mid-drive/demo. The lock is released by the browser whenever
 * the tab is hidden, so re-acquire it on visibilitychange. All calls are
 * guarded — the API is unavailable on non-secure origins and older browsers.
 */
export function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    async function acquire(): Promise<void> {
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        /* denied or unavailable — display sleep is a non-fatal demo caveat */
      }
    }

    function onVisibility(): void {
      if (document.visibilityState === 'visible' && !released) void acquire();
    }

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);
}
