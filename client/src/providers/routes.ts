import { bearing as turfBearing, destination, point } from '@turf/turf';

/**
 * Built-in demo routes for the SimulatedProvider, derived from the seed M1
 * centerline (coordinates copied from server/data/hazards.json — the client
 * must not depend on the server filesystem). GeoJSON order: [lon, lat].
 */
const M1_CENTERLINE: [number, number][] = [
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

const LEAD_IN_M = 4000; // ~4 km approach before the zone entry (Budapest side)
const OVERRUN_M = 3000; // long enough past the zone to demo PASSED → IDLE (2.3 km)

function norm(bearingDeg: number): number {
  return ((bearingDeg % 360) + 360) % 360;
}

function buildTowardGyor(): [number, number][] {
  // Driving Budapest→Győr = east→west along the seed line: Tata end first.
  const drive = [...M1_CENTERLINE].reverse();
  const entry = drive[0];
  const entryBearing = norm(turfBearing(point(entry), point(drive[1])));
  const start = destination(point(entry), LEAD_IN_M, norm(entryBearing + 180), {
    units: 'meters',
  }).geometry.coordinates as [number, number];

  const last = drive[drive.length - 1];
  const exitBearing = norm(turfBearing(point(drive[drive.length - 2]), point(last)));
  const end = destination(point(last), OVERRUN_M, exitBearing, { units: 'meters' })
    .geometry.coordinates as [number, number];

  return [start, ...drive, end];
}

/** Route (a): toward Győr, through the construction zone, ~4 km lead-in. */
export const ROUTE_TOWARD_GYOR: [number, number][] = buildTowardGyor();

/** Route (b): the same corridor reversed (opposite carriageway — stays IDLE). */
export const ROUTE_TOWARD_BUDAPEST: [number, number][] = [...ROUTE_TOWARD_GYOR].reverse();
