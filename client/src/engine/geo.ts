import { bearing as turfBearing, lineString, nearestPointOnLine, point } from '@turf/turf';
import type { Hazard, PositionFix } from '@m1/shared';

/**
 * Pure geo helpers for the alert engine. No React, no DOM, no fetch, no
 * timers. GeoJSON is [lon, lat]; PositionFix is {lat, lon} — conversion
 * happens right here at the turf boundary. All turf calls use meters.
 */

/** Smallest angular difference between two bearings, 0–180°. */
function angularDiffDeg(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

function normalizeBearing(bearingDeg: number): number {
  return ((bearingDeg % 360) + 360) % 360;
}

/** Distance in meters from a fix to the hazard's centerline. */
export function distanceToCenterlineM(fix: PositionFix, hazard: Hazard): number {
  const snapped = nearestPointOnLine(
    lineString(hazard.geometry.coordinates),
    point([fix.lon, fix.lat]),
    { units: 'meters' },
  );
  const dist = snapped.properties.dist;
  return typeof dist === 'number' ? dist : Number.POSITIVE_INFINITY;
}

/** Inside the hazard zone when the centerline distance is under the buffer. */
export function isInsideZone(distanceM: number, hazard: Hazard): boolean {
  return distanceM < hazard.bufferMeters;
}

/**
 * Does the travel heading match the hazard's direction of concern?
 * Null heading → treat as match (cannot rule the driver out).
 */
export function directionMatches(headingDeg: number | null, hazard: Hazard): boolean {
  if (headingDeg === null) return true;
  if (hazard.direction.bothWays) return true;
  return angularDiffDeg(headingDeg, hazard.direction.bearingDeg) <= hazard.direction.toleranceDeg;
}

// Below this centerline distance the bearing to the nearest point is
// degenerate noise — a fix effectively on the line counts as approaching.
const ON_LINE_EPSILON_M = 5;

/**
 * Is the fix heading toward the hazard? True when the bearing from the fix to
 * the nearest point of the centerline is within 90° of the travel heading.
 * Null heading → true.
 */
export function isApproaching(fix: PositionFix, hazard: Hazard): boolean {
  if (fix.headingDeg === null) return true;
  const from = point([fix.lon, fix.lat]);
  const snapped = nearestPointOnLine(lineString(hazard.geometry.coordinates), from, {
    units: 'meters',
  });
  const dist = snapped.properties.dist;
  if (typeof dist === 'number' && dist < ON_LINE_EPSILON_M) return true;
  const bearingToHazard = normalizeBearing(turfBearing(from, snapped));
  return angularDiffDeg(fix.headingDeg, bearingToHazard) <= 90;
}
