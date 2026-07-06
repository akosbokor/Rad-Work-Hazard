# CLAUDE.md — M1 Figyelő / Road Hazard Alert POC

A phone-browser web app that detects proximity to a hazardous road segment (M1
construction zone), fetches live hazard data from a mock cloud API, and warns the
driver in time — fully demonstrable at a desk via simulation.

**Architecture:** npm-workspaces monorepo (`shared/`, `server/`, `client/`). Pure
TypeScript alert engine (state machine, no browser APIs) fed by a `PositionProvider`
abstraction (real GPS or simulated route playback). Express mock cloud with GeoJSON
hazards, radius query, SSE live updates, and a vanilla-JS admin panel. React + Leaflet
UI renders engine output.

## Tech Stack (PINNED — do not deviate)

- Node ≥ 20 (dev machine has v25.2.1), npm workspaces
- `typescript@~5.7`, `vite@^6`, `react@^19`, `react-dom@^19`
- `leaflet@^1.9`, `react-leaflet@^5` (v5 requires React 19 — matched)
- `@turf/turf@^7`
- `express@^4.21` (NOT v5), `cors@^2`
- `vitest@^3`, `zustand@^5`, `tsx@^4` (server dev runner), `concurrently@^9`
- No database, no CSS framework (hand-written CSS)

## Ports

- server `8080`, client `5173`
- Vite proxy `/api` → `http://localhost:8080` (with `changeOrigin: true`; SSE passes
  through fine in dev)

## Global conventions (ENFORCE in review)

- GeoJSON is `[lon, lat]`; `PositionFix` is `{lat, lon}` — convert only at boundaries,
  never mix.
- Geolocation API `speed` is **m/s** → convert to km/h in the provider. Distances
  meters, speeds km/h, bearings 0–360°.
- **Turf defaults to KILOMETERS.** Every `distance`, `nearestPointOnLine`, `buffer`,
  `along`, `length` call MUST pass `{ units: 'meters' }` (and read `properties.dist`
  accordingly). A missing units option makes values 1000× too small — silent logic
  catastrophe.
- **Active-only invariant:** the client store holds only `active: true` hazards. Filter
  on radius fetch AND on every SSE event (an `hazard_updated` with `active:false`
  removes it from the store). The engine therefore treats "hazard absent from
  `setHazards`" as the single deactivation signal → state resets to IDLE. The engine
  never inspects `.active`.
- `tsconfig.base.json` MUST set `"moduleResolution": "bundler"` and ALL three
  workspaces inherit it — `node`/`node10` resolution cannot see the `exports`-only
  shared package and typecheck breaks.
- `validFrom`/`validUntil` exist in the type for forward-compat only; NO POC code
  consults them (only `active` gates).
- The drawn zone polygon (turf `buffer`) is presentation-only; the engine's
  `distance < bufferMeters` point-to-line test is the source of truth. They may disagree
  slightly at corners/ends — do not assert pixel agreement.
- Terminology: `confirmFixes` = consecutive-fix jitter guard on escalation;
  `hysteresisM` = distance margin for falling back to IDLE. (Not the same knob.)
- `client/src/engine/` is pure TS: no React, no DOM, no fetch, no timers.
- Position data enters ONLY through a `PositionProvider`.
- All client↔server payloads typed from `shared/`.
- UI strings only via `client/src/i18n/` (hu primary, en fallback).

## Workspace layout

- `shared/` — `@m1/shared`, types only, consumed as TS source directly (no build step;
  works because every workspace uses `moduleResolution: bundler` and the server runs
  under tsx).
- `server/` — `@m1/server`, Express mock cloud, runs under `tsx`.
- `client/` — `@m1/client`, Vite + React app (written by hand, NOT via `npm create vite`).

## Scripts (root)

- `npm run dev` — concurrently runs server (`tsx watch`) + client (`vite`).
- `npm run test` — runs the client vitest suite.
- `npm run typecheck` — `tsc --noEmit` in all three workspaces.
