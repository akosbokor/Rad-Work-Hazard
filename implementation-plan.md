# Road Hazard Alert POC — Implementation Plan

**Working title:** M1 Figyelő (M1 Watch)
**Goal:** Demonstrate that a phone running a web app can detect proximity to a known hazardous road segment (the M1 motorway construction zone), fetch live hazard data from a cloud API, and warn the driver in time to slow down. The "cloud" does not exist yet, so the POC includes a mock cloud service that behaves like the future real one.

**Non-goals for the POC:** user accounts, crowd-sourced reporting, real traffic data ingestion, native mobile apps, scaling, security hardening. The POC must be honest about being a mock, but architected so the mock cloud can later be swapped for the real one without touching the client's alert logic.

---

## 1. System overview

```
┌─────────────────────────┐         HTTPS (JSON/GeoJSON)        ┌──────────────────────────┐
│  Phone / Browser (PWA)  │ ──────────────────────────────────► │  Mock Cloud (Node API)   │
│                         │   GET /hazards?lat&lon&radius       │                          │
│  ┌───────────────────┐  │ ◄────────────────────────────────── │  - hazard zones (GeoJSON)│
│  │ Position Provider │  │         SSE /stream (updates)       │  - admin panel to toggle │
│  │  real GPS | sim   │  │                                     │    hazards live in demo  │
│  └────────┬──────────┘  │                                     └──────────────────────────┘
│           ▼             │
│  ┌───────────────────┐  │
│  │   Alert Engine    │  │   pure TypeScript, fully unit-testable,
│  │ (state machine)   │  │   no browser APIs inside
│  └────────┬──────────┘  │
│           ▼             │
│   Map UI + Banner +     │
│   Audio + Vibration     │
└─────────────────────────┘
```

Three design decisions carry the whole POC:

1. **Position Provider abstraction.** The alert engine consumes a stream of `{lat, lon, speed, heading, timestamp}` objects and never knows whether they came from `navigator.geolocation.watchPosition` or from a simulated route playback. This is what makes the POC demonstrable at a desk, in a meeting room, without driving to the M1. It is the single most important feature for the demo.

2. **Alert engine as a pure module.** All geofencing math and state transitions live in a framework-free TypeScript module with unit tests. The React UI only renders its output. When the real cloud arrives, or when this becomes a native app, this module moves over unchanged.

3. **Mock cloud with a live admin panel.** During the demo you open a second browser tab, add or activate a hazard on the M1, and the phone in your hand picks it up within seconds. This proves the "dynamic map" claim far better than static data would.

---

## 2. Technology choices

| Concern | Choice | Why |
|---|---|---|
| Client framework | Vite + React + TypeScript | Fast dev loop, Claude Code works very well with it, TS types shared with server |
| Map | Leaflet + OpenStreetMap tiles | Free, no API key, no billing account needed for a POC. `react-leaflet` for integration |
| Geospatial math | @turf/turf | `nearestPointOnLine`, `distance`, `bearing`, `booleanPointInPolygon`, `buffer` — everything the alert engine needs |
| Server | Node.js + Express + TypeScript | Minimal, familiar, trivially replaceable by the real cloud later |
| Live updates | Server-Sent Events (SSE) | One-directional push is all we need; simpler than WebSocket, works through proxies |
| State (client) | Zustand or plain React context | Tiny app, no need for heavier tooling |
| Tests | Vitest | Unit tests for the alert engine and geo math; same toolchain as Vite |
| Monorepo | npm workspaces (`client/`, `server/`, `shared/`) | Shared types (`Hazard`, `PositionFix`) in one place |
| Phone access during dev | ngrok or Vite `--host` + mkcert | Geolocation API requires a secure context (HTTPS or localhost) — a plain LAN IP over HTTP will not get GPS access on the phone |
| Deployment (demo) | Frontend on Vercel/Netlify, server on Render/Fly.io free tier | Public HTTPS URL means any phone can join the demo by scanning a QR code |

Deliberately avoided: Google Maps (API key + billing), native push notifications via a push service (overkill for POC), any database (hazards live in a JSON file / in-memory store).

---

## 3. Data model

Shared TypeScript types in `shared/types.ts`, wire format is GeoJSON-based.

```ts
interface Hazard {
  id: string;
  type: 'construction' | 'accident' | 'congestion' | 'weather';
  severity: 'info' | 'warning' | 'danger';
  active: boolean;
  geometry: GeoJSON.LineString;      // centerline of the affected segment
  bufferMeters: number;              // half-width of the zone around the centerline
  direction: {                       // direction sensitivity
    bearingDeg: number;              // travel direction the hazard applies to, e.g. 262 (towards Győr)
    toleranceDeg: number;            // e.g. 60 → applies if |heading - bearing| < 60
    bothWays: boolean;
  };
  alertDistances: {                  // meters before the zone entry point
    preWarn: number;                 // e.g. 2000 — "construction ahead"
    slowDown: number;                // e.g. 800  — "slow down now"
  };
  speedLimitKmh?: number;            // e.g. 80
  message: { hu: string; en: string };
  validFrom?: string;                // ISO timestamps, lets you demo scheduled works
  validUntil?: string;
}

interface PositionFix {
  lat: number;
  lon: number;
  speedKmh: number | null;           // from GPS or derived from consecutive fixes
  headingDeg: number | null;
  accuracyM: number;
  timestamp: number;
}
```

Why a **buffered centerline** instead of a hand-drawn polygon: the M1 works stretch for kilometers. Storing the centerline (a handful of points traced along the motorway) plus a buffer width is easy to author, and turf can compute "distance from my position to the nearest point of this segment" directly with `nearestPointOnLine`, which is exactly the number the alert tiers need.

Why **direction matters:** without a bearing check, a driver on the opposite carriageway (or on a parallel service road) gets false alarms, and false alarms are the first thing a reviewer will poke at. Heading comes from `GeolocationCoordinates.heading` when moving, with a fallback computed from the last two fixes.

**Seed data:** one construction hazard along the real M1 works section (the 2×3-lane widening area between roughly the Concó rest area and Tata), traced from OpenStreetMap. Plus one "test hazard" whose centerline you place on a street next to your office/home, so you can field-test by walking or driving locally without going to the M1. Coordinates go in `server/data/hazards.json` and are trivially editable.

---

## 4. Mock cloud API (`server/`)

```
GET  /api/v1/hazards                     → all active hazards (the client filters locally)
GET  /api/v1/hazards?lat=&lon=&radius=   → hazards whose zone intersects the radius (the "real cloud" contract)
GET  /api/v1/hazards/:id
GET  /api/v1/stream                      → SSE: emits {type:'hazard_updated'|'hazard_created'|'hazard_deleted', hazard}
POST /api/v1/hazards                     → create (admin/demo only)
PATCH /api/v1/hazards/:id                → update, e.g. {active:false}
GET  /health
```

Implementation notes:

- In-memory store seeded from `data/hazards.json`; a `?persist=true` flag can write back to the file so demo edits survive a restart. No database.
- The radius query uses turf on the server so the endpoint contract already matches what a real cloud with a spatial index (PostGIS etc.) would expose. The client should primarily use the radius endpoint — this keeps the future migration honest ("the phone only downloads hazards near itself").
- CORS enabled for the client origin.
- A minimal **admin page** served by the server at `/admin`: a Leaflet map where you click to draw a centerline, set buffer/severity/message, and toggle `active`. This page is demo infrastructure, so plain HTML + vanilla JS is fine — do not over-engineer it.
- SSE keep-alive comment every 25 s so proxies don't kill the stream.

---

## 5. Client app (`client/`)

### 5.1 Position providers

```ts
interface PositionProvider {
  start(cb: (fix: PositionFix) => void): void;
  stop(): void;
}
```

- **RealGpsProvider:** `watchPosition` with `enableHighAccuracy: true, maximumAge: 1000, timeout: 10000`. Derives speed/heading from consecutive fixes when the GPS doesn't report them (browsers often return `null` for both below ~10 km/h). Discards fixes with `accuracy > 100 m`.
- **SimulatedProvider:** takes a GeoJSON LineString route + target speed, interpolates positions along it with turf, emits a fix every second, computes heading from the segment direction. Controls: play / pause / speed ×1 ×4 ×16 / restart / drag-to-position. Ship with two built-in routes: (a) Budapest → Győr on the M1 passing through the hazard, (b) the opposite carriageway, to show the direction filter suppressing the alert.

The provider is selected in the UI (a "Demo mode" toggle). Everything downstream is identical.

### 5.2 Alert engine (pure module, `client/src/engine/`)

A state machine evaluated on every position fix, per hazard:

```
IDLE ──(dist ≤ preWarn AND approaching AND direction matches)──► APPROACHING
APPROACHING ──(dist ≤ slowDown)──► SLOW_DOWN
SLOW_DOWN ──(inside buffered zone)──► IN_ZONE
IN_ZONE ──(exited zone AND moving away)──► PASSED
PASSED ──(dist > preWarn + hysteresis)──► IDLE
any ──(hazard deactivated via SSE)──► IDLE
```

Key details that make it feel production-minded rather than a toy:

- **Approach test:** hazard is ahead, not behind — bearing from position to the nearest point of the segment must be within ~90° of current heading. Prevents alerts firing after you've passed the zone.
- **Hysteresis and cooldown:** a state can only escalate on two consecutive fixes agreeing (kills GPS jitter), and a dismissed alert for a given hazard stays silent for N minutes unless the state escalates further.
- **Distance metric:** `turf.nearestPointOnLine(centerline, position)` → `turf.distance` in meters. Inside-zone test: distance < `bufferMeters`.
- Engine emits typed events (`enter_approaching`, `enter_slow_down`, …) consumed by the UI layer; it never touches the DOM, audio, or notifications itself.
- **Unit tests:** feed recorded fix sequences (a JSON fixture per scenario) through the engine and assert the transition sequence. Scenarios: normal pass-through, opposite carriageway, stop-and-go inside the zone, GPS jitter near the boundary, hazard deactivated mid-approach.

### 5.3 Alerting the driver

Layered by reliability, most reliable first:

1. **Full-screen banner** (always works): the whole viewport switches to the alert view — severity color, huge distance countdown ("ÚTÉPÍTÉS 800 m"), advised speed. This is the primary channel; a driver glances for half a second.
2. **Audio:** a short chime (Web Audio, pre-unlocked by a user gesture on the start screen — mobile browsers block audio otherwise) followed by speech via `speechSynthesis` with a Hungarian voice: "Figyelem! Útépítés nyolcszáz méterre. Lassítson nyolcvanra." English fallback.
3. **Vibration:** `navigator.vibrate([300,100,300])` — Android Chrome only; harmless no-op elsewhere.

The app is deliberately browser-only: nothing to install, you just open a URL (or scan a QR code). That rules out background push notifications entirely, so the honest POC story is "screen on, tab in foreground, phone in a dashboard mount" — which is exactly how Waze is used anyway, and the banner + audio + vibration layers cover that scenario fully.

### 5.4 Screens

1. **Start screen:** app name, one-line explanation, big "Start driving" button (this gesture unlocks audio + requests geolocation permission), "Demo mode" toggle, language toggle HU/EN.
2. **Drive screen:** Leaflet map centered on the car marker (rotating with heading), hazard zones drawn as buffered polygons colored by severity, top status strip (GPS accuracy, speed, connection state to cloud), simulation transport controls when in demo mode.
3. **Alert overlay:** as above; tap to acknowledge, auto-dismisses on `PASSED`.
4. **Debug drawer** (collapsible): raw fix stream, engine state per hazard, distances — invaluable during development and convincing during technical Q&A.

### 5.5 Visual design brief (for the build phase)

Subject: a driver on a motorway at 110 km/h; the page's single job is to make "slow down, hazard in X meters" legible in a half-second glance. That dictates the direction — this is an instrument, not a website: near-black background (screens in cars at night), one condensed heavy display face for the distance readout at very large size, a quiet grotesk for everything else, severity encoded in a strict three-color code (info blue-grey / warning amber / danger red) used nowhere else in the UI. The signature element is the alert takeover itself: distance counting down in huge type with the zone geometry echoed as a thin animated line beneath it. Everything outside the alert stays deliberately muted so the alert owns all the contrast. Respect `prefers-reduced-motion`; keep touch targets ≥ 48 px (gloved/driving hands).

---

## 6. Repository layout

```
m1-figyelo/
├── CLAUDE.md                  # project context for Claude Code (see §8)
├── package.json               # npm workspaces: client, server, shared
├── shared/
│   └── src/types.ts           # Hazard, PositionFix, AlertState, API payloads
├── server/
│   ├── src/index.ts           # Express app, routes, SSE hub
│   ├── src/store.ts           # in-memory hazard store + geo filtering
│   ├── data/hazards.json      # seed hazards (M1 + local test hazard)
│   └── public/admin/          # demo admin panel (plain HTML/JS/Leaflet)
├── client/
│   ├── src/engine/            # pure alert engine + turf helpers
│   │   ├── alertEngine.ts
│   │   ├── geo.ts
│   │   └── __tests__/         # fixtures + vitest specs
│   ├── src/providers/         # RealGpsProvider, SimulatedProvider, routes/
│   ├── src/api/               # fetch + SSE client for the mock cloud
│   ├── src/ui/                # screens, map, alert overlay, debug drawer
│   └── src/i18n/              # hu.ts, en.ts
└── README.md                  # how to run, how to demo, known limitations
```

---

## 7. Build phases (each phase ends runnable + committed)

**Phase 0 — Scaffold (½ day).** npm workspaces, TypeScript configs, Vite client boots, Express server answers `/health`, shared types package imported by both, Vitest wired, git init, `CLAUDE.md` written. Acceptance: `npm run dev` starts both, one dummy shared type flows client↔server.

**Phase 1 — Mock cloud (½–1 day).** Hazard store, all REST endpoints, radius filtering with turf, SSE stream, seed `hazards.json` with the M1 construction segment traced from OpenStreetMap and a local test hazard. Acceptance: `curl` the radius endpoint with M1 coordinates and get the hazard; `PATCH active:false` shows up on the SSE stream.

**Phase 2 — Map client (1 day).** Drive screen with Leaflet, hazard zones rendered as buffered polygons (turf `buffer` client-side), car marker from RealGpsProvider on localhost, connection status, hazards refetched around the current position and updated live via SSE. Acceptance: open on laptop, see yourself on the map with the local test zone drawn.

**Phase 3 — Alert engine + simulation (1–2 days). The heart of the POC.** Pure engine with the state machine, direction and approach tests, hysteresis; SimulatedProvider with the two built-in M1 routes and transport controls; unit test suite green for all five scenarios in §5.2. Acceptance: run the Budapest→Győr simulation, watch IDLE→APPROACHING→SLOW_DOWN→IN_ZONE→PASSED fire at the right distances; opposite-carriageway route stays silent.

**Phase 4 — Alert UX (1 day).** Full-screen alert overlay per the design brief, chime + Hungarian speech synthesis, vibration, acknowledge/cooldown behavior, HU/EN strings, debug drawer. Acceptance: simulated run on a phone feels like a product, not a prototype.

**Phase 5 — Phone + field + demo (1 day).** HTTPS access from a phone (ngrok during dev, then deploy client to Vercel and server to Render/Fly.io — HTTPS is mandatory anyway, the Geolocation API refuses to run on an insecure origin), QR code pointing at the public URL, walk/drive test against the local test hazard, write the demo script into README. Acceptance: someone else's phone, scanning a QR code and opening the page in their browser, runs the full simulated M1 demo; your phone triggers the local hazard for real on foot or in the car.

Total: roughly 5–6 focused days, very compressible with Claude Code.

---

## 8. Working with Claude Code

Suggested `CLAUDE.md` skeleton to drop in the repo root:

```markdown
# M1 Figyelő — road hazard alert POC
Waze-like proximity warning for the M1 motorway construction zone.
Mock cloud (server/) + PWA client (client/), shared types in shared/.

## Commands
- npm run dev          # client + server concurrently
- npm run test         # vitest, engine tests live in client/src/engine/__tests__
- npm run typecheck

## Architecture rules
- client/src/engine/ is PURE TypeScript: no React, no DOM, no fetch. Everything else consumes its events.
- Position data only enters through a PositionProvider. Never call navigator.geolocation outside providers/.
- All client↔server payloads use types from shared/. Change types there first.
- Coordinates are [lon, lat] in GeoJSON but {lat, lon} in PositionFix — convert at the boundary, never mix.

## Conventions
- Distances in meters, speeds in km/h, bearings in degrees 0–360.
- UI strings only via i18n files (hu is primary).
```

Practical workflow: work phase by phase, start each phase in plan mode, ask Claude Code to write the engine unit tests from the §5.2 scenario list *before* the engine implementation, and commit at every green acceptance check. The lon/lat ordering rule above is in `CLAUDE.md` because it is the single most common bug class in geo code, for humans and models alike. Claude Code docs: https://docs.claude.com/en/docs/claude-code/overview

### Subagents

Subagents are separate Claude instances with their own context window, system prompt, and tool restrictions, defined as markdown files in `.claude/agents/` (or created interactively with `/agents`). Claude Code delegates to them automatically when a task matches their `description` field, and only their summary returns to the main conversation. Claude Code also ships built-in Explore and Plan subagents that it uses on its own, so don't recreate those.

For a project this size, two custom subagents earn their keep; more would be overhead:

**`test-runner`** — keeps vitest output out of the main context. The engine test suite gets run constantly during Phase 3, and its verbose output is exactly the kind of noise subagents exist to absorb:

```markdown
---
name: test-runner
description: Runs the vitest suite and reports only failing tests with their error messages. Use PROACTIVELY after any change to client/src/engine/ or shared/.
tools: Bash, Read
model: sonnet
---
Run `npm run test`. Report only failing test names, their assertion errors,
and the fixture scenario involved. If all tests pass, reply with one line.
Never modify files.
```

**`geo-reviewer`** — a read-only reviewer scoped to the bug classes specific to this codebase:

```markdown
---
name: geo-reviewer
description: Reviews changed files for geospatial correctness. Use after implementing or modifying anything in client/src/engine/, client/src/providers/, or server/src/store.ts.
tools: Read, Grep, Glob
model: opus
---
Check specifically for: (1) [lon,lat] vs {lat,lon} ordering mixed across the
GeoJSON boundary, (2) unit mismatches — turf defaults to kilometers, the
engine works in meters, (3) bearing arithmetic that doesn't wrap at 0/360,
(4) any import of React, DOM, or fetch inside client/src/engine/ (must stay
pure). Report findings as file:line with the concrete fix. Do not edit files.
```

Both are read-only or near-read-only by design — restricting `tools` in the frontmatter is what makes a reviewer trustworthy. Note that agent files edited on disk are picked up at session start (agents created via `/agents` take effect immediately). Subagent docs: https://code.claude.com/docs/en/sub-agents

Phases 1 and 2 (server and map client) are decoupled enough to build in parallel sessions if you want speed, but within one session, sequential phase-by-phase work with these two subagents is the simpler and safer default for a POC.

### Token and usage efficiency

The goal: spend expensive-model tokens only where reasoning actually pays off, and keep the context window lean so every message doesn't drag dead weight behind it. Full reference: https://code.claude.com/docs/en/costs

**Model routing.** On a plan with generous Opus access, flip the default the other way: Opus is the session default for actual coding, and Sonnet takes only the genuinely simple, mechanical work where deeper reasoning buys nothing. Switch with `/model` mid-session or set the default in `/config`. The point of routing is no longer saving money per token but stretching the plan's usage limits — Opus burns the daily/weekly budget several times faster than Sonnet, so every mechanical task it doesn't touch is Opus budget preserved for the alert engine. Mapped onto this project:

| Work | Model |
|---|---|
| Phase 0 scaffold, configs, README, i18n strings, `hazards.json` seed data, admin panel HTML | Sonnet — this is fill-in-the-template work |
| Phases 1, 2, 4, 5 — server routes, map UI, alert UX, deployment | Opus |
| Phase 3 — alert state machine, direction/hysteresis logic, engine tests | Opus, in plan mode first — this is where its reasoning earns its cost |
| Running tests, formatting, commit messages, small config tweaks mid-session | Sonnet (or delegate to the subagents below) |

The subagent definitions above carry `model:` fields for the same reason — the test-runner just executes vitest and relays failures, so Sonnet is already overqualified, while the geo-reviewer makes judgment calls about subtle bugs and deserves Opus.

**Context hygiene.** This part is unchanged by the plan tier — subscription limits are consumed by tokens too, and a bloated context degrades output quality regardless of who pays. Every message re-sends the whole conversation, so stale context is a tax on every subsequent turn:

- Reference files by path (`@server/src/store.ts`, or "look at `evaluateFix` in `alertEngine.ts`") instead of pasting contents — a pasted file sits in context for the rest of the session, while a path lets Claude read selectively.
- Run `/clear` between phases — each phase ends committed and self-contained, so nothing from Phase 1 needs to ride along into Phase 2 (`CLAUDE.md` re-establishes the baseline for free). `/clear` can't be undone; if something from the session is still needed, `/compact` instead, which keeps a summary. `/compact` accepts instructions ("focus on the engine state decisions"), and works best run proactively at a phase boundary, not after quality has already degraded. `/context` shows how full the window is.
- Batch related small requests into one prompt instead of three back-and-forth turns — three prompts means the full history gets re-read three times.
- When an approach fails, prefer rewinding to the checkpoint before the attempt (double-tap Escape) and re-instructing with what you learned, rather than piling correction turns on top — the failed diff otherwise stays in context forever.

**Standing config.** Keep `CLAUDE.md` short and rule-dense (the skeleton in this section is about the right size — every line of it is read on every session start). Connect only the MCP servers a session needs; each one's tool surface is context overhead on every message. Leave prompt caching on (it's the default and it's what makes repeated context cheap). Plan mode before anything touching more than two or three files — a few-hundred-token plan is cheaper than reverting and regenerating a wrong 400-line diff. And the pattern this plan already uses everywhere — subagents for verbose side work, tests written before implementation, one runnable commit per phase — is itself the biggest saver: short, focused sessions against a well-specified plan simply never accumulate the multi-hour context bloat that burns most budgets.

---

## 9. Risks and honest limitations

- **Foreground-only by design.** A browser tab cannot get GPS or play audio while the phone is locked or the tab is backgrounded, and without an installed app there are no push notifications. The POC's claim is scoped to "tab open in a dashboard mount" — state this proactively; background alerting is exactly the argument for the eventual native app. Use the Screen Wake Lock API (`navigator.wakeLock`) on the drive screen so the display doesn't sleep mid-demo.
- **GPS accuracy and latency.** Urban canyons and the first ~30 s after start give poor fixes; the accuracy filter and hysteresis handle most of it, and the debug drawer makes the rest explainable.
- **False positives on parallel roads.** The direction filter plus the buffered-centerline distance handles the opposite carriageway; a service road running parallel within the buffer would still trigger — acceptable for a POC, note it in README.
- **Battery.** High-accuracy `watchPosition` plus a map redraw is hungry; fine for a demo, worth mentioning as native-app motivation.
- **Speech synthesis voices.** Hungarian TTS quality varies by device; always pair speech with the visual banner and chime.
- **Demo insurance.** Never demo on live GPS alone. The simulation mode is the demo; live GPS is the encore.

## 10. Demo script (what the stakeholders see, ~5 minutes)

1. Phone opens the public URL in its browser (scan the QR code, nothing to install — that's itself a selling point for the POC), laptop projecting the admin panel side by side.
2. Start simulation: car leaves Budapest on the M1 at ×4 speed. At 2 km the phone chimes and pre-warns; at 800 m it takes over the screen and speaks "Lassítson nyolcvanra"; inside the zone it shows the reduced limit; after the works it clears.
3. Opposite-direction route: silence. One sentence about direction awareness.
4. Live edit: on the admin panel, drop a new accident hazard ahead of the simulated car; the phone picks it up over SSE within seconds and alerts. This is the "dynamic cloud map" moment.
5. Close with the architecture slide: the client already speaks the radius-query contract, so the mock cloud swaps for the real one without client changes.
