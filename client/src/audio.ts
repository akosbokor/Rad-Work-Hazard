import { useAppStore } from './store';

/**
 * All non-visual driver feedback: chime, speech, vibration. Browsers gate audio
 * and speech behind a user gesture, so unlockAudio() MUST run on the Start tap.
 *
 * Machine-checkable signals: every speak() writes store.lastSpoken and every
 * vibrate() writes store.lastVibration BEFORE touching the (headless-voiceless)
 * platform APIs, so acceptance can assert on the call rather than the sound.
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

/**
 * Prime audio + speech on the Start gesture: resume (or create) the
 * AudioContext and push a silent utterance so the first real speak() is not
 * swallowed by the browser's autoplay policy.
 */
export function unlockAudio(): void {
  audioContext();
  try {
    if ('speechSynthesis' in window) {
      const primer = new SpeechSynthesisUtterance('');
      primer.volume = 0;
      window.speechSynthesis.speak(primer);
      // Nudge the async voice list to populate on browsers that lazy-load it.
      window.speechSynthesis.getVoices();
    }
  } catch {
    /* speech unavailable — visual + chime still cover the alert */
  }
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

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === 'hu-HU') ??
    voices.find((v) => v.lang.toLowerCase().startsWith('hu')) ??
    voices.find((v) => v.lang.toLowerCase().startsWith('en')) ??
    null
  );
}

/** Speak text, preferring a hu-HU voice with an English fallback. */
export function speak(text: string): void {
  // Record the call first — this is the acceptance signal, independent of
  // whether a voice actually exists on this device.
  useAppStore.setState({ lastSpoken: text });
  try {
    if (!('speechSynthesis' in window)) return;
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = 'hu-HU';
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  } catch {
    /* ignore — lastSpoken already recorded */
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
