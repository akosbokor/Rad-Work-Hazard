export type HazardType = 'construction' | 'accident' | 'congestion' | 'weather';
export type Severity = 'info' | 'warning' | 'danger';

export interface Hazard {
  id: string;
  type: HazardType;
  severity: Severity;
  active: boolean;
  geometry: { type: 'LineString'; coordinates: [number, number][] }; // [lon, lat]!
  bufferMeters: number;
  direction: { bearingDeg: number; toleranceDeg: number; bothWays: boolean };
  alertDistances: { preWarn: number; slowDown: number }; // meters
  speedLimitKmh?: number;
  message: { hu: string; en: string };
  validFrom?: string;
  validUntil?: string;
}

export interface PositionFix {
  lat: number;
  lon: number;
  speedKmh: number | null;
  headingDeg: number | null;
  accuracyM: number;
  timestamp: number;
}

export type AlertState = 'IDLE' | 'APPROACHING' | 'SLOW_DOWN' | 'IN_ZONE' | 'PASSED';

export interface VehicleFix {
  id: string;
  lat: number;
  lon: number;
  speedKmh: number | null;
  headingDeg: number | null;
  timestamp: number;
}

export type HazardStreamEvent =
  | { type: 'hazard_created' | 'hazard_updated'; hazard: Hazard }
  | { type: 'hazard_deleted'; hazardId: string }
  | { type: 'vehicle_position'; vehicle: VehicleFix }
  | { type: 'admin_message'; message: { text: string; severity: Severity; timestamp: number } };
