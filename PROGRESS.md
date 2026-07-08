# M1 Figyelő POC — Build Progress

_Last updated: 2026-07-06 (late evening) — updated at every milestone._

Plan: `docs/plans/2026-07-06-road-hazard-poc.md` (v2, supersedes `implementation-plan.md`).

## Done

- ✅ **Plan v2 written** — detailed, per-phase specs with pinned versions, agent assignments, acceptance commands.
- ✅ **Plan adversarially reviewed** by two independent agents (feasibility + spec-completeness lenses); 16 findings, all patched into the plan. Highlights: added missing abort-approach state-machine edge + test scenario; precise `acknowledge()` semantics; pinned store shape across phases 2–4; `alerting.ts` owns engine wiring; turf `{units:'meters'}` rule; `moduleResolution: bundler`; Leaflet marker rotation via divIcon+CSS; machine-verifiable audio signals (`lastSpoken`/`lastVibration`).

- ✅ **Phase 0 — scaffold** (commit `12c333c`): npm workspaces, moduleResolution bundler, shared types byte-exact to plan, vite 6.4.3 single-major, typecheck clean in all 3 workspaces, CLAUDE.md with all conventions. Independent review passed; orchestrator re-verified.
- ✅ **Phase 1 — mock cloud** (commit `b5d96b9`): store + all routes + SSE (verified live: hazard_updated on PATCH) + seed hazards (M1 corridor bearing 255°, local-test Budapest) + admin panel at /admin. Turf calls use `{units:'meters'}`; radius = centerline dist − buffer; active-only on radius endpoint only. Review passed; orchestrator re-verified radius hit/miss + /health.

- ✅ **Phase 2 — map client** (commits `c1e712e`, `5efb0ba`): Leaflet drive screen (divIcon car marker with CSS heading rotation, turf-buffered zone polygons), RealGpsProvider (m/s→km/h, heading fallback, accuracy filter), SSE client with auto-reconnect + active-only invariant, pinned store shape live on `window.__store`. Reviewer verified headless in Playwright: map renders, store keys exact, SSE removal within ~1.5 s, radius proxy works, bad-param 400 hardening in place. One nit (geolocation priming outside providers/) fixed by orchestrator in `5efb0ba`.

- ✅ **Phase 3 — alert engine + simulation** (commits `8587b3b`, `8213715`): pure engine built tests-first, 7/7 scenarios green; purity verified (no DOM/fetch/Date.now, time from fix.timestamp only). Browser-verified progression: APPROACHING @1831 m → SLOW_DOWN @639 m → IN_ZONE → PASSED; reverse route silent (637 fixes). SimulatedProvider + routes + SimControls + alerting.ts glue + demo-mode toggle. Orchestrator fixes: monotonic sim clock across restart/scrub (was: ack cooldown could mute a restarted demo); removed an unspecced de-escalation edge (simplicity rule).

- ✅ **Phase 4 — alert UX** (commits `fce06b0`, `0011c4d`): full-screen overlay (amber APPROACHING → red SLOW_DOWN/IN_ZONE, live countdown, tap-to-ack, ≥48 px targets, reduced-motion), oscillator chime + Hungarian speechSynthesis (en fallback), vibration, HU/EN i18n with start-screen toggle, debug drawer, wake lock. Reviewer verified in Playwright: overlay at ~1922 m, correct spoken templates in lastSpoken, vibration [300,100,300], ack/re-escalation correct, admin deactivation cleared overlay in 13 ms. (Reviewer's structured output was garbled; real verdict recovered from its transcript — full pass + 2 nits.) Orchestrator applied nits in `0011c4d`: removed dead onEngineEvent scaffolding, moved last hardcoded strings to i18n.

- ✅ **Phase 5 — demo polish** (commit `592e02c`): full README (quick start incl. `/admin`, verified 5-step demo script, phone/LAN + HTTPS-secure-context + ngrok/cloudflared USER-run tunnel notes, how to move the `local-test` hazard, honest limitations, mock→real cloud future-work note); `qrcode` client dep + `QrJoin` corner QR on the start screen encoding `window.location.origin` with HU/EN caption. Verified end-to-end in Playwright: QR renders (data-URL, HU+EN captions), admin loads at :8080/admin, sim run IDLE→APPROACHING→SLOW_DOWN→IN_ZONE with spoken HU templates + vibration [300,100,300]. typecheck clean, 7/7 tests green, dev boots. **POC complete.**

## Post-v1 improvements (2026-07-06 evening, commit `80bae93`)

- **Real M1 geometry**: replaced the straight-line placeholder centerline with the actual westbound carriageway traced from OpenStreetMap (Overpass API, 19 points, Concó↔Tata), updated in all three copies (hazards.json, routes.ts, test fixtures); `direction.bearingDeg` corrected 255°→290°. Verified: 7/7 tests green, live sim shows the car on the motorway, alerts fire at the same distances.
- **Voice quality**: `speak()` now picks a voice for the CURRENT language (English text was previously spoken by a Hungarian voice) and ranks candidates by quality (natural/neural/enhanced/Google preferred, macOS novelty voices last). Ceiling is still the device's installed voices — installing an enhanced system voice (e.g. iOS/macOS Settings → Spoken Content) improves it further.
- **Neural-TTS spoken alerts** (commit `4907887`, reviewed PASS): speechSynthesis dropped entirely — spoken alerts are 5 pre-rendered English clips (`client/public/audio/*.mp3`, voice `en-US-AriaNeural`, generated with `edge-tts`), decoded on unlockAudio() and played via the AudioContext 0.45 s after the chime. Fixed phrases per tier/hazard-type ("Attention! Roadworks ahead." / "Slow down now!"); the banner carries the exact numbers and stays bilingual. `lastSpoken` now records the clip transcript. Graceful if a clip hasn't decoded yet. Regenerate with `python3 -m edge_tts --voice en-US-AriaNeural --rate +5% --text "..." --write-media <name>.mp3` if phrases change.
- **Fleet + messaging round** (commits `858b381`+, 2026-07-08): live vehicle tracker — the client POSTs its fix every 2 s (`/api/v1/vehicles`), the admin map shows moving car markers per device (30 s TTL); admin "Message to drivers" (`/api/v1/notify`) → severity toast + chime + vibration + system Notification on every phone; SLOW_DOWN also raises a system Notification. Reviewed PASS (one low finding — vehicles-map eviction on POST — fixed). Platform note: iOS browsers support neither vibration nor (non-installed) notifications; Android Chrome supports both.
- **Demo realism round** (commit `b557f7d`, 2026-07-08): sim route rebuilt from real M1 geometry end-to-end (28 pts, 22.9 km, ~5 km lead-in before the zone — car is on the motorway from the first second); vibration also fires on zone entry; admin draw tool snaps clicked points along the road via OSRM public routing (straight-line fallback offline). Live-verified: alerts at 1962 m/SLOW_DOWN/PASSED unchanged. Repo now on GitHub: https://github.com/akosbokor/Rad-Work-Hazard
- Earlier geometry+voice changes independently reviewed: **PASS** (all 18 drive-segment bearings within 290°±60°, opposite carriageway rejected, three centerline copies byte-identical, voice fallback safe with zero voices). Stale comments refreshed in `e272602`. Note for future edits: the centerline exists in 3 synced copies (hazards.json, routes.ts, fixtures.ts) — change all three together.
- Dev servers currently stopped; `npm run dev` relaunches (app :5173, admin :8080/admin).

## In progress

- _(none — all five phases complete)_

## Issues / risks

- No ngrok on this machine and no Vercel/Render accounts available to agents → Phase 5 delivers local + LAN run and *written* deploy instructions; actual cloud deploy is a user step.
- Real-GPS acceptance can't run headless → Phase 2 fallback acceptance is seed-hazard rendering + live SSE updates; real GPS is a user field-test.
- Hungarian speechSynthesis voice quality varies by device (POC caveat, not a blocker).

## Next (user steps)

1. Field test: open the app on a phone (see README phone-access section — HTTPS tunnel needed for real GPS) and walk/drive the `local-test` hazard after moving it near your address.
2. Optional cloud deploy (Vercel client + Render/Fly server) per README — makes the QR-code join work for any stakeholder phone.
3. Demo dry-run using the README's 5-step script (simulation is the demo; live GPS is the encore).

## Deferred nits (from phase reviews, non-blocking)

- Radius endpoint: 400 on non-finite/partial lat-lon-radius params → folded into Phase 2 builder scope.
- `/admin` serves via 301→`/admin/` (express.static default) — fine for browsers.
- v1 `implementation-plan.md` kept at root (v2 plan references its §5.5/§8–10); superseded for execution.
