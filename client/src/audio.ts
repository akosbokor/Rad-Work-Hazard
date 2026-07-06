import { useAppStore } from './store';
import { getLang } from './i18n';

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

/**
 * Voice quality ranking. Devices ship several voices per language and
 * getVoices() order is arbitrary — the first match is often a legacy
 * robot voice. Prefer modern neural/enhanced voices and known-good names;
 * penalize the macOS novelty voices that would otherwise match English.
 */
const GOOD_HINTS = ['natural', 'neural', 'premium', 'enhanced', 'siri', 'google', 'tünde', 'tunde', 'samantha'];
const NOVELTY = ['albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'good news', 'jester', 'organ', 'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox', 'grandma', 'grandpa', 'rocko', 'shelley', 'flo', 'eddy', 'reed', 'sandy', 'junior', 'ralph', 'kathy', 'fred'];

function voiceScore(v: SpeechSynthesisVoice, wanted: string): number {
  const name = v.name.toLowerCase();
  const lang = v.lang.toLowerCase();
  if (!lang.startsWith(wanted)) return -1;
  let score = 1;
  if (NOVELTY.some((n) => name.includes(n))) return 0; // last resort only
  score += 2;
  if (GOOD_HINTS.some((h) => name.includes(h))) score += 4;
  if (!v.localService) score += 1; // cloud voices (e.g. Google) are usually better
  if (v.default) score += 1;
  return score;
}

function pickVoice(wanted: 'hu' | 'en'): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const lang of wanted === 'hu' ? ['hu', 'en'] : ['en']) {
    for (const v of voices) {
      const s = voiceScore(v, lang);
      if (s > bestScore) {
        best = v;
        bestScore = s;
      }
    }
    if (best) return best; // only fall through to English if no hu voice at all
  }
  return best;
}

/** Speak text with the best available voice for the CURRENT language. */
export function speak(text: string): void {
  // Record the call first — this is the acceptance signal, independent of
  // whether a voice actually exists on this device.
  useAppStore.setState({ lastSpoken: text });
  try {
    if (!('speechSynthesis' in window)) return;
    const lang = getLang();
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(lang);
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = lang === 'hu' ? 'hu-HU' : 'en-US';
    }
    utter.rate = 1;
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
