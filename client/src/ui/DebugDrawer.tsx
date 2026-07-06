import { useState } from 'react';
import { useAppStore } from '../store';
import { t } from '../i18n';

/**
 * Collapsible plain-text debug panel: last 5 fixes, per-hazard state + distance,
 * lastSpoken, lastVibration, connection. Deliberately unstyled beyond the
 * instrument palette — it exists to make the demo explainable, not pretty.
 */
export function DebugDrawer() {
  const [open, setOpen] = useState(false);
  const fixHistory = useAppStore((s) => s.fixHistory);
  const hazardStates = useAppStore((s) => s.hazardStates);
  const lastSpoken = useAppStore((s) => s.lastSpoken);
  const lastVibration = useAppStore((s) => s.lastVibration);
  const connection = useAppStore((s) => s.connection);

  const recentFixes = fixHistory.slice(-5).reverse();
  const none = t('debug.none');

  return (
    <div className={`debug-drawer ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="debug-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {t('debug.title')} {open ? '▾' : '▸'}
      </button>

      {open && (
        <div className="debug-body">
          <div className="debug-section">
            <div className="debug-label">
              {t('debug.connection')}: <span>{connection}</span>
            </div>
            <div className="debug-label">
              {t('debug.lastSpoken')}: <span>{lastSpoken ?? none}</span>
            </div>
            <div className="debug-label">
              {t('debug.lastVibration')}:{' '}
              <span>{lastVibration ? `[${lastVibration.join(', ')}]` : none}</span>
            </div>
          </div>

          <div className="debug-section">
            <div className="debug-heading">{t('debug.hazards')}</div>
            {Object.keys(hazardStates).length === 0 && <div className="debug-row">{none}</div>}
            {Object.entries(hazardStates).map(([id, hs]) => (
              <div className="debug-row" key={id}>
                {id}: {hs.state}{' '}
                {hs.distanceM != null ? `· ${Math.round(hs.distanceM)} m` : ''}
              </div>
            ))}
          </div>

          <div className="debug-section">
            <div className="debug-heading">{t('debug.fixes')}</div>
            {recentFixes.length === 0 && <div className="debug-row">{none}</div>}
            {recentFixes.map((f, i) => (
              <div className="debug-row" key={`${f.timestamp}-${i}`}>
                {f.lat.toFixed(5)}, {f.lon.toFixed(5)} · {f.speedKmh != null ? Math.round(f.speedKmh) : '--'} km/h ·{' '}
                {f.headingDeg != null ? `${Math.round(f.headingDeg)}°` : '--'} · ±{Math.round(f.accuracyM)} m
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
