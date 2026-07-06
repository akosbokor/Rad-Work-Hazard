# M1 Figyelő — Road Hazard Alert POC

A phone-browser web app that detects proximity to a hazardous road segment (an M1
motorway construction zone), fetches live hazard data from a mock cloud API, and warns
the driver in time to slow down. **Fully demonstrable at a desk via route simulation —
no real driving required.**

The app is bilingual (Hungarian primary, English fallback — toggle on the start screen)
and runs entirely in the browser. The "cloud" is a local Express mock that behaves like
the future real one; the client already speaks the exact radius-query contract the real
cloud will expose.

## Requirements

- Node ≥ 20 (dev machine uses v25.2.1)
- npm (workspaces — no extra global tooling)

## Quick start

```bash
npm install
npm run dev
```

`npm run dev` starts both processes (Vite client + Express mock cloud) with one command:

| What | URL |
| --- | --- |
| App (start / drive screen) | http://localhost:5173 |
| Mock cloud API | http://localhost:8080 |
| **Admin panel** (map, draw/toggle hazards) | http://localhost:8080/admin |
| Health check | `curl localhost:8080/health` → `{"ok":true}` |

The Vite dev server proxies `/api` → `http://localhost:8080`, so the whole app is
reachable through the single client port (5173) — this matters for phone/tunnel access
below.

Other scripts:

```bash
npm run typecheck   # tsc --noEmit across shared, server, client
npm run test        # vitest — the 7 alert-engine scenarios (authoritative acceptance)
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
Budapest side of the M1 heading toward Győr. Use the transport controls at the bottom to
raise playback to **×4** (or ×16) — buttons are `⏸` play/pause, `⟲` restart, `×1 / ×4 /
×16`, and a scrub slider.

- At ~**2 km** the phone chimes and an amber banner takes the screen: **"Veszély
  előttünk"** with a live distance countdown.
- At ~**800 m** it escalates to red **"Lassítson!"**, vibrates, and speaks
  *"Lassítson 80-ra. Útépítés … méterre."*
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
- **Speech-synthesis quality.** Hungarian TTS voice quality varies by device, so speech is
  always paired with the visual banner and the chime.
- **Demo insurance.** Never demo on live GPS alone. **Simulation is the demo; live GPS is
  the encore.**

## Future work — swapping the mock cloud for a real one

The client only ever talks to the cloud through the radius query
(`GET /api/v1/hazards?lat&lon&radius`) and the SSE stream (`GET /api/v1/stream`), with all
payloads typed from the shared package. That contract is the seam: **a real cloud can
replace the mock without any client change** — same endpoints, same `Hazard` shape, same
event stream. Deploying that real service (and the client over HTTPS) is future work
beyond this POC.

## Layout

```
shared/   @m1/shared — shared TypeScript types (no build step)
server/   @m1/server — Express mock cloud + admin panel (runs under tsx)
client/   @m1/client — Vite + React app (start screen, Leaflet drive screen, alert engine)
```

See `docs/plans/` for the implementation plan and `CLAUDE.md` for architecture rules and
conventions.
