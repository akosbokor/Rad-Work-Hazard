import { bearing as turfBearing, distance as turfDistance, point } from '@turf/turf';
import type { PositionFix } from '@m1/shared';
import type { FixCallback, PositionProvider } from './types';

// watchPosition options are pinned by the plan — do not change.
const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 1000,
  timeout: 10000,
};

const MAX_ACCURACY_M = 100; // drop fixes worse than this
const MIN_MOVE_FOR_HEADING_M = 0.5; // below this, a derived bearing is noise

/**
 * Derive heading (0–360°) and speed (km/h) from two consecutive fixes, used
 * when the device reports null heading/speed (common when stationary or on
 * desktops without a real GPS sensor).
 */
function deriveFromFixes(
  prev: PositionFix,
  curr: PositionFix,
): { headingDeg: number | null; speedKmh: number | null } {
  const a = point([prev.lon, prev.lat]);
  const b = point([curr.lon, curr.lat]);
  const distM = turfDistance(a, b, { units: 'meters' });
  const dtSec = (curr.timestamp - prev.timestamp) / 1000;

  const headingDeg =
    distM > MIN_MOVE_FOR_HEADING_M ? (turfBearing(a, b) + 360) % 360 : null;
  const speedKmh = dtSec > 0 ? (distM / dtSec) * 3.6 : null;

  return { headingDeg, speedKmh };
}

export class RealGpsProvider implements PositionProvider {
  private watchId: number | null = null;
  private cb: FixCallback | null = null;
  private prev: PositionFix | null = null;

  start(cb: FixCallback): void {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      throw new Error('Geolocation API not available');
    }
    this.cb = cb;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handle(pos),
      (err) => {
        console.warn('[RealGpsProvider] watchPosition error:', err.message);
      },
      GEO_OPTIONS,
    );
  }

  stop(): void {
    if (this.watchId !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
    this.cb = null;
    this.prev = null;
  }

  private handle(pos: GeolocationPosition): void {
    const c = pos.coords;
    if (c.accuracy > MAX_ACCURACY_M) return; // drop low-quality fixes

    // Geolocation speed is m/s → convert to km/h. heading is already degrees.
    const reportedSpeedKmh =
      c.speed !== null && !Number.isNaN(c.speed) ? c.speed * 3.6 : null;
    const reportedHeadingDeg =
      c.heading !== null && !Number.isNaN(c.heading) ? c.heading : null;

    const fix: PositionFix = {
      lat: c.latitude,
      lon: c.longitude,
      speedKmh: reportedSpeedKmh,
      headingDeg: reportedHeadingDeg,
      accuracyM: c.accuracy,
      timestamp: pos.timestamp,
    };

    // Fill in null heading/speed from the last two fixes when possible.
    if ((fix.headingDeg === null || fix.speedKmh === null) && this.prev) {
      const derived = deriveFromFixes(this.prev, fix);
      if (fix.headingDeg === null) fix.headingDeg = derived.headingDeg;
      if (fix.speedKmh === null) fix.speedKmh = derived.speedKmh;
    }

    this.prev = fix;
    this.cb?.(fix);
  }
}
