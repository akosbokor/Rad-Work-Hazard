import type { HazardType } from '@m1/shared';
import { useAppStore } from './store';

/**
 * All non-visual driver feedback: chime, spoken alerts, vibration. Browsers
 * gate audio behind a user gesture, so unlockAudio() MUST run on the Start tap.
 *
 * Spoken alerts are pre-rendered English neural-TTS clips shipped in
 * /audio/*.mp3 (fixed phrases per tier — the banner carries the exact
 * numbers). speechSynthesis was dropped: its quality is capped by whatever
 * voices the device has installed, which is unacceptably robotic on most.
 *
 * Machine-checkable signals: every speakAlert() writes store.lastSpoken (the
 * clip transcript) and every vibrate() writes store.lastVibration BEFORE
 * touching the (headless-silent) platform APIs, so acceptance can assert on
 * the call rather than the sound.
 */

let ctx: AudioContext | null = null;

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

function audioContext(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Alert clips: fixed phrase per (tier, hazard type). Files in client/public/audio/. */
const CLIPS = {
  'approaching-construction': 'Attention! Roadworks ahead.',
  'approaching-accident': 'Attention! Accident ahead.',
  'approaching-congestion': 'Attention! Traffic jam ahead.',
  'approaching-weather': 'Attention! Severe weather ahead.',
  slowdown: 'Slow down now!',
} as const;
type ClipName = keyof typeof CLIPS;

const clipBuffers = new Map<ClipName, AudioBuffer>();

async function loadClip(audio: AudioContext, name: ClipName): Promise<void> {
  const res = await fetch(`/audio/${name}.mp3`);
  if (!res.ok) return;
  clipBuffers.set(name, await audio.decodeAudioData(await res.arrayBuffer()));
}

/**
 * Prime audio on the Start gesture: resume (or create) the AudioContext so
 * later playback isn't swallowed by the autoplay policy, and pre-decode the
 * alert clips so the first alert plays with zero delay.
 */
export function unlockAudio(): void {
  const audio = audioContext();
  if (!audio) return;
  for (const name of Object.keys(CLIPS) as ClipName[]) {
    void loadClip(audio, name).catch(() => {
      /* missing clip — visual + chime still cover the alert */
    });
  }
}

function playClip(name: ClipName): void {
  // Record the transcript first — this is the acceptance signal, independent
  // of whether audio actually plays on this device.
  useAppStore.setState({ lastSpoken: CLIPS[name] });
  const audio = audioContext();
  const buffer = clipBuffers.get(name);
  if (!audio || !buffer) return;
  try {
    const src = audio.createBufferSource();
    src.buffer = buffer;
    src.connect(audio.destination);
    // Give the chime a beat to finish before the voice starts.
    src.start(audio.currentTime + 0.45);
  } catch {
    /* ignore — lastSpoken already recorded */
  }
}

/** Speak the alert for a tier escalation using the pre-rendered clips. */
export function speakAlert(tier: 'APPROACHING' | 'SLOW_DOWN', hazardType: HazardType): void {
  playClip(tier === 'SLOW_DOWN' ? 'slowdown' : (`approaching-${hazardType}` as ClipName));
}

/** Short two-tone rising chime via a single oscillator + gain envelope. */
export function chime(): void {
  const audio = audioContext();
  if (!audio) return;
  try {
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1320, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.42);
  } catch {
    /* ignore — a failed chime must never break the alert flow */
  }
}

/** Vibrate with the given pattern, guarded by a feature check. */
export function vibrate(pattern: number[]): void {
  useAppStore.setState({ lastVibration: pattern });
  try {
    if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    /* ignore — lastVibration already recorded */
  }
}
