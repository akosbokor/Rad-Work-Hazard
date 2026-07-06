import { useMemo, useState } from 'react';
import { RealGpsProvider } from './providers/RealGpsProvider';
import { requestGeolocationPermission } from './providers/geolocationPermission';
import { DriveScreen } from './ui/DriveScreen';

/**
 * Minimal start screen → drive screen. Start requests geolocation, then shows
 * the map regardless of grant/deny so the demo still runs. Real design lands in
 * Phase 4.
 */
export function App() {
  const [phase, setPhase] = useState<'start' | 'drive'>('start');
  const [requesting, setRequesting] = useState(false);
  const provider = useMemo(() => new RealGpsProvider(), []);

  function handleStart(): void {
    setRequesting(true);
    void requestGeolocationPermission().then(() => {
      setRequesting(false);
      setPhase('drive');
    });
  }

  if (phase === 'drive') {
    return <DriveScreen provider={provider} />;
  }

  return (
    <main className="start-screen">
      <div className="start-card">
        <h1>M1 Figyelő</h1>
        <p>Road Hazard Alert — közelségi figyelmeztetés útépítési zónákra.</p>
        <button type="button" className="start-button" onClick={handleStart} disabled={requesting}>
          {requesting ? 'Helymeghatározás…' : 'Indítás'}
        </button>
      </div>
    </main>
  );
}
