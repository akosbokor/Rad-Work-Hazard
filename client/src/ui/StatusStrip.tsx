import { useAppStore } from '../store';

const CONNECTION_LABEL: Record<string, string> = {
  connecting: 'Kapcsolódás…',
  live: 'Élő',
  lost: 'Nincs kapcsolat',
};

/**
 * Thin top overlay: cloud connection dot, current speed (km/h) and GPS accuracy.
 * (Phase 4 formalises strings via i18n; kept terse and neutral here.)
 */
export function StatusStrip() {
  const connection = useAppStore((s) => s.connection);
  const lastFix = useAppStore((s) => s.lastFix);

  const speedKmh = lastFix?.speedKmh;
  const accuracyM = lastFix?.accuracyM;

  return (
    <div className="status-strip">
      <span className="status-item" title={CONNECTION_LABEL[connection]}>
        <span className={`conn-dot conn-${connection}`} />
        {CONNECTION_LABEL[connection]}
      </span>
      <span className="status-item">
        <strong>{speedKmh != null ? Math.round(speedKmh) : '--'}</strong> km/h
      </span>
      <span className="status-item">
        ±{accuracyM != null ? Math.round(accuracyM) : '--'} m
      </span>
    </div>
  );
}
