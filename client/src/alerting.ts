import type { AlertState } from '@m1/shared';
import { AlertEngine } from './engine/alertEngine';
import type { EngineEvent } from './engine/alertEngine';
import { useAppStore } from './store';

/**
 * The glue between the pure AlertEngine and the rest of the app (owned by
 * Phase 3 — NOTHING else may touch the engine):
 * - feeds every provider fix (store.lastFix, written only by the active
 *   PositionProvider via pushFix) to engine.update()
 * - mirrors store hazard changes into engine.setHazards()
 * - writes hazardStates + activeAlert back into the store
 * - exposes an acknowledge() passthrough and an engine-event subscription
 *   (Phase 4 routes events → overlay/audio/vibration).
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

type EngineEventListener = (event: EngineEvent) => void;
const listeners = new Set<EngineEventListener>();

/** Subscribe to edge-triggered engine events (Phase 4: overlay/audio). */
export function onEngineEvent(listener: EngineEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** UI-facing acknowledge passthrough — the only sanctioned engine access. */
export function acknowledge(hazardId: string): void {
  engine.acknowledge(hazardId);
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
      for (const event of events) {
        for (const listener of listeners) listener(event);
      }
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
