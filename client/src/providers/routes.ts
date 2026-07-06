import { bearing as turfBearing, destination, point } from '@turf/turf';

/**
 * Built-in demo routes for the SimulatedProvider, derived from the seed M1
 * centerline (coordinates copied from server/data/hazards.json — the client
 * must not depend on the server filesystem). GeoJSON order: [lon, lat].
 */
const M1_CENTERLINE: [number, number][] = [
  [18.14718, 47.66533],
  [18.15955, 47.66312],
  [18.17628, 47.66103],
  [18.18334, 47.65931],
  [18.18971, 47.65678],
  [18.20705, 47.6473],
  [18.21467, 47.64366],
  [18.21939, 47.6417],
  [18.22657, 47.63923],
  [18.24112, 47.63524],
  [18.2592, 47.62929],
  [18.26634, 47.62727],
  [18.27239, 47.6261],
  [18.27837, 47.62555],
  [18.28415, 47.62546],
  [18.29843, 47.62577],
  [18.30824, 47.62533],
  [18.31802, 47.62407],
  [18.32886, 47.62161],
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
