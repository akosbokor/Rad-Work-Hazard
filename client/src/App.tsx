import { useState } from 'react';
import { RealGpsProvider } from './providers/RealGpsProvider';
import { SimulatedProvider } from './providers/SimulatedProvider';
import { ROUTE_TOWARD_GYOR } from './providers/routes';
import { requestGeolocationPermission } from './providers/geolocationPermission';
import type { PositionProvider } from './providers/types';
import { DriveScreen } from './ui/DriveScreen';
import { useAppStore } from './store';

const SIM_SPEED_KMH = 110;

/**
 * Start screen → drive screen. The demo-mode toggle picks the position
 * provider: real GPS (permission requested on Start) or simulated route
 * playback along the M1 demo route. Real design lands in Phase 4.
 */
export function App() {
  const [phase, setPhase] = useState<'start' | 'drive'>('start');
  const [requesting, setRequesting] = useState(false);
  const [provider, setProvider] = useState<PositionProvider | null>(null);
  const providerMode = useAppStore((s) => s.providerMode);
  const setProviderMode = useAppStore((s) => s.setProviderMode);

  function handleStart(): void {
    if (providerMode === 'sim') {
      setProvider(new SimulatedProvider(ROUTE_TOWARD_GYOR, SIM_SPEED_KMH));
      setPhase('drive');
      return;
    }
    setRequesting(true);
    void requestGeolocationPermission().then(() => {
      setRequesting(false);
      setProvider(new RealGpsProvider());
      setPhase('drive');
    });
  }

  if (phase === 'drive' && provider) {
    return <DriveScreen provider={provider} />;
  }

  return (
    <main className="start-screen">
      <div className="start-card">
        <h1>M1 Figyelő</h1>
        <p>Road Hazard Alert — közelségi figyelmeztetés útépítési zónákra.</p>
        <label className="mode-toggle">
          <input
            type="checkbox"
            checked={providerMode === 'sim'}
            onChange={(e) => setProviderMode(e.target.checked ? 'sim' : 'gps')}
          />
          <span>Demó mód (szimulált útvonal az M1-en)</span>
        </label>
        <button type="button" className="start-button" onClick={handleStart} disabled={requesting}>
          {requesting ? 'Helymeghatározás…' : 'Indítás'}
        </button>
      </div>
    </main>
  );
}
