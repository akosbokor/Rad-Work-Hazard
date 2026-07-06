import type { AlertState, Hazard, PositionFix } from '@m1/shared';
import {
  directionMatches,
  distanceToCenterlineM,
  isApproaching,
  isInsideZone,
} from './geo';

/**
 * Pure per-hazard alert state machine. No React, no DOM, no fetch, no timers;
 * time comes exclusively from fix.timestamp (NEVER Date.now) so the engine is
 * fully deterministic under test.
 *
 * Transitions (per plan §Phase 3):
 * - IDLE → APPROACHING / SLOW_DOWN: requires direction match + approaching +
 *   distance under the tier threshold on `confirmFixes` consecutive fixes.
 * - APPROACHING → SLOW_DOWN: same confirmFixes jitter guard.
 * - → IN_ZONE: immediate once inside the buffer (dist < bufferMeters).
 * - Abort-approach edge: from APPROACHING or SLOW_DOWN, when
 *   dist > preWarn + hysteresisM OR not-approaching on confirmFixes
 *   consecutive fixes → IDLE (driver diverted before the zone).
 * - IN_ZONE → PASSED when the fix leaves the buffer.
 * - PASSED → IDLE when dist > preWarn + hysteresisM.
 * - Hazard absent from setHazards (the single deactivation signal) → IDLE,
 *   event queued and delivered on the next update().
 */

export interface EngineOptions {
  confirmFixes?: number; // default 2
  cooldownMs?: number; // default 180000
  hysteresisM?: number; // default 300
}

export interface EngineEvent {
  hazardId: string;
  from: AlertState;
  to: AlertState;
  distanceM: number;
  fix: PositionFix;
}

// Alert-tier order for ack suppression: APPROACHING < SLOW_DOWN < IN_ZONE.
// IDLE and PASSED are non-alert states (tier 0) — during an ack cooldown a
// fall-back to them stays silent too (only strictly higher tiers break through).
const TIER: Record<AlertState, number> = {
  IDLE: 0,
  PASSED: 0,
  APPROACHING: 1,
  SLOW_DOWN: 2,
  IN_ZONE: 3,
};

interface Tracked {
  hazard: Hazard;
  state: AlertState;
  distanceM: number | null;
  escalateTo: AlertState | null; // pending escalation target
  escalateCount: number; // consecutive fixes agreeing on escalateTo
  notApproachingCount: number; // consecutive not-approaching fixes (abort edge)
}

function resetCounters(t: Tracked): void {
  t.escalateTo = null;
  t.escalateCount = 0;
  t.notApproachingCount = 0;
}

export class AlertEngine {
  private readonly confirmFixes: number;
  private readonly cooldownMs: number;
  private readonly hysteresisM: number;

  private tracked = new Map<string, Tracked>();
  private acks = new Map<string, { tier: number; at: number }>();
  private pending: EngineEvent[] = []; // events queued by setHazards()
  private lastFix: PositionFix | null = null;

  constructor(opts: EngineOptions = {}) {
    this.confirmFixes = opts.confirmFixes ?? 2;
    this.cooldownMs = opts.cooldownMs ?? 180_000;
    this.hysteresisM = opts.hysteresisM ?? 300;
  }

  /**
   * Replace the tracked hazard set. A hazard absent from the new list is the
   * deactivation signal: its state resets to IDLE and, if it was not IDLE,
   * an EngineEvent is queued for delivery on the next update().
   */
  setHazards(hazards: Hazard[]): void {
    const next = new Map<string, Tracked>();
    for (const hazard of hazards) {
      const existing = this.tracked.get(hazard.id);
      if (existing) {
        existing.hazard = hazard;
        next.set(hazard.id, existing);
      } else {
        next.set(hazard.id, {
          hazard,
          state: 'IDLE',
          distanceM: null,
          escalateTo: null,
          escalateCount: 0,
          notApproachingCount: 0,
        });
      }
    }
    for (const [id, t] of this.tracked) {
      if (next.has(id)) continue;
      this.acks.delete(id);
      if (t.state !== 'IDLE' && this.lastFix) {
        this.pending.push({
          hazardId: id,
          from: t.state,
          to: 'IDLE',
          distanceM: t.distanceM ?? 0,
          fix: this.lastFix,
        });
      }
    }
    this.tracked = next;
  }

  /** Advance every hazard's state machine by one fix; returns emitted events. */
  update(fix: PositionFix): EngineEvent[] {
    this.lastFix = fix;
    const events = this.pending;
    this.pending = [];
    for (const t of this.tracked.values()) this.step(t, fix, events);
    return events;
  }

  getState(hazardId: string): AlertState {
    return this.tracked.get(hazardId)?.state ?? 'IDLE';
  }

  getDistance(hazardId: string): number | null {
    return this.tracked.get(hazardId)?.distanceM ?? null;
  }

  /**
   * Record {tier: currentState, at: now} (now = last fix timestamp). For
   * cooldownMs, update() still transitions internally but suppresses emission
   * of events whose `to` tier is ≤ the acknowledged tier; a strictly higher
   * tier always emits. getState/getDistance are unaffected.
   */
  acknowledge(hazardId: string): void {
    this.acks.set(hazardId, {
      tier: TIER[this.getState(hazardId)],
      at: this.lastFix?.timestamp ?? 0,
    });
  }

  private step(t: Tracked, fix: PositionFix, out: EngineEvent[]): void {
    const dist = distanceToCenterlineM(fix, t.hazard);
    t.distanceM = dist;
    const { preWarn, slowDown } = t.hazard.alertDistances;
    const inZone = isInsideZone(dist, t.hazard);
    const dirOk = directionMatches(fix.headingDeg, t.hazard);
    const approaching = isApproaching(fix, t.hazard);
    const abortDistM = preWarn + this.hysteresisM;

    switch (t.state) {
      case 'IDLE': {
        if (!dirOk) {
          resetCounters(t);
          break;
        }
        if (inZone) {
          // Already inside the buffer (e.g. app started in the zone) — definitive.
          this.transition(t, 'IN_ZONE', dist, fix, out);
          break;
        }
        if (!approaching) {
          resetCounters(t);
          break;
        }
        const target: AlertState | null =
          dist <= slowDown ? 'SLOW_DOWN' : dist <= preWarn ? 'APPROACHING' : null;
        this.confirmEscalation(t, target, dist, fix, out);
        break;
      }

      case 'APPROACHING':
      case 'SLOW_DOWN': {
        // Abort-approach edge: receded past preWarn + hysteresis…
        if (dist > abortDistM) {
          this.transition(t, 'IDLE', dist, fix, out);
          break;
        }
        if (inZone) {
          this.transition(t, 'IN_ZONE', dist, fix, out);
          break;
        }
        // …or turned away on confirmFixes consecutive fixes.
        if (!approaching) {
          t.notApproachingCount += 1;
          if (t.notApproachingCount >= this.confirmFixes) {
            this.transition(t, 'IDLE', dist, fix, out);
            break;
          }
        } else {
          t.notApproachingCount = 0;
        }
        if (t.state === 'SLOW_DOWN' && dist > slowDown + this.hysteresisM) {
          // De-escalate with the same distance margin to avoid boundary flapping.
          this.transition(t, 'APPROACHING', dist, fix, out);
          break;
        }
        const target: AlertState | null =
          t.state === 'APPROACHING' && dist <= slowDown ? 'SLOW_DOWN' : null;
        this.confirmEscalation(t, target, dist, fix, out);
        break;
      }

      case 'IN_ZONE': {
        if (!inZone) this.transition(t, 'PASSED', dist, fix, out);
        break;
      }

      case 'PASSED': {
        if (dist > abortDistM) this.transition(t, 'IDLE', dist, fix, out);
        break;
      }
    }
  }

  /** Escalations require confirmFixes consecutive fixes agreeing on the target. */
  private confirmEscalation(
    t: Tracked,
    target: AlertState | null,
    dist: number,
    fix: PositionFix,
    out: EngineEvent[],
  ): void {
    if (!target || TIER[target] <= TIER[t.state]) {
      t.escalateTo = null;
      t.escalateCount = 0;
      return;
    }
    if (t.escalateTo === target) {
      t.escalateCount += 1;
    } else {
      t.escalateTo = target;
      t.escalateCount = 1;
    }
    if (t.escalateCount >= this.confirmFixes) this.transition(t, target, dist, fix, out);
  }

  private transition(
    t: Tracked,
    to: AlertState,
    dist: number,
    fix: PositionFix,
    out: EngineEvent[],
  ): void {
    const from = t.state;
    if (from === to) return;
    t.state = to;
    resetCounters(t);
    const event: EngineEvent = { hazardId: t.hazard.id, from, to, distanceM: dist, fix };
    if (!this.isSuppressed(event, fix)) out.push(event);
  }

  /** Edge-triggered emission filter implementing acknowledge() semantics. */
  private isSuppressed(event: EngineEvent, fix: PositionFix): boolean {
    const ack = this.acks.get(event.hazardId);
    if (!ack) return false;
    if (fix.timestamp - ack.at >= this.cooldownMs) {
      this.acks.delete(event.hazardId);
      return false;
    }
    return TIER[event.to] <= ack.tier;
  }
}
