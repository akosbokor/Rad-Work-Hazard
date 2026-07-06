import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { lineString, point, nearestPointOnLine } from '@turf/turf';
import type { Hazard } from '@m1/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, '../data/hazards.json');

let hazards: Hazard[] = load();

function load(): Hazard[] {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  return JSON.parse(raw) as Hazard[];
}

/** Write the current in-memory store back to hazards.json (used by ?persist=true). */
export function persist(): void {
  fs.writeFileSync(DATA_PATH, JSON.stringify(hazards, null, 2) + '\n', 'utf-8');
}

export function getAll(): Hazard[] {
  return hazards;
}

export function getById(id: string): Hazard | undefined {
  return hazards.find((h) => h.id === id);
}

/**
 * Distance (meters) from a point to a hazard's ZONE: the centerline distance
 * minus the hazard's buffer. Negative when the point is inside the zone.
 * Turf MUST be called with { units: 'meters' } (see CLAUDE.md conventions).
 */
export function zoneDistanceM(lat: number, lon: number, hazard: Hazard): number {
  const line = lineString(hazard.geometry.coordinates);
  const pt = point([lon, lat]); // GeoJSON is [lon, lat]
  const snapped = nearestPointOnLine(line, pt, { units: 'meters' });
  const centerlineDist = snapped.properties.dist ?? Number.POSITIVE_INFINITY;
  return centerlineDist - hazard.bufferMeters;
}

/**
 * Active hazards whose zone (centerline distance − bufferMeters) is within radiusM.
 * The only list endpoint the app client uses.
 */
export function findNear(lat: number, lon: number, radiusM: number): Hazard[] {
  return hazards.filter((h) => h.active && zoneDistanceM(lat, lon, h) <= radiusM);
}

const HAZARD_DEFAULTS = {
  type: 'construction' as Hazard['type'],
  severity: 'warning' as Hazard['severity'],
  active: true,
  bufferMeters: 50,
  direction: { bearingDeg: 0, toleranceDeg: 60, bothWays: true },
  alertDistances: { preWarn: 1000, slowDown: 400 },
  message: { hu: '', en: '' },
};

/** Create a hazard from a partial input. Validates minimal shape, generates an id. */
export function create(input: Partial<Hazard>): Hazard {
  const geometry = input.geometry;
  if (
    !geometry ||
    geometry.type !== 'LineString' ||
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length < 2
  ) {
    throw new Error('geometry must be a LineString with at least 2 coordinates');
  }
  const hazard: Hazard = {
    ...HAZARD_DEFAULTS,
    ...input,
    id: input.id ?? `haz_${randomUUID().slice(0, 8)}`,
    geometry,
    direction: { ...HAZARD_DEFAULTS.direction, ...input.direction },
    alertDistances: { ...HAZARD_DEFAULTS.alertDistances, ...input.alertDistances },
    message: { ...HAZARD_DEFAULTS.message, ...input.message },
  };
  hazards.push(hazard);
  return hazard;
}

/** Shallow-merge update. Returns the updated hazard or undefined if not found. */
export function update(id: string, patch: Partial<Hazard>): Hazard | undefined {
  const existing = getById(id);
  if (!existing) return undefined;
  const merged: Hazard = { ...existing, ...patch, id: existing.id };
  const idx = hazards.findIndex((h) => h.id === id);
  hazards[idx] = merged;
  return merged;
}

export function remove(id: string): boolean {
  const idx = hazards.findIndex((h) => h.id === id);
  if (idx === -1) return false;
  hazards.splice(idx, 1);
  return true;
}
