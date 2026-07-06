import type { I18nKey } from './hu';

/** English fallback strings — same key set as hu.ts. */
export const en: Record<I18nKey, string> = {
  // Start screen
  'start.subtitle': 'Proximity warning for road-construction zones.',
  'start.demoMode': 'Demo mode (simulated route on the M1)',
  'start.button': 'Start',
  'start.locating': 'Locating…',
  'start.language': 'Language',

  // Hazard-type names
  'hazard.construction': 'Roadworks',
  'hazard.accident': 'Accident',
  'hazard.congestion': 'Congestion',
  'hazard.weather': 'Weather hazard',

  // Spoken alert templates
  'alert.approaching': 'Caution. {hazard} in {distance} metres.',
  'alert.slowDown': 'Slow down to {speed}. {hazard} in {distance} metres.',

  // Alert overlay
  'overlay.approaching': 'Hazard ahead',
  'overlay.slowDown': 'Slow down!',
  'overlay.inZone': 'In hazard zone',
  'overlay.advisedSpeed': 'Advised speed',
  'overlay.tapToAck': 'Tap to acknowledge',

  // Debug drawer
  'debug.title': 'Debug',
  'debug.fixes': 'Recent fixes',
  'debug.hazards': 'Hazards',
  'debug.lastSpoken': 'Last spoken',
  'debug.lastVibration': 'Last vibration',
  'debug.connection': 'Connection',
  'debug.none': '—',

  // Units
  'unit.m': 'm',
  'unit.kmh': 'km/h',
};
