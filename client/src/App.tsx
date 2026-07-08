import { useState } from 'react';
import { RealGpsProvider } from './providers/RealGpsProvider';
import { SimulatedProvider } from './providers/SimulatedProvider';
import { ROUTE_TOWARD_GYOR } from './providers/routes';
import { requestGeolocationPermission } from './providers/geolocationPermission';
import type { PositionProvider } from './providers/types';
import { DriveScreen } from './ui/DriveScreen';
import { QrJoin } from './ui/QrJoin';
import { useAppStore } from './store';
import { unlockAudio } from './audio';
import { requestNotificationPermission } from './notify';
import { getLang, setLang, t, type Lang } from './i18n';

const SIM_SPEED_KMH = 110;

/**
 * Start screen → drive screen. The demo-mode toggle picks the position
 * provider (real GPS or simulated M1 route); the HU/EN toggle sets the i18n
 * language. The Start tap is the required user gesture: it unlocks audio +
 * speech before entering the drive screen.
 */
export function App() {
  const [phase, setPhase] = useState<'start' | 'drive'>('start');
  const [requesting, setRequesting] = useState(false);
  const [provider, setProvider] = useState<PositionProvider | null>(null);
  const [lang, setLangState] = useState<Lang>(getLang());
  const providerMode = useAppStore((s) => s.providerMode);
  const setProviderMode = useAppStore((s) => s.setProviderMode);

  function changeLang(next: Lang): void {
    setLang(next);
    setLangState(next);
  }

  function handleStart(): void {
    // Must run inside the Start gesture to satisfy autoplay/speech policies.
    unlockAudio();
    requestNotificationPermission();
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
      <QrJoin />
      <div className="start-card">
        <h1>M1 Figyelő</h1>
        <p>{t('start.subtitle')}</p>

        <div className="lang-toggle" role="group" aria-label={t('start.language')}>
          {(['hu', 'en'] as Lang[]).map((l) => (
            <button
              key={l}
              type="button"
              className={`lang-button ${lang === l ? 'active' : ''}`}
              onClick={() => changeLang(l)}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        <label className="mode-toggle">
          <input
            type="checkbox"
            checked={providerMode === 'sim'}
            onChange={(e) => setProviderMode(e.target.checked ? 'sim' : 'gps')}
          />
          <span>{t('start.demoMode')}</span>
        </label>
        <button type="button" className="start-button" onClick={handleStart} disabled={requesting}>
          {requesting ? t('start.locating') : t('start.button')}
        </button>
      </div>
    </main>
  );
}
