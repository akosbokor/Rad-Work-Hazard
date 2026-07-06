/**
 * Hungarian (primary) UI + spoken-alert strings. Flat key→string map.
 * Templates use {placeholder} tokens filled by the t() helper (see index.ts):
 *   {hazard}   — a hazard-type name (see hazard.* keys)
 *   {distance} — rounded distance in metres
 *   {speed}    — advised speed limit in km/h
 */
export const hu = {
  // Start screen
  'start.subtitle': 'Közelségi figyelmeztetés útépítési zónákra.',
  'start.demoMode': 'Demó mód (szimulált útvonal az M1-en)',
  'start.button': 'Indítás',
  'start.locating': 'Helymeghatározás…',
  'start.language': 'Nyelv',

  // Hazard-type names (used inside spoken templates and the overlay)
  'hazard.construction': 'Útépítés',
  'hazard.accident': 'Baleset',
  'hazard.congestion': 'Torlódás',
  'hazard.weather': 'Időjárási veszély',

  // Spoken alert templates (distance/speed placeholders)
  'alert.approaching': 'Figyelem. {hazard} {distance} méterre.',
  'alert.slowDown': 'Lassítson {speed}-ra. {hazard} {distance} méterre.',

  // Alert overlay
  'overlay.approaching': 'Veszély előttünk',
  'overlay.slowDown': 'Lassítson!',
  'overlay.inZone': 'Veszélyzónában',
  'overlay.advisedSpeed': 'Ajánlott sebesség',
  'overlay.tapToAck': 'Érintse meg a nyugtázáshoz',

  // Debug drawer
  'debug.title': 'Debug',
  'debug.fixes': 'Utolsó pozíciók',
  'debug.hazards': 'Zónák',
  'debug.lastSpoken': 'Kimondva',
  'debug.lastVibration': 'Rezgés',
  'debug.connection': 'Kapcsolat',
  'debug.none': '—',

  // Units
  'unit.m': 'm',
  'unit.kmh': 'km/h',
} as const;

export type I18nKey = keyof typeof hu;
