import { create } from 'zustand';
import type { AlertState, Hazard, HazardStreamEvent, PositionFix } from '@m1/shared';

const FIX_HISTORY_CAP = 100;

/**
 * Pinned AppStore shape (see plan §Phase 2). Phase 2 owns the first group; the
 * Phase 3/4 keys are declared now with inert defaults so the shape is stable
 * across phases (Phase 3's alerting.ts writes hazardStates/activeAlert; Phase 4
 * writes lastSpoken/lastVibration/acknowledged).
 */
export interface AppState {
  // Phase 2
  lastFix: PositionFix | null;
  fixHistory: PositionFix[]; // capped at 100, newest last
  hazards: Hazard[]; // ACTIVE-ONLY invariant (see conventions)
  connection: 'connecting' | 'live' | 'lost';
  providerMode: 'gps' | 'sim';
  // Phase 3 (written only by alerting.ts) — inert defaults for now
  hazardStates: Record<string, { state: AlertState; distanceM: number | null }>;
  activeAlert: { hazardId: string; state: AlertState } | null;
  // Phase 4 — inert defaults for now
  lastSpoken: string | null;
  lastVibration: number[] | null;
  acknowledged: Record<string, number>;
}

export interface AppActions {
  /** Append a fix (newest last, history capped) and set lastFix. */
  pushFix: (fix: PositionFix) => void;
  /** Replace the hazard list from a radius fetch — enforces active-only. */
  setHazards: (hazards: Hazard[]) => void;
  /** Apply an SSE event, maintaining the active-only invariant. */
  applyStreamEvent: (event: HazardStreamEvent) => void;
  setConnection: (connection: AppState['connection']) => void;
  setProviderMode: (mode: AppState['providerMode']) => void;
}

export type AppStore = AppState & AppActions;

const initialState: AppState = {
  lastFix: null,
  fixHistory: [],
  hazards: [],
  connection: 'connecting',
  providerMode: 'gps',
  hazardStates: {},
  activeAlert: null,
  lastSpoken: null,
  lastVibration: null,
  acknowledged: {},
};

/** Upsert an active hazard; a non-active one is removed (active-only invariant). */
function upsertHazard(list: Hazard[], hazard: Hazard): Hazard[] {
  const without = list.filter((h) => h.id !== hazard.id);
  return hazard.active ? [...without, hazard] : without;
}

export const useAppStore = create<AppStore>((set) => ({
  ...initialState,

  pushFix: (fix) =>
    set((state) => {
      const history = [...state.fixHistory, fix];
      if (history.length > FIX_HISTORY_CAP) history.splice(0, history.length - FIX_HISTORY_CAP);
      return { lastFix: fix, fixHistory: history };
    }),

  setHazards: (hazards) => set({ hazards: hazards.filter((h) => h.active) }),

  applyStreamEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case 'hazard_created':
        case 'hazard_updated':
          return { hazards: upsertHazard(state.hazards, event.hazard) };
        case 'hazard_deleted':
          return { hazards: state.hazards.filter((h) => h.id !== event.hazardId) };
        default:
          return {};
      }
    }),

  setConnection: (connection) => set({ connection }),
  setProviderMode: (providerMode) => set({ providerMode }),
}));

// Dev-only: expose the store for machine-checkable acceptance (page.evaluate on
// window.__store) per the plan. Guarded so it never ships in production builds.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __store: typeof useAppStore }).__store = useAppStore;
}
