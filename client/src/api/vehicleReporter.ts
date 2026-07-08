import type { PositionFix } from '@m1/shared';
import { useAppStore } from '../store';

/**
 * Reports the current position fix to the server's live-vehicle tracker while
 * the drive screen is active. Throttled to at most one POST every 2 s, skips
 * when there is no fix, and identifies this browser with a stable per-session
 * id. Wholly independent of the alert engine — this module never touches it.
 */

const THROTTLE_MS = 2000;
const STORAGE_KEY = 'm1-vehicle-id';

/** Generate once per browser tab/session and persist in sessionStorage. */
function vehicleId(): string {
  try {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const id = `veh-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return `veh-${Math.random().toString(36).slice(2, 8)}`;
  }
}

let unsub: (() => void) | null = null;
let lastSent = 0;

function report(id: string, fix: PositionFix): void {
  void fetch('/api/v1/vehicles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      lat: fix.lat,
      lon: fix.lon,
      speedKmh: fix.speedKmh,
      headingDeg: fix.headingDeg,
      timestamp: fix.timestamp,
    }),
  }).catch(() => {
    /* best-effort — a failed report must never disrupt the drive */
  });
}

/** Begin reporting fixes. Idempotent. */
export function startVehicleReporter(): void {
  if (unsub) return;
  const id = vehicleId();
  lastSent = 0;
  unsub = useAppStore.subscribe((state, prev) => {
    const fix = state.lastFix;
    if (!fix || fix === prev.lastFix) return; // skip when no (new) fix
    const now = Date.now();
    if (now - lastSent < THROTTLE_MS) return; // throttle to ≤ 1 / 2 s
    lastSent = now;
    report(id, fix);
  });
}

/** Stop reporting fixes. */
export function stopVehicleReporter(): void {
  if (unsub) {
    unsub();
    unsub = null;
  }
}
