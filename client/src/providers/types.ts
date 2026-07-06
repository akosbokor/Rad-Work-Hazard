import type { PositionFix } from '@m1/shared';

export type FixCallback = (fix: PositionFix) => void;

/**
 * Position data enters the app ONLY through a PositionProvider (real GPS or a
 * simulated route). Providers may use timers/turf — they are the boundary; the
 * pure engine (Phase 3) never touches them directly.
 */
export interface PositionProvider {
  start(cb: FixCallback): void;
  stop(): void;
}
