import {
  along,
  bearing as turfBearing,
  destination,
  length as turfLength,
  lineString,
  point,
} from '@turf/turf';
import type { Hazard, PositionFix } from '@m1/shared';

/**
 * Test fixtures: fix-sequence generators interpolating along the seed M1
 * centerline. The coordinates are COPIED from server/data/hazards.json
 * (m1-construction) so the engine and its tests stay free of fs/fetch.
 * GeoJSON order: [lon, lat].
 */
export const M1_CENTERLINE: [number, number][] = [
  [18.155, 47.626],
  [18.1729, 47.6289],
  [18.1908, 47.6318],
  [18.2087, 47.6347],
  [18.2266, 47.6376],
  [18.2445, 47.6405],
  [18.2624, 47.6434],
  [18.2803, 47.6463],
  [18.2982, 47.6492],
  [18.316, 47.652],
];

/** Copy of the m1-construction seed hazard. */
export const M1_HAZARD: Hazard = {
  id: 'm1-construction',
  type: 'construction',
  severity: 'danger',
  active: true,
  geometry: { type: 'LineString', coordinates: M1_CENTERLINE },
  bufferMeters: 60,
  direction: { bearingDeg: 255, toleranceDeg: 60, bothWays: false },
  alertDistances: { preWarn: 2000, slowDown: 800 },
  speedLimitKmh: 80,
  message: {
    hu: 'Útépítés az M1-esen Concó és Tata között — sávlezárás, 80 km/h.',
    en: 'Roadworks on the M1 between Concó and Tata — lane closure, 80 km/h.',
  },
};

function norm(bearingDeg: number): number {
  return ((bearingDeg % 360) + 360) % 360;
}

// Budapest→Győr means driving east→west along the seed line: Tata end first.
const DRIVE_COORDS: [number, number][] = [...M1_CENTERLINE].reverse();
const ENTRY = DRIVE_COORDS[0]; // east (Tata) end — where an approach enters

/** Heading of travel when entering the zone from the Budapest side (~256°). */
export const ENTRY_BEARING = norm(turfBearing(point(ENTRY), point(DRIVE_COORDS[1])));
/** Heading of travel when driving AWAY from the zone toward Budapest (~76°). */
export const BACK_BEARING = norm(ENTRY_BEARING + 180);

/** Fixed epoch base for deterministic fixture timestamps. */
export const T0 = 1_700_000_000_000;

/**
 * Route toward Győr: `leadInM` straight lead-in on the Budapest side (along
 * the extension of the entry segment), then the full centerline, then
 * `overrunM` beyond the Concó end. [lon, lat] coords.
 */
export function buildApproachRoute(leadInM = 4000, overrunM = 1000): [number, number][] {
  const start = destination(point(ENTRY), leadInM, BACK_BEARING, { units: 'meters' })
    .geometry.coordinates as [number, number];
  const last = DRIVE_COORDS[DRIVE_COORDS.length - 1];
  const exitBearing = norm(
    turfBearing(point(DRIVE_COORDS[DRIVE_COORDS.length - 2]), point(last)),
  );
  const end = destination(point(last), overrunM, exitBearing, { units: 'meters' })
    .geometry.coordinates as [number, number];
  return [start, ...DRIVE_COORDS, end];
}

/** Same corridor driven the opposite way (Győr→Budapest carriageway). */
export function buildOppositeRoute(leadInM = 4000, overrunM = 1000): [number, number][] {
  return [...buildApproachRoute(leadInM, overrunM)].reverse();
}

/**
 * One fix per simulated second along `route` at `speedKmh`, heading taken
 * from the local segment bearing, timestamps starting at `t0`.
 */
export function fixesAlong(
  route: [number, number][],
  speedKmh: number,
  t0 = T0,
): PositionFix[] {
  const line = lineString(route);
  const totalM = turfLength(line, { units: 'meters' });
  const stepM = speedKmh / 3.6;
  const fixes: PositionFix[] = [];
  let i = 0;
  for (let d = 0; d <= totalM; d += stepM) {
    const pos = along(line, d, { units: 'meters' }).geometry.coordinates as [number, number];
    // Segment bearing via a small lookahead (look behind at the very end).
    const aheadD = Math.min(d + 10, totalM);
    const headingDeg =
      aheadD > d
        ? norm(turfBearing(point(pos), along(line, aheadD, { units: 'meters' })))
        : norm(turfBearing(along(line, Math.max(d - 10, 0), { units: 'meters' }), point(pos)));
    fixes.push({
      lat: pos[1],
      lon: pos[0],
      speedKmh,
      headingDeg,
      accuracyM: 5,
      timestamp: t0 + i * 1000,
    });
    i += 1;
  }
  return fixes;
}

/**
 * A single fix on the approach axis at ~`distM` meters (centerline distance)
 * before the zone entry, heading toward the zone unless overridden.
 * `t` is seconds after T0.
 */
export function fixAt(
  distM: number,
  opts: { t: number; headingDeg?: number | null; speedKmh?: number | null },
): PositionFix {
  const pos = destination(point(ENTRY), distM, BACK_BEARING, { units: 'meters' })
    .geometry.coordinates as [number, number];
  return {
    lat: pos[1],
    lon: pos[0],
    speedKmh: opts.speedKmh === undefined ? 110 : opts.speedKmh,
    headingDeg: opts.headingDeg === undefined ? ENTRY_BEARING : opts.headingDeg,
    accuracyM: 5,
    timestamp: T0 + opts.t * 1000,
  };
}

/** Stationary fixes at `base`'s position: speed 0, heading null, 1 Hz. */
export function stationaryFixes(base: PositionFix, count: number): PositionFix[] {
  return Array.from({ length: count }, (_, i) => ({
    lat: base.lat,
    lon: base.lon,
    speedKmh: 0,
    headingDeg: null,
    accuracyM: 5,
    timestamp: base.timestamp + (i + 1) * 1000,
  }));
}
