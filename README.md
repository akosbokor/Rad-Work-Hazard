# M1 Figyelő — Road Hazard Alert POC

Warns a driver, from a plain phone browser, that they are approaching a hazardous road
segment (the M1 motorway construction zone). The client fetches live hazard data from a
cloud API and escalates through chime → banner → voice → vibration in time to slow down.
This repository covers both sides of the pipeline: the **browser app** and the **mock
cloud** it talks to — architected so the mock swaps for the real cloud with zero client
change. **Fully demonstrable at a desk via route simulation — no real driving required.**

## Repository layout

```
road-hazard-alert/
├── package.json                  ← npm workspaces root; `npm run dev` starts everything
├── CLAUDE.md                     ← architecture rules & conventions (units, lon/lat, purity)
├── PROGRESS.md                   ← build log: what is done, known issues, next steps
│
├── shared/                       ← @m1/shared — types used by BOTH sides (no build step)
│   └── src/index.ts              ← Hazard, PositionFix, AlertState, SSE event types
│
├── server/                       ← @m1/server — the MOCK CLOUD (Express, runs under tsx)
│   ├── src/index.ts              ← REST routes + SSE endpoint + static admin panel
│   ├── src/store.ts              ← in-memory hazard store + turf radius filtering
│   ├── src/sse.ts                ← SSE hub: client registry, broadcast, 25 s keep-alive
│   ├── data/hazards.json         ← seed hazards (real M1 geometry + walkable local-test)
│   └── public/admin/             ← demo admin panel: draw / toggle hazards on a map
│
├── client/                       ← @m1/client — the BROWSER APP (Vite + React + Leaflet)
│   ├── public/audio/             ← pre-rendered neural-TTS alert clips (en-US-AriaNeural)
│   └── src/
│       ├── engine/               ← ★ pure TypeScript alert engine — no React, no DOM,
│       │   ├── alertEngine.ts       no fetch, no timers, no Date.now; 7-scenario
│       │   ├── geo.ts               vitest suite is the authoritative acceptance
│       │   └── __tests__/
│       ├── providers/            ← position sources behind ONE interface
│       │   ├── RealGpsProvider.ts   (watchPosition, m/s→km/h, accuracy filter)
│       │   ├── SimulatedProvider.ts (route playback: ×1/×4/×16, scrub, restart)
│       │   └── routes.ts            (demo route derived from the M1 centerline)
│       ├── alerting.ts           ← the ONLY module allowed to touch the engine
│       ├── api/client.ts         ← radius fetch + SSE subscription (auto-reconnect)
│       ├── store.ts              ← zustand store (single source of truth for the UI)
│       ├── audio.ts              ← chime (oscillator) + clip playback + vibration
│       ├── i18n/                 ← hu.ts / en.ts flat string maps (UI is bilingual)
│       └── ui/                   ← DriveScreen (map), AlertOverlay, SimControls,
│                                    StatusStrip, DebugDrawer
│
└── docs/plans/                   ← reviewed implementation plan (v2) the build followed
```

## System architecture

```
┌───────────────────────────────────────────────┐          HTTP / SSE (JSON, Vite proxies /api → :8080)
│  PHONE / BROWSER  —  client/  (:5173)         │
│                                               │   GET /api/v1/hazards?lat&lon&radius
│  ┌─────────────────────────┐                  │ ────────────────────────────────────►  ┌──────────────────────────────────┐
│  │     PositionProvider    │                  │                                        │  MOCK CLOUD — server/  (:8080)   │
│  │  RealGpsProvider (GPS)  │                  │   SSE  GET /api/v1/stream              │                                  │
│  │  SimulatedProvider (sim)│                  │ ◄────────────────────────────────────  │  in-memory store                 │
│  └───────────┬─────────────┘                  │      hazard_created/updated/deleted    │    ▲ seeded from data/hazards.json
│              │ PositionFix                    │                                        │  turf radius filter (meters)     │
│              │ {lat, lon, speedKmh,           │                                        │  SSE hub (25 s keep-alive)       │
│              │  headingDeg, accuracy, ts}     │                                        │                                  │
│              ▼                                │                                        │  ┌────────────────────────────┐  │
│  ┌─────────────────────────┐                  │        POST / PATCH / DELETE           │  │  /admin  (plain HTML+JS)   │  │
│  │  alerting.ts  (glue)    │                  │      ┌────────────────────────────────►│  │  draw centerline, toggle   │  │
│  │  ┌───────────────────┐  │                  │      │  (admin browser tab)            │  │  active, create/delete     │  │
│  │  │   AlertEngine     │  │                  │      │                                 │  └────────────────────────────┘  │
│  │  │  pure state       │  │                  │      │                                 └──────────────────────────────────┘
│  │  │  machine          │  │                  │      │
│  │  └───────────────────┘  │                  │      │   Every mutation is broadcast over SSE →
│  └───────────┬─────────────┘                  │      │   every connected phone updates in ~1–2 s.
│              ▼ writes hazardStates,           │      │
│      ┌───────────────┐  activeAlert           │      │
│      │ zustand store │◄────────────────┐      │      │
│      └───────┬───────┘   active-only   │      │      │
│              ▼            hazards      │      │      │
│   Leaflet map · AlertOverlay ·  api/client.ts ├──────┘
│   audio clips · vibration · DebugDrawer      │
└───────────────────────────────────────────────┘
```

## How an alert happens (data flow)

1. **A fix arrives.** The active `PositionProvider` (real GPS or simulated playback —
   selected by the "Demó mód" toggle, identical downstream) emits a `PositionFix` about
   once per second into the store.
2. **The engine evaluates.** `alerting.ts` feeds every fix to `AlertEngine.update()`. Per
   hazard, the engine measures the distance from the fix to the hazard's **centerline**
   (turf `nearestPointOnLine`, meters), checks the **direction filter** (heading within
   ±60° of the hazard's travel bearing) and the **approach test** (hazard ahead, not
   behind), and runs the state machine:

   ```
   IDLE ──(dist ≤ preWarn ∧ approaching ∧ direction ok, 2 consecutive fixes)──► APPROACHING
   APPROACHING ──(dist ≤ slowDown, 2 consecutive fixes)──► SLOW_DOWN
   SLOW_DOWN ──(dist < bufferMeters)──► IN_ZONE
   IN_ZONE ──(exited the zone)──► PASSED
   PASSED ──(dist > preWarn + 300 m)──► IDLE
   APPROACHING | SLOW_DOWN ──(receded past preWarn + 300 m ∨ turned away)──► IDLE   ← abort
   any state ──(hazard deactivated / deleted, seen via SSE)──► IDLE
   ```

3. **State lands in the store.** `alerting.ts` writes per-hazard `{state, distanceM}`
   and the highest-tier `activeAlert` into the zustand store. The UI is purely a render
   of the store — the overlay appears/updates/clears with no event plumbing of its own.
4. **Feedback fires on escalation.** On entering APPROACHING or SLOW_DOWN the glue plays
   the chime, a pre-rendered voice clip ("Attention! Roadworks ahead." / "Slow down
   now!"), and vibrates. Tapping the overlay **acknowledges** the current tier (engine-
   side cooldown); a genuine escalation still breaks through.
5. **The cloud stays live.** The client re-queries hazards around its position (every
   30 s or 2 km) and holds an SSE subscription; an admin toggling a hazard reaches every
   phone in ~1–2 s and resets its alert state if it was mid-approach.

## Parameters

| Parameter | Value |
| --- | --- |
| Client (Vite dev server) | `:5173` — binds all interfaces, proxies `/api` → `:8080` |
| Mock cloud (Express) | `:8080` |
| Admin panel | `http://localhost:8080/admin` |
| M1 hazard pre-warn / slow-down | 2000 m / 800 m before the zone |
| Zone half-width (`bufferMeters`) | 60 m around the centerline |
| Direction filter | travel bearing 290° ± 60° (opposite carriageway rejected) |
| Escalation jitter guard | 2 consecutive agreeing fixes |
| De-escalation hysteresis | preWarn + 300 m |
| Acknowledge cooldown | 3 min (engine-side, per hazard) |
| GPS accuracy filter | fixes with accuracy > 100 m dropped |
| SSE keep-alive | comment every 25 s |
| Units convention | distance m · speed km/h · bearing 0–360° · GeoJSON `[lon, lat]` |

### Cloud API (the contract the real cloud must honor)

```
GET    /api/v1/hazards?lat=&lon=&radius=   → active hazards near a point  ← the app's ONLY list query
GET    /api/v1/stream                      → SSE: hazard_created | hazard_updated | hazard_deleted
GET    /api/v1/hazards                     → all hazards incl. inactive   (admin panel only)
GET    /api/v1/hazards/:id                 POST /api/v1/hazards
PATCH  /api/v1/hazards/:id                 DELETE /api/v1/hazards/:id
GET    /health                             → {"ok":true}
```

## Why this architecture

- **Position enters through ONE interface.** The alert engine consumes `PositionFix`
  objects and never knows whether they came from `watchPosition` or simulated playback.
  This is what makes the POC demonstrable at a desk — and it is why the demo can never
  be ruined by a weak GPS signal.
- **The engine is a pure module.** No React, no DOM, no fetch, no timers, no
  `Date.now()` (time comes from fix timestamps). It is fully unit-tested (7 recorded
  scenarios, including opposite-carriageway silence, GPS jitter, and abort-approach) and
  moves unchanged into a future native app.
- **Buffered centerline, not hand-drawn polygons.** A hazard is a polyline traced along
  the real road (the M1 geometry comes from OpenStreetMap) plus a half-width. Authoring
  is trivial and "distance to zone" is one turf call — exactly the number the alert
  tiers need. The polygon drawn on the map is presentation only.
- **Direction awareness.** Every hazard carries a travel bearing + tolerance, so the
  opposite carriageway — the classic false-alarm generator — stays silent.
- **SSE, not WebSocket.** The cloud only ever pushes one way. Server-Sent Events are
  simpler, proxy-friendly, and auto-reconnect in the browser for free.
- **The client already speaks the production contract.** It only ever asks for hazards
  *near itself* (radius query) and listens to the event stream, with all payloads typed
  from `shared/`. Swapping the mock for a real cloud (with a spatial index behind the
  same two endpoints) requires no client change — that seam is the whole point of the
  POC.
- **Active-only invariant.** The client store holds only active hazards; deactivation
  (via SSE) is uniformly "hazard disappeared" → the engine resets that hazard to IDLE.
  One rule, no special cases.
- **Pre-rendered voice, not speech synthesis.** Spoken alerts are neural-TTS MP3 clips
  shipped with the app, so they sound identical (good) on every device. Browser
  `speechSynthesis` depends on device-installed voices and is unacceptably robotic on
  most.

## Quick start

Requirements: Node ≥ 20, npm (workspaces — no global tooling).

```bash
npm install
npm run dev     # starts BOTH: mock cloud (:8080) + client (:5173)
```

| What | URL |
| --- | --- |
| App (start / drive screen) | http://localhost:5173 |
| Admin panel (draw / toggle hazards) | http://localhost:8080/admin |
| Health check | `curl localhost:8080/health` → `{"ok":true}` |

```bash
npm run test        # vitest — the 7 alert-engine scenarios (authoritative acceptance)
npm run typecheck   # tsc --noEmit across shared, server, client
```

## Stakeholder demo script (~5 minutes)

> Every step below is a real action in the current build. **Run the demo in simulation
> mode** — it is deterministic and repeatable. Live GPS is the encore, never the demo
> (see limitations). Project the **admin panel** (`:8080/admin`) on the laptop next to
> the phone/second screen running the app.

**1. Join — nothing to install.**
On the machine driving the demo, open the app through its **LAN or tunnel URL** (not
`localhost` — see [Phone / second-device access](#phone--second-device-access)). The
start screen shows a **QR code in the top-right corner** ("Olvassa be a telefonjával a
csatlakozáshoz" / "Scan to join on your phone"). A phone scans it and lands on the exact
same app in its browser — no install. Pick the language (HU/EN) on the start screen.

**2. Run the simulation — the three-stage warning.**
Tick **"Demó mód (szimulált útvonal az M1-en)"**, tap **Indítás**. The car leaves the
Budapest side of the M1 heading toward Győr — on the real motorway geometry, south of
Tata. Use the transport controls at the bottom to raise playback to **×4** (or ×16) —
buttons are `▶`/`⏸` play/pause, `⟲` restart, `×1 / ×4 / ×16`, and a scrub slider.

- At ~**2 km** the phone chimes, an amber banner takes the screen: **"Veszély
  előttünk"** with a live distance countdown, and a voice says *"Attention! Roadworks ahead."*
- At ~**800 m** it escalates to red **"Lassítson!"**, vibrates, and speaks
  *"Slow down now!"*
- Inside the zone it shows **"Veszélyzónában"** and the advised **80 km/h** limit.
- Past the works it **auto-clears** back to the map.

Tap the overlay once to **acknowledge** — it silences the *current* tier only; a genuine
escalation (e.g. into the zone) still breaks through.

**3. Repeat / rewind — no live driving needed.**
Use the **scrub slider** to jump back to the approach and replay the takeover, or `⟲` to
restart from the top. This is the "the demo always works" moment — the whole run is
driven by the simulator, not a GPS signal.

**4. Live cloud edit — the dynamic map.**
On the **admin panel**, add a new hazard (e.g. an *accident*) on the car's path ahead, or
toggle the M1 construction hazard's **active** flag. Over SSE the phone updates within
~1–2 seconds — the new zone appears on the map and, if it's ahead of the car, the phone
alerts. Toggling it back off removes the zone live. This is the "dynamic cloud map"
moment.

**5. Close — architecture + direction awareness + encore.**
Open the **debug drawer** (bottom-left) to show per-hazard state and distance driving the
alerts. One sentence on **direction awareness**: the opposite carriageway stays silent —
the engine's direction filter rejects traffic heading the wrong way (proven by the
automated test suite; there is no reverse-route button in this build). Close on the
contract point: **the client already queries hazards by radius, so the mock cloud swaps
for the real one with no client change.** The live-GPS local-test hazard (below) is the
on-foot encore.

## Phone / second-device access

Two things a phone needs that `localhost` on the laptop does not provide: it must be able
to **reach** the app, and (for real GPS) the page must be served over a **secure
context**.

### LAN (simulation only — no phone GPS)

`npm run dev` already binds the Vite server to all interfaces (`server.host: true`), so it
prints a **Network** URL like `http://192.168.x.x:5173/`. A phone on the same Wi-Fi can
open that URL directly. **Open the app on the laptop via that same LAN URL too** — the QR
code encodes `window.location.origin`, so if the laptop is on `localhost` the QR points at
`localhost` (useless to the phone). Serve from the LAN IP and the QR points at the LAN IP.

Plain-HTTP LAN gives you the **full simulated demo** on any phone — that is the primary
demo path and needs no GPS.

### Real phone GPS needs HTTPS (secure context)

The browser **Geolocation API refuses to run on an insecure origin**. `localhost` is
exempt, but a `http://192.168.x.x` LAN address is **not** — so real GPS on a phone
requires an HTTPS origin. The simplest way is a quick tunnel that gives you a public HTTPS
URL forwarding to the client port (5173); `/api` still proxies through Vite to the server,
so tunnelling 5173 alone covers the whole app.

> ⚠️ **These are USER-run commands — the build agent does not execute them** (no tunnel
> accounts / binaries are provisioned here). Run one yourself when you want phone GPS:

```bash
# Option A — ngrok
npx ngrok http 5173

# Option B — Cloudflare quick tunnel
cloudflared tunnel --url http://localhost:5173
```

Open the **HTTPS URL the tunnel prints on the laptop**, then scan the QR from that page —
now `window.location.origin` is the HTTPS URL, the phone gets a secure context, and
"Indítás" without demo mode requests real GPS.

**Simulation mode works on any device, over plain HTTP, with no GPS** — that is why the
demo runs on simulation and treats live GPS as the encore.

## Moving the local-test hazard to your street

The seed hazard `local-test` sits in downtown Budapest so you can trigger a real alert on
foot. To move it to your own street, edit `server/data/hazards.json` — the `local-test`
entry:

```jsonc
{
  "id": "local-test",
  "geometry": {
    "type": "LineString",
    "coordinates": [            // NOTE: GeoJSON order is [longitude, latitude]!
      [19.040, 47.4979],
      [19.041, 47.4985],
      [19.042, 47.4991]
    ]
  },
  "bufferMeters": 40,           // half-width of the trigger zone, metres
  "alertDistances": { "preWarn": 300, "slowDown": 120 },  // small = walkable
  ...
}
```

- Replace the `coordinates` with 2–3 points tracing a short stretch of your street.
  **Longitude first, then latitude** — the reverse of what most map UIs show.
- Keep `bufferMeters`, `preWarn`, and `slowDown` small (metres, walking scale).
- The server seeds the store from this file **at startup**, so **restart `npm run dev`**
  after editing.
- Alternatively, use the **admin panel** to draw/drag the hazard live on the map; it
  updates the running store immediately over SSE.

## Known limitations (honest scope)

This is a POC. Its claim is scoped to *"a browser tab open on a dashboard mount"* — state
these proactively; several are exactly the argument for an eventual native app.

- **Foreground-only by design.** A browser tab cannot get GPS or play audio while the
  phone is locked or the tab is backgrounded, and a non-installed web app has no push
  notifications. The drive screen uses the **Screen Wake Lock API** so the display doesn't
  sleep mid-demo; true background alerting is the native-app argument.
- **GPS accuracy & latency.** Urban canyons and the first ~30 s after start give poor
  fixes. An accuracy filter and distance hysteresis absorb most of it; the debug drawer
  makes the rest explainable.
- **Parallel roads.** The direction filter plus buffered-centerline distance rejects the
  opposite carriageway, but a service road running parallel *within the buffer* would
  still trigger. Acceptable for a POC.
- **Battery.** High-accuracy `watchPosition` plus a live map redraw is power-hungry — fine
  for a demo, another native-app motivation.
- **Spoken alerts are English-only, pre-rendered.** Fixed neural-TTS clips in
  `client/public/audio/` (the banner carries the exact numbers and stays bilingual).
  Browser speech synthesis was dropped — its quality depends on device-installed voices
  and is unacceptably robotic on most. Regenerate clips with `edge-tts` if phrases change.
- **Demo insurance.** Never demo on live GPS alone. **Simulation is the demo; live GPS is
  the encore.**

## Future work — swapping the mock cloud for a real one

The client only ever talks to the cloud through the radius query
(`GET /api/v1/hazards?lat&lon&radius`) and the SSE stream (`GET /api/v1/stream`), with all
payloads typed from the shared package. That contract is the seam: **a real cloud can
replace the mock without any client change** — same endpoints, same `Hazard` shape, same
event stream. Deploying that real service (and the client over HTTPS) is future work
beyond this POC.

See `docs/plans/` for the reviewed implementation plan and `CLAUDE.md` for the
architecture rules the codebase enforces.
