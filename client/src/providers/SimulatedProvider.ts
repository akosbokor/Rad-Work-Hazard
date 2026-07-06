import { along, bearing as turfBearing, length as turfLength, lineString } from '@turf/turf';
import type { Feature, LineString } from 'geojson';
import type { PositionFix } from '@m1/shared';
import type { FixCallback, PositionProvider } from './types';

export type SimMultiplier = 1 | 4 | 16;

const HEADING_LOOKAHEAD_M = 10;

function norm(bearingDeg: number): number {
  return ((bearingDeg % 360) + 360) % 360;
}

/**
 * Simulated route playback: consumes a route LineString + a target speed and
 * emits one PositionFix per SIMULATED second (heading from the local segment
 * bearing). Playback multiplier only compresses wall-clock time — fix
 * timestamps always advance by exactly 1000 ms per simulated second so the
 * engine sees an unchanged 1 Hz stream. Timers are allowed here: providers
 * are the boundary, not the pure engine.
 */
export class SimulatedProvider implements PositionProvider {
  private readonly line: Feature<LineString>;
  private readonly totalM: number;
  private readonly stepM: number; // meters per simulated second
  private readonly baseEpoch = Date.now();

  private progressM = 0;
  private simSec = 0;
  private multiplier: SimMultiplier = 1;
  private playing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cb: FixCallback | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    routeLonLat: [number, number][],
    private readonly targetKmh = 110,
  ) {
    this.line = lineString(routeLonLat);
    this.totalM = turfLength(this.line, { units: 'meters' });
    this.stepM = targetKmh / 3.6;
  }

  start(cb: FixCallback): void {
    this.cb = cb;
    this.emitFix();
    this.play();
  }

  stop(): void {
    this.pause();
    this.cb = null;
  }

  play(): void {
    if (this.playing) return;
    if (this.progressM >= this.totalM) this.restartPosition();
    this.playing = true;
    this.schedule();
    this.notify();
  }

  pause(): void {
    this.playing = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.notify();
  }

  restart(): void {
    this.restartPosition();
    this.emitFix();
    this.notify();
  }

  setSpeed(multiplier: SimMultiplier): void {
    this.multiplier = multiplier;
    if (this.playing) this.schedule();
    this.notify();
  }

  /** Jump to a fraction (0–1) of the route and emit the fix immediately. */
  scrubTo(fraction: number): void {
    const f = Math.min(1, Math.max(0, fraction));
    this.progressM = f * this.totalM;
    this.simSec = Math.round(this.progressM / this.stepM);
    this.emitFix();
    this.notify();
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getMultiplier(): SimMultiplier {
    return this.multiplier;
  }

  getFraction(): number {
    return this.totalM > 0 ? this.progressM / this.totalM : 0;
  }

  /** Subscribe to playback-state changes (for the SimControls UI). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private restartPosition(): void {
    this.progressM = 0;
    this.simSec = 0;
  }

  private schedule(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 1000 / this.multiplier);
  }

  private tick(): void {
    if (!this.playing) return;
    this.progressM = Math.min(this.progressM + this.stepM, this.totalM);
    this.simSec += 1;
    this.emitFix();
    if (this.progressM >= this.totalM) this.pause();
    else this.notify();
  }

  private emitFix(): void {
    if (!this.cb) return;
    const pos = along(this.line, this.progressM, { units: 'meters' })
      .geometry.coordinates as [number, number];

    // Heading from the local segment bearing (look behind at the route end).
    const aheadD = Math.min(this.progressM + HEADING_LOOKAHEAD_M, this.totalM);
    const headingDeg =
      aheadD > this.progressM
        ? norm(turfBearing(pos, along(this.line, aheadD, { units: 'meters' })))
        : norm(
            turfBearing(
              along(this.line, Math.max(this.progressM - HEADING_LOOKAHEAD_M, 0), {
                units: 'meters',
              }),
              pos,
            ),
          );

    const fix: PositionFix = {
      lat: pos[1],
      lon: pos[0],
      speedKmh: this.targetKmh,
      headingDeg,
      accuracyM: 5,
      timestamp: this.baseEpoch + this.simSec * 1000,
    };
    this.cb(fix);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
