import { useEffect, useState } from 'react';
import type { AlertState } from '@m1/shared';
import { useAppStore } from '../store';
import { acknowledge } from '../alerting';
import { getLang, t } from '../i18n';

/**
 * Full-screen alert takeover. Driven by store.activeAlert + hazardStates (the
 * projected engine state), NOT raw engine events — so an admin deactivation
 * (hazard drops out of the store) clears the overlay immediately, and the
 * distance readout tracks live. Auto-clears when activeAlert becomes null
 * (which includes PASSED / IDLE, both tier 0).
 */

// Strict three-colour severity code, mapped from alert tier (amber at preWarn,
// red at slowDown and inside the zone).
const STATE_SEVERITY: Record<AlertState, 'warning' | 'danger' | null> = {
  IDLE: null,
  PASSED: null,
  APPROACHING: 'warning',
  SLOW_DOWN: 'danger',
  IN_ZONE: 'danger',
};

const TIER: Record<AlertState, number> = {
  IDLE: 0,
  PASSED: 0,
  APPROACHING: 1,
  SLOW_DOWN: 2,
  IN_ZONE: 3,
};

const HEADLINE_KEY: Record<AlertState, 'overlay.approaching' | 'overlay.slowDown' | 'overlay.inZone'> = {
  IDLE: 'overlay.approaching',
  PASSED: 'overlay.approaching',
  APPROACHING: 'overlay.approaching',
  SLOW_DOWN: 'overlay.slowDown',
  IN_ZONE: 'overlay.inZone',
};

export function AlertOverlay() {
  const activeAlert = useAppStore((s) => s.activeAlert);
  const hazardStates = useAppStore((s) => s.hazardStates);
  const hazards = useAppStore((s) => s.hazards);

  // A tap acknowledges the current tier and hides the overlay until the alert
  // either escalates to a strictly higher tier or a different hazard takes over.
  const [dismissed, setDismissed] = useState<{ hazardId: string; tier: number } | null>(null);

  useEffect(() => {
    // Reset the local dismissal once the alert clears entirely.
    if (!activeAlert) setDismissed(null);
  }, [activeAlert]);

  if (!activeAlert) return null;

  const severity = STATE_SEVERITY[activeAlert.state];
  if (!severity) return null;

  const suppressed =
    dismissed &&
    dismissed.hazardId === activeAlert.hazardId &&
    TIER[activeAlert.state] <= dismissed.tier;
  if (suppressed) return null;

  const hazard = hazards.find((h) => h.id === activeAlert.hazardId);
  const distanceM = hazardStates[activeAlert.hazardId]?.distanceM ?? null;
  const preWarn = hazard?.alertDistances.preWarn ?? 2000;
  const message = hazard ? hazard.message[getLang()] : '';
  const speedLimit = hazard?.speedLimitKmh ?? null;

  // Thin geometry line beneath the readout — shrinks as the driver closes in.
  const progress =
    distanceM == null ? 1 : Math.min(1, Math.max(0, distanceM / preWarn));

  function handleAck(): void {
    if (!activeAlert) return;
    acknowledge(activeAlert.hazardId);
    setDismissed({ hazardId: activeAlert.hazardId, tier: TIER[activeAlert.state] });
  }

  return (
    <button
      type="button"
      className={`alert-overlay sev-${severity}`}
      data-severity={severity}
      data-state={activeAlert.state}
      onClick={handleAck}
      aria-label={t('overlay.tapToAck')}
    >
      <div className="alert-headline">{t(HEADLINE_KEY[activeAlert.state])}</div>

      <div className="alert-distance">
        <span className="alert-distance-value">
          {distanceM == null ? '—' : Math.round(distanceM)}
        </span>
        <span className="alert-distance-unit">{t('unit.m')}</span>
      </div>

      <div className="alert-geometry" aria-hidden="true">
        <span className="alert-geometry-line" style={{ transform: `scaleX(${progress})` }} />
      </div>

      {message && <div className="alert-message">{message}</div>}

      {speedLimit != null && (
        <div className="alert-speed-chip">
          <span className="alert-speed-label">{t('overlay.advisedSpeed')}</span>
          <span className="alert-speed-value">{speedLimit}</span>
          <span className="alert-speed-unit">{t('unit.kmh')}</span>
        </div>
      )}

      <div className="alert-ack-hint">{t('overlay.tapToAck')}</div>
    </button>
  );
}
