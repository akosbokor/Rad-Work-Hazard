import { useEffect, useReducer } from 'react';
import type { SimulatedProvider, SimMultiplier } from '../providers/SimulatedProvider';

const MULTIPLIERS: SimMultiplier[] = [1, 4, 16];

/**
 * Transport-control overlay for demo (sim) mode: play/pause, restart,
 * playback speed ×1/×4/×16, scrub slider. Renders provider state directly —
 * the provider notifies on every change/emitted fix.
 */
export function SimControls({ provider }: { provider: SimulatedProvider }) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => provider.onChange(bump), [provider]);

  const playing = provider.isPlaying();
  const multiplier = provider.getMultiplier();

  return (
    <div className="sim-controls" aria-label="Szimuláció vezérlés">
      <button
        type="button"
        className="sim-button"
        aria-label={playing ? 'Szünet' : 'Lejátszás'}
        onClick={() => (playing ? provider.pause() : provider.play())}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <button
        type="button"
        className="sim-button"
        aria-label="Újraindítás"
        onClick={() => provider.restart()}
      >
        ⟲
      </button>
      {MULTIPLIERS.map((m) => (
        <button
          key={m}
          type="button"
          className={`sim-button sim-speed ${multiplier === m ? 'active' : ''}`}
          onClick={() => provider.setSpeed(m)}
        >
          ×{m}
        </button>
      ))}
      <input
        type="range"
        className="sim-scrub"
        min={0}
        max={1000}
        value={Math.round(provider.getFraction() * 1000)}
        aria-label="Útvonal pozíció"
        onChange={(e) => provider.scrubTo(Number(e.target.value) / 1000)}
      />
    </div>
  );
}
