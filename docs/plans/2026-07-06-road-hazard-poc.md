# M1 Figyelő — Road Hazard Alert POC Implementation Plan (v2, detailed)

> **For Claude:** Execute task-by-task with subagents. Each phase ends runnable, verified, and committed. Simpler tasks → opus-model agents; the alert engine (Phase 3) → fable. Every phase is reviewed by an independent review agent before moving on.

**Goal:** A phone-browser web app that detects proximity to a hazardous road segment (M1 construction zone), fetches live hazard data from a mock cloud API, and warns the driver in time — fully demonstrable at a desk via simulation.

**Architecture:** npm-workspaces monorepo (`shared/`, `server/`, `client/`). Pure TypeScript alert engine (state machine, no browser APIs) fed by a PositionProvider abstraction (real GPS or simulated route playback). Express mock cloud with GeoJSON hazards, radius query, SSE live updates, and a vanilla-JS admin panel. React + Leaflet UI renders engine output.

**Tech Stack (PINNED — do not deviate):**
- Node ≥ 20 (dev machine has v25.2.1), npm workspaces
- `typescript@~5.7`, `vite@^6`, `react@^19`, `react-dom@^19`
- `leaflet@^1.9`, `react-leaflet@^5` (v5 requires React 19 — matched)
- `@turf/turf@^7`
- `express@^4.21` (NOT v5), `cors@^2`
- `vitest@^3`, `zustand@^5`, `tsx@^4` (server dev runner), `concurrently@^9`
- No database, no CSS framework (hand-written CSS per design brief §5.5 of v1 plan)

**Global conventions (put in CLAUDE.md, enforce in review):**
- GeoJSON is `[lon, lat]`; `PositionFix` is `{lat, lon}` — convert only at boundaries, never mix.
- Geolocation API `speed` is **m/s** → convert to km/h in the provider. Distances meters, speeds km/h, bearings 0–360°.
- **Turf defaults to KILOMETERS.** Every `distance`, `nearestPointOnLine`, `buffer`, `along`, `length` call MUST pass `{ units: 'meters' }` (and read `properties.dist` accordingly). A missing units option makes values 1000× too small — silent logic catastrophe.
- **Active-only invariant:** the client store holds only `active: true` hazards. Filter on radius fetch AND on every SSE event (an `hazard_updated` with `active:false` removes it from the store). The engine therefore treats "hazard absent from `setHazards`" as the single deactivation signal → state resets to IDLE. The engine never inspects `.active`.
- `tsconfig.base.json` MUST set `"moduleResolution": "bundler"` and ALL three workspaces inherit it — `node`/`node10` resolution cannot see the `exports`-only shared package and typecheck breaks.
- `validFrom`/`validUntil` exist in the type for forward-compat only; NO POC code consults them (only `active` gates).
- The drawn zone polygon (turf `buffer`) is presentation-only; the engine's `distance < bufferMeters` point-to-line test is the source of truth. They may disagree slightly at corners/ends — do not assert pixel agreement.
- Terminology: `confirmFixes` = consecutive-fix jitter guard on escalation; `hysteresisM` = distance margin for falling back to IDLE. (v1 called the former "hysteresis" — different knob.)
- `client/src/engine/` is pure TS: no React, no DOM, no fetch, no timers.
- Position data enters ONLY through a `PositionProvider`.
- All client↔server payloads typed from `shared/`.
- UI strings only via `client/src/i18n/` (hu primary, en fallback).

**Ports:** server `8080`, client `5173`, Vite proxy `/api` → `http://localhost:8080` (with `changeOrigin: true`; SSE passes through fine in dev).

---

## Phase 0 — Scaffold  *(agent: opus)*

**Files:** root `package.json` (workspaces: `shared`, `server`, `client`), `tsconfig.base.json` (**`"moduleResolution": "bundler"`**, strict, ES2022 target), `shared/package.json` + `shared/src/index.ts` (exports types below), `server/package.json` + `server/src/index.ts` (Express + `/health`), `client/` written **by hand** (do NOT run `npm create vite@latest` — it would scaffold whatever Vite is current and ignore the pins): `client/package.json` with `vite@^6`, `@vitejs/plugin-react@^4`, `vitest@^3` explicitly, plus `index.html`, `src/main.tsx`, `src/App.tsx`, `client/vite.config.ts` (proxy + `server.host: true`), `.gitignore`, `CLAUDE.md` (§8 of v1 plan + ALL global conventions above), `README.md` stub. Verify `npm ls vite` shows a single 6.x before acceptance.

**Shared types — complete code for `shared/src/index.ts`:**

```ts
export type HazardType = 'construction' | 'accident' | 'congestion' | 'weather';
export type Severity = 'info' | 'warning' | 'danger';

export interface Hazard {
  id: string;
  type: HazardType;
  severity: Severity;
  active: boolean;
  geometry: { type: 'LineString'; coordinates: [number, number][] }; // [lon, lat]!
  bufferMeters: number;
  direction: { bearingDeg: number; toleranceDeg: number; bothWays: boolean };
  alertDistances: { preWarn: number; slowDown: number }; // meters
  speedLimitKmh?: number;
  message: { hu: string; en: string };
  validFrom?: string;
  validUntil?: string;
}

export interface PositionFix {
  lat: number;
  lon: number;
  speedKmh: number | null;
  headingDeg: number | null;
  accuracyM: number;
  timestamp: number;
}

export type AlertState = 'IDLE' | 'APPROACHING' | 'SLOW_DOWN' | 'IN_ZONE' | 'PASSED';

export type HazardStreamEvent =
  | { type: 'hazard_created' | 'hazard_updated'; hazard: Hazard }
  | { type: 'hazard_deleted'; hazardId: string };
```

`shared/package.json`: `{ "name": "@m1/shared", "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } } }` — both client and server consume TS source directly (works because every workspace uses `moduleResolution: bundler` and the server runs under tsx); no build step for shared.

**Root scripts:** `dev` (concurrently server `tsx watch` + client `vite`), `test` (`npm -w client run test`), `typecheck` (tsc `--noEmit` in all three workspaces).

**Acceptance (orchestrator verifies):** `npm run dev` boots both; `curl localhost:8080/health` → `{"ok":true}`; client imports a type from `@m1/shared` and typechecks; `git log` shows initial commit.

---

## Phase 1 — Mock cloud  *(agent: opus)*

**Files:** `server/src/store.ts` (in-memory store seeded from `server/data/hazards.json`, CRUD + `findNear(lat, lon, radiusM)` using turf `nearestPointOnLine`/`distance` against each hazard's centerline minus its buffer), `server/src/sse.ts` (client set, broadcast, 25 s keep-alive comment), `server/src/index.ts` routes, `server/data/hazards.json`, `server/public/admin/index.html` (+ inline JS/CSS).

**Routes (exact):**
```
GET   /api/v1/hazards                    → { hazards: Hazard[] }  (all, incl. inactive — ADMIN PANEL ONLY; the app client must never call this)
GET   /api/v1/hazards?lat&lon&radius     → active hazards whose zone (centerline distance − bufferMeters) ≤ radius — the ONLY list endpoint the app client uses
GET   /api/v1/hazards/:id                → Hazard | 404
POST  /api/v1/hazards                    → create (validate minimal shape, generate id)
PATCH /api/v1/hazards/:id                → shallow-merge update
DELETE /api/v1/hazards/:id
GET   /api/v1/stream                     → SSE, emits HazardStreamEvent JSON; broadcast on every mutation
GET   /health                            → { ok: true }
```
`?persist=true` on mutations writes the store back to `hazards.json`. CORS: allow all origins (POC).

**Seed data:** 2 hazards. (1) `m1-construction`: centerline of ~10 points tracing the M1 corridor between approx. Concó rest area (47.626, 18.155) and Tata (47.652, 18.316) — approximate coordinates along the motorway are FINE; the demo simulation derives its route from these same points, so real-world tracing precision is irrelevant. `bearingDeg` ≈ heading Budapest→Győr along that stretch (~250–260), `toleranceDeg: 60`, `bothWays: false`, buffer 60 m, preWarn 2000, slowDown 800, limit 80, hu/en messages. (2) `local-test`: short 3-point line in central Budapest (walkable), `bothWays: true`, buffer 40 m, preWarn 300, slowDown 120 — README explains how to move it to the user's street.

**Admin panel** (`/admin`, plain HTML + Leaflet from CDN): map listing existing hazards (click to select), draw-new-centerline by clicking points, form for type/severity/buffer/message/active, buttons Create / Toggle active / Delete calling the API. Functional over pretty; ~250 lines.

**Acceptance:** `curl "localhost:8080/api/v1/hazards?lat=47.64&lon=18.25&radius=5000"` returns the M1 hazard; with far-away coords returns `[]`; `curl -N localhost:8080/api/v1/stream` shows a `hazard_updated` event when a concurrent `PATCH {active:false}` runs; admin page loads and toggles. Commit.

---

## Phase 2 — Map client  *(agent: opus)*

**Files:** `client/src/api/client.ts` (fetch hazards by radius; `subscribeToStream(onEvent)` via `EventSource` with auto-reconnect), `client/src/providers/types.ts` (`PositionProvider` interface: `start(cb)`, `stop()`), `client/src/providers/RealGpsProvider.ts` (`watchPosition`, `enableHighAccuracy: true, maximumAge: 1000, timeout: 10000`; m/s→km/h; heading/speed fallback derived from last two fixes when null; drop fixes with `accuracy > 100`), `client/src/store.ts` (zustand — see pinned shape below), `client/src/ui/DriveScreen.tsx` (react-leaflet map: OSM tiles, car marker, hazard zones as turf `buffer` polygons colored by severity, auto-pan follow mode), `client/src/ui/StatusStrip.tsx` (GPS accuracy, speed, cloud connection dot), `client/src/App.tsx` (start screen → drive screen; start button requests geolocation).

**Car marker rotation:** Leaflet markers cannot rotate natively. Use `L.divIcon` containing an inline SVG arrow and set CSS `transform: rotate(<headingDeg>deg)` on the inner element — no plugin. Add `@types/leaflet` as a dev dep.

**Pinned store shape (phases 2–4 all read/write exactly these keys; Phase 2 creates the first group, Phase 3 adds the second, Phase 4 the third):**
```ts
interface AppStore {
  // Phase 2
  lastFix: PositionFix | null;
  fixHistory: PositionFix[];                 // capped at 100, newest last
  hazards: Hazard[];                         // ACTIVE-ONLY invariant (see conventions)
  connection: 'connecting' | 'live' | 'lost';
  providerMode: 'gps' | 'sim';
  // Phase 3 (written only by alerting.ts)
  hazardStates: Record<string, { state: AlertState; distanceM: number | null }>;
  activeAlert: { hazardId: string; state: AlertState } | null;  // highest-tier non-IDLE/PASSED
  // Phase 4
  lastSpoken: string | null;                 // debug-observable audio signal
  lastVibration: number[] | null;
  acknowledged: Record<string, number>;      // hazardId → ack timestamp
}
```

Hazards refetch around current position every 30 s or 2 km moved; SSE events update/insert/remove in the store live (respecting the active-only invariant).

**Acceptance:** `npm run dev`, open `localhost:5173`, grant location → map shows your marker and the local-test zone polygon; toggling the hazard in the admin tab updates the map within ~2 s without reload. Verified by orchestrator with the webapp-testing skill (screenshot) since real GPS may be unavailable headless — fallback acceptance: hazards render at seed coordinates and SSE updates arrive (visible in devtools/store). Commit.

---

## Phase 3 — Alert engine + simulation  *(agent: fable — the heart of the POC; tests FIRST)*

**Files:** `client/src/engine/geo.ts`, `client/src/engine/alertEngine.ts`, `client/src/engine/__tests__/fixtures.ts`, `client/src/engine/__tests__/alertEngine.test.ts`, `client/src/providers/SimulatedProvider.ts`, `client/src/providers/routes.ts`, `client/src/ui/SimControls.tsx`, **`client/src/alerting.ts`** — the glue this phase OWNS: instantiates the singleton `AlertEngine`, subscribes to the active provider's fixes (calls `engine.update(fix)`), subscribes to store hazard changes (calls `engine.setHazards`), and writes `hazardStates` + `activeAlert` back into the store. UI layers (Phase 4) only read the store and call `acknowledge` through it. Nothing else touches the engine.

**Engine public API (exact):**
```ts
export interface EngineOptions { confirmFixes?: number /*2*/; cooldownMs?: number /*180000*/; hysteresisM?: number /*300*/; }
export interface EngineEvent { hazardId: string; from: AlertState; to: AlertState; distanceM: number; fix: PositionFix; }
export class AlertEngine {
  constructor(opts?: EngineOptions);
  setHazards(hazards: Hazard[]): void;   // removed/deactivated hazards → their state resets to IDLE (emits event if not IDLE)
  update(fix: PositionFix): EngineEvent[];
  getState(hazardId: string): AlertState;
  getDistance(hazardId: string): number | null;
  acknowledge(hazardId: string): void;   // see precise semantics below
}
```

**acknowledge() semantics (precise, against the edge-triggered event model):** `acknowledge(id)` records `{tier: currentState, at: now}`. For `cooldownMs` after that, `update()` still performs state transitions internally but SUPPRESSES the emission of any `EngineEvent` whose `to` tier is ≤ the acknowledged tier (tier order: APPROACHING < SLOW_DOWN < IN_ZONE). A transition to a strictly HIGHER tier always emits (escalation overrides ack). After `cooldownMs` expires, emission resumes normally. `getState`/`getDistance` are unaffected by ack (the UI banner uses events; the debug drawer uses getters). Timestamps come from `fix.timestamp`, never `Date.now()` — keeps the engine pure and testable.

**geo.ts helpers:** `distanceToCenterlineM(fix, hazard)` (turf nearestPointOnLine + distance), `isInsideZone = dist < bufferMeters`, `directionMatches(headingDeg, hazard)` (angular diff vs bearingDeg ≤ toleranceDeg, or bothWays; null heading → treat as match), `isApproaching(fix, hazard)` (bearing from fix to nearest point on centerline within 90° of heading; null heading → true).

**Transitions:** per v1 §5.2 diagram, PLUS one addition the v1 machine is missing — an **abort-approach edge**: from APPROACHING or SLOW_DOWN, when `dist > preWarn + hysteresisM` OR (not `isApproaching` on `confirmFixes` consecutive fixes), transition → IDLE (driver diverted before reaching the zone; without this edge the hazard latches forever). Escalations (IDLE→APPROACHING, APPROACHING→SLOW_DOWN) require `confirmFixes` consecutive agreeing fixes (jitter guard). PASSED→IDLE when dist > preWarn + hysteresisM.

**Test scenarios (write ALL before the engine; fixtures = fix sequences generated by interpolating along the seed M1 centerline):**
1. Normal pass-through Budapest→Győr @110 km/h: transition sequence exactly IDLE→APPROACHING→SLOW_DOWN→IN_ZONE→PASSED, APPROACHING fires between 2000 m and 1800 m, SLOW_DOWN ≤ 800 m.
2. Opposite carriageway (reversed route, heading ~180° off): stays IDLE throughout.
3. Stop-and-go inside zone (speed drops to 0, heading null): stays IN_ZONE, no flapping.
4. GPS jitter near preWarn boundary (alternating fixes ±30 m across the line): no escalation until 2 consecutive fixes agree; never IDLE↔APPROACHING flapping.
5. Hazard deactivated (removed via `setHazards`) mid-APPROACHING: → IDLE, event emitted.
6. **Abort approach:** enter APPROACHING, then fixes turn away and recede past preWarn + hysteresisM: → IDLE (no SLOW_DOWN, no PASSED).
7. **Acknowledge:** enter APPROACHING, `acknowledge()`, recede to IDLE, re-approach within cooldownMs: internal transition happens but no APPROACHING event emitted; then escalate to SLOW_DOWN: event EMITTED (higher tier overrides ack); after cooldown expiry a fresh APPROACHING emits again.

**SimulatedProvider:** consumes a route LineString + target km/h, turf-interpolates a fix per simulated second, heading from segment bearing; controls play/pause/restart, speed ×1/×4/×16, scrub-to-fraction. Timers live in the provider (allowed — it's not the engine). Two built-in routes in `routes.ts` derived from the seed M1 centerline: (a) toward Győr passing through the zone with ~4 km lead-in, (b) reversed. Demo-mode toggle on start screen selects provider; SimControls overlay on drive screen.

**Acceptance:** `npm run test` — all 7 scenarios green (the vitest suite is the AUTHORITATIVE acceptance; there is no debug UI until Phase 4); typecheck clean. Browser spot-check via webapp-testing: run sim route (a) and read `hazardStates` from the zustand store with `page.evaluate()` (expose the store on `window.__store` in dev builds for this). Route (b) stays IDLE. Commit.

---

## Phase 4 — Alert UX  *(agent: opus, design brief §5.5 of v1 verbatim)*

**Files:** `client/src/ui/AlertOverlay.tsx` (full-screen takeover: severity color, huge distance countdown, advised speed, tap to acknowledge, auto-dismiss on PASSED), `client/src/audio.ts` (Web Audio chime pre-unlocked on Start tap; `speechSynthesis` hu voice w/ en fallback, speak on APPROACHING and SLOW_DOWN; every `speak()` also writes `lastSpoken` to the store, every `navigator.vibrate` writes `lastVibration` — these are the machine-checkable signals), vibration `[300,100,300]` on escalation, `client/src/i18n/{hu,en}.ts` + tiny `t()` helper, `client/src/ui/DebugDrawer.tsx` (raw fixes, per-hazard state + distance, lastSpoken, lastVibration), extend `client/src/alerting.ts` (Phase 3 glue) to route engine events → overlay/audio/vibration, wake lock (`navigator.wakeLock.request('screen')`) on drive screen, `prefers-reduced-motion` respected, touch targets ≥ 48 px.

**Acceptance (machine-verifiable — screenshots capture no audio):** simulated run shows overlay at preWarn (amber, counting down), escalates at slowDown, auto-clears on PASSED — verified via webapp-testing screenshots; audio/vibration verified by asserting `lastSpoken` contains the expected Hungarian string and `lastVibration === [300,100,300]` via `page.evaluate()` on `window.__store` (speechSynthesis may be voiceless headless — the assertion is on the call, not the sound). Acknowledge silences the current tier only (re-check store). Commit.

---

## Phase 5 — Phone access + demo polish  *(agent: opus)*

**Files:** README.md (run instructions; demo script from v1 §10; known limitations from v1 §9; how to move the local-test hazard; deploy instructions for Vercel + Render as USER steps — no accounts available to agents), `client/src/ui/StartScreen.tsx` polish (QR code of the app URL rendered client-side — tiny dependency-free QR lib or `qrcode` npm package), Vite `--host` documented for LAN + note that phone GPS needs HTTPS (localhost exception doesn't apply on LAN → recommend ngrok/Cloudflare quick tunnel commands, not executed).

**Acceptance:** README demo script complete and accurate against the actual app; `npm run dev` + phone-on-LAN caveats documented; full simulated demo passes end-to-end (orchestrator runs it once more). Final commit + tag `poc-v1`.

---

## Execution & review protocol (orchestrator)

1. Sequential phases; each built by the assigned agent with this plan section as its spec.
2. After each phase: orchestrator runs the acceptance commands itself (Bash/curl/vitest; webapp-testing for UI phases).
3. Then an independent **review agent (opus)** reads the phase diff (`git diff <phase-start>..HEAD`) checking: conventions above (lon/lat, units, engine purity), spec compliance, real bugs only. Findings fixed by a follow-up agent (or orchestrator for one-liners) before the phase commit is considered done.
4. Commit at every green acceptance check; phase boundaries are git commits.
