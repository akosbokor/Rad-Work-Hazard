# M1 Figyelő POC — Build Progress

_Last updated: 2026-07-06 (evening) — updated at every milestone._

Plan: `docs/plans/2026-07-06-road-hazard-poc.md` (v2, supersedes `implementation-plan.md`).

## Done

- ✅ **Plan v2 written** — detailed, per-phase specs with pinned versions, agent assignments, acceptance commands.
- ✅ **Plan adversarially reviewed** by two independent agents (feasibility + spec-completeness lenses); 16 findings, all patched into the plan. Highlights: added missing abort-approach state-machine edge + test scenario; precise `acknowledge()` semantics; pinned store shape across phases 2–4; `alerting.ts` owns engine wiring; turf `{units:'meters'}` rule; `moduleResolution: bundler`; Leaflet marker rotation via divIcon+CSS; machine-verifiable audio signals (`lastSpoken`/`lastVibration`).

- ✅ **Phase 0 — scaffold** (commit `12c333c`): npm workspaces, moduleResolution bundler, shared types byte-exact to plan, vite 6.4.3 single-major, typecheck clean in all 3 workspaces, CLAUDE.md with all conventions. Independent review passed; orchestrator re-verified.
- ✅ **Phase 1 — mock cloud** (commit `b5d96b9`): store + all routes + SSE (verified live: hazard_updated on PATCH) + seed hazards (M1 corridor bearing 255°, local-test Budapest) + admin panel at /admin. Turf calls use `{units:'meters'}`; radius = centerline dist − buffer; active-only on radius endpoint only. Review passed; orchestrator re-verified radius hit/miss + /health.

## In progress

- 🔄 **Phase 2 — map client** (opus builder → opus reviewer workflow).

## Issues / risks

- No ngrok on this machine and no Vercel/Render accounts available to agents → Phase 5 delivers local + LAN run and *written* deploy instructions; actual cloud deploy is a user step.
- Real-GPS acceptance can't run headless → Phase 2 fallback acceptance is seed-hazard rendering + live SSE updates; real GPS is a user field-test.
- Hungarian speechSynthesis voice quality varies by device (POC caveat, not a blocker).

## Next

1. Phase 3 — alert engine, tests first (fable agent; vitest 7 scenarios authoritative).
2. Phase 4 — alert UX (opus; verify via store signals + screenshots).
3. Phase 5 — README/demo/QR polish, final e2e, tag `poc-v1`.

## Deferred nits (from phase reviews, non-blocking)

- Radius endpoint: 400 on non-finite/partial lat-lon-radius params → folded into Phase 2 builder scope.
- `/admin` serves via 301→`/admin/` (express.static default) — fine for browsers.
- v1 `implementation-plan.md` kept at root (v2 plan references its §5.5/§8–10); superseded for execution.
