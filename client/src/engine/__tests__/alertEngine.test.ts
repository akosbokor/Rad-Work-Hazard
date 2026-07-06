import { describe, expect, it } from 'vitest';
import type { PositionFix } from '@m1/shared';
import { AlertEngine } from '../alertEngine';
import type { EngineEvent } from '../alertEngine';
import {
  BACK_BEARING,
  M1_HAZARD,
  buildApproachRoute,
  buildOppositeRoute,
  fixAt,
  fixesAlong,
  stationaryFixes,
} from './fixtures';

const ID = M1_HAZARD.id;

function makeEngine(): AlertEngine {
  const engine = new AlertEngine();
  engine.setHazards([M1_HAZARD]);
  return engine;
}

function transitions(events: EngineEvent[]): string[] {
  return events.map((e) => `${e.from}→${e.to}`);
}

function feedAll(engine: AlertEngine, fixes: PositionFix[]): EngineEvent[] {
  const events: EngineEvent[] = [];
  for (const fix of fixes) events.push(...engine.update(fix));
  return events;
}

describe('AlertEngine', () => {
  // Scenario 1
  it('normal pass-through Budapest→Győr @110 km/h runs IDLE→APPROACHING→SLOW_DOWN→IN_ZONE→PASSED', () => {
    const engine = makeEngine();
    const events = feedAll(engine, fixesAlong(buildApproachRoute(), 110));

    expect(transitions(events)).toEqual([
      'IDLE→APPROACHING',
      'APPROACHING→SLOW_DOWN',
      'SLOW_DOWN→IN_ZONE',
      'IN_ZONE→PASSED',
    ]);
    // APPROACHING fires between 2000 m and 1800 m.
    expect(events[0].distanceM).toBeLessThanOrEqual(2000);
    expect(events[0].distanceM).toBeGreaterThanOrEqual(1800);
    // SLOW_DOWN fires at ≤ 800 m.
    expect(events[1].distanceM).toBeLessThanOrEqual(800);
    expect(engine.getState(ID)).toBe('PASSED');
  });

  // Scenario 2
  it('opposite carriageway (reversed route, heading ~180° off) stays IDLE throughout', () => {
    const engine = makeEngine();
    for (const fix of fixesAlong(buildOppositeRoute(), 110)) {
      expect(engine.update(fix)).toEqual([]);
      expect(engine.getState(ID)).toBe('IDLE');
    }
  });

  // Scenario 3
  it('stop-and-go inside the zone (speed 0, heading null) stays IN_ZONE without flapping', () => {
    const engine = makeEngine();
    let lastFix: PositionFix | null = null;
    for (const fix of fixesAlong(buildApproachRoute(), 110)) {
      engine.update(fix);
      lastFix = fix;
      if (engine.getState(ID) === 'IN_ZONE') break;
    }
    expect(engine.getState(ID)).toBe('IN_ZONE');
    expect(lastFix).not.toBeNull();

    for (const fix of stationaryFixes(lastFix as PositionFix, 30)) {
      expect(engine.update(fix)).toEqual([]);
      expect(engine.getState(ID)).toBe('IN_ZONE');
    }
  });

  // Scenario 4
  it('GPS jitter across the preWarn boundary never escalates until 2 consecutive fixes agree', () => {
    const engine = makeEngine();
    // Alternating ±30 m across the 2000 m preWarn line — never 2 agreeing fixes.
    const jitterDists = [2030, 1970, 2030, 1970, 2030];
    jitterDists.forEach((d, i) => {
      expect(engine.update(fixAt(d, { t: i }))).toEqual([]);
      expect(engine.getState(ID)).toBe('IDLE');
    });

    // First agreeing fix: still no escalation (confirmFixes = 2).
    expect(engine.update(fixAt(1970, { t: 5 }))).toEqual([]);
    expect(engine.getState(ID)).toBe('IDLE');

    // Second consecutive agreeing fix: exactly one escalation, no flapping.
    const events = engine.update(fixAt(1950, { t: 6 }));
    expect(transitions(events)).toEqual(['IDLE→APPROACHING']);
  });

  // Scenario 5
  it('hazard removed via setHazards mid-APPROACHING resets to IDLE and emits the event', () => {
    const engine = makeEngine();
    const approach = feedAll(engine, [
      fixAt(2100, { t: 0 }),
      fixAt(1990, { t: 1 }),
      fixAt(1960, { t: 2 }),
    ]);
    expect(transitions(approach)).toEqual(['IDLE→APPROACHING']);

    engine.setHazards([]); // deactivation signal: hazard absent
    expect(engine.getState(ID)).toBe('IDLE');
    expect(engine.getDistance(ID)).toBeNull();

    // The reset event is delivered on the next update() (setHazards is void).
    const events = engine.update(fixAt(1930, { t: 3 }));
    expect(transitions(events)).toEqual(['APPROACHING→IDLE']);
    expect(events[0].hazardId).toBe(ID);
  });

  // Scenario 6
  it('abort approach: turning away and receding past preWarn + hysteresis returns to IDLE', () => {
    const engine = makeEngine();
    const events = feedAll(engine, [
      fixAt(2100, { t: 0 }),
      fixAt(1990, { t: 1 }),
      fixAt(1960, { t: 2 }),
      // Driver diverts: heading now points away from the zone and recedes.
      fixAt(2000, { t: 3, headingDeg: BACK_BEARING }),
      fixAt(2100, { t: 4, headingDeg: BACK_BEARING }),
      fixAt(2250, { t: 5, headingDeg: BACK_BEARING }),
      fixAt(2400, { t: 6, headingDeg: BACK_BEARING }),
    ]);
    expect(transitions(events)).toEqual(['IDLE→APPROACHING', 'APPROACHING→IDLE']);
    expect(engine.getState(ID)).toBe('IDLE');
    // No SLOW_DOWN, no PASSED anywhere.
    expect(events.some((e) => e.to === 'SLOW_DOWN' || e.to === 'PASSED')).toBe(false);
  });

  // Scenario 7
  it('acknowledge suppresses re-alerts at ≤ tier during cooldown; escalation and expiry emit', () => {
    const engine = makeEngine();

    // Enter APPROACHING (event emitted), then acknowledge it.
    const approach = feedAll(engine, [
      fixAt(2100, { t: 0 }),
      fixAt(1990, { t: 1 }),
      fixAt(1960, { t: 2 }),
    ]);
    expect(transitions(approach)).toEqual(['IDLE→APPROACHING']);
    engine.acknowledge(ID);

    // Recede to IDLE — internal transition, emission suppressed by the ack.
    expect(engine.update(fixAt(2000, { t: 3, headingDeg: BACK_BEARING }))).toEqual([]);
    expect(engine.update(fixAt(2050, { t: 4, headingDeg: BACK_BEARING }))).toEqual([]);
    expect(engine.getState(ID)).toBe('IDLE');

    // Re-approach within cooldownMs: transitions internally, but no APPROACHING event.
    expect(engine.update(fixAt(1990, { t: 5 }))).toEqual([]);
    expect(engine.update(fixAt(1960, { t: 6 }))).toEqual([]);
    expect(engine.getState(ID)).toBe('APPROACHING');

    // Escalation to a strictly higher tier overrides the ack: event EMITTED.
    expect(engine.update(fixAt(790, { t: 7 }))).toEqual([]);
    const escalation = engine.update(fixAt(760, { t: 8 }));
    expect(transitions(escalation)).toEqual(['APPROACHING→SLOW_DOWN']);

    // Recede again (still inside cooldown → the fall-back stays silent).
    expect(engine.update(fixAt(2400, { t: 9, headingDeg: BACK_BEARING }))).toEqual([]);
    expect(engine.getState(ID)).toBe('IDLE');

    // After cooldownMs (180 s) expires, a fresh APPROACHING emits again.
    expect(engine.update(fixAt(1990, { t: 200 }))).toEqual([]);
    const fresh = engine.update(fixAt(1960, { t: 201 }));
    expect(transitions(fresh)).toEqual(['IDLE→APPROACHING']);
  });
});
