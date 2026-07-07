import type { I18nKey } from './hu';

/** English fallback strings — same key set as hu.ts. */
export const en: Record<I18nKey, string> = {
  // Start screen
  'start.subtitle': 'Proximity warning for road-construction zones.',
  'start.demoMode': 'Demo mode (simulated route on the M1)',
  'start.button': 'Start',
  'start.locating': 'Locating…',
  'start.language': 'Language',
  'start.qrCaption': 'Scan to join on your phone',

  // Hazard-type names
  'hazard.construction': 'Roadworks',
  'hazard.accident': 'Accident',
  'hazard.congestion': 'Congestion',
  'hazard.weather': 'Weather hazard',

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

  // Drive screen + simulation controls
  'drive.followOn': 'Follow: on',
  'drive.followOff': 'Follow: off',
  'sim.controls': 'Simulation controls',
  'sim.play': 'Play',
  'sim.pause': 'Pause',
  'sim.restart': 'Restart',
  'sim.scrub': 'Route position',

  // Units
  'unit.m': 'm',
  'unit.kmh': 'km/h',
};
