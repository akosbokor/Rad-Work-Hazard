import type { AlertState } from '@m1/shared';
import { AlertEngine } from './engine/alertEngine';
import type { EngineEvent } from './engine/alertEngine';
import { useAppStore } from './store';
import { chime, speak, vibrate } from './audio';
import { t } from './i18n';

/** Escalation vibration pattern (ms on/off/on). */
const VIBRATION_PATTERN = [300, 100, 300];

/** Round a distance to a spoken-friendly 50 m step. */
function roundDistance(distanceM: number): number {
  return Math.max(0, Math.round(distanceM / 50) * 50);
}

/**
 * On entering an alert tier (APPROACHING / SLOW_DOWN) fire the non-visual
 * feedback: chime + spoken i18n template + escalation vibration. The engine has
 * already applied ack/cooldown suppression, so an event arriving here always
 * warrants feedback. Other transitions (IN_ZONE/PASSED/IDLE) drive the visual
 * overlay only.
 */
function routeFeedback(event: EngineEvent): void {
  if (event.to !== 'APPROACHING' && event.to !== 'SLOW_DOWN') return;
  const hazard = useAppStore.getState().hazards.find((h) => h.id === event.hazardId);
  if (!hazard) return;

  const hazardName = t(`hazard.${hazard.type}`);
  const distance = roundDistance(event.distanceM);
  const text =
    event.to === 'SLOW_DOWN'
      ? t('alert.slowDown', {
          hazard: hazardName,
          distance,
          speed: hazard.speedLimitKmh ?? '',
        })
      : t('alert.approaching', { hazard: hazardName, distance });

  chime();
  speak(text);
  vibrate(VIBRATION_PATTERN);
}

/**
 * The glue between the pure AlertEngine and the rest of the app (owned by
 * Phase 3 — NOTHING else may touch the engine):
 * - feeds every provider fix (store.lastFix, written only by the active
 *   PositionProvider via pushFix) to engine.update()
 * - mirrors store hazard changes into engine.setHazards()
 * - writes hazardStates + activeAlert back into the store
 * - exposes an acknowledge() passthrough; engine events feed routeFeedback
 *   (chime/speech/vibration), the overlay is store-driven.
 */

const engine = new AlertEngine();

// Same tier order the engine uses; IDLE/PASSED are non-alert states.
const TIER: Record<AlertState, number> = {
  IDLE: 0,
  PASSED: 0,
  APPROACHING: 1,
  SLOW_DOWN: 2,
  IN_ZONE: 3,
};

/**
 * UI-facing acknowledge passthrough — the only sanctioned engine access. The
 * engine owns tier suppression; here we only mirror the ack timestamp into the
 * store (fix time when available) as a machine-checkable signal.
 */
export function acknowledge(hazardId: string): void {
  engine.acknowledge(hazardId);
  const at = useAppStore.getState().lastFix?.timestamp ?? Date.now();
  useAppStore.setState((s) => ({ acknowledged: { ...s.acknowledged, [hazardId]: at } }));
}

let started = false;

/** Wire the singleton engine to the store. Idempotent; call once at boot. */
export function initAlerting(): void {
  if (started) return;
  started = true;

  engine.setHazards(useAppStore.getState().hazards);

  useAppStore.subscribe((state, prev) => {
    if (state.hazards !== prev.hazards) {
      engine.setHazards(state.hazards);
      syncToStore();
    }
    if (state.lastFix && state.lastFix !== prev.lastFix) {
      const events = engine.update(state.lastFix);
      for (const event of events) routeFeedback(event);
      syncToStore();
    }
  });
}

/** Project engine state into the pinned store keys (only writer of these). */
function syncToStore(): void {
  const { hazards } = useAppStore.getState();
  const hazardStates: Record<string, { state: AlertState; distanceM: number | null }> = {};
  let activeAlert: { hazardId: string; state: AlertState } | null = null;

  for (const hazard of hazards) {
    const state = engine.getState(hazard.id);
    hazardStates[hazard.id] = { state, distanceM: engine.getDistance(hazard.id) };
    // activeAlert = highest-tier non-IDLE/PASSED hazard.
    if (TIER[state] > 0 && (!activeAlert || TIER[state] > TIER[activeAlert.state])) {
      activeAlert = { hazardId: hazard.id, state };
    }
  }

  useAppStore.setState({ hazardStates, activeAlert });
}
