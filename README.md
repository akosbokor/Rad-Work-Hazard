# M1 Figyelő — Road Hazard Alert POC

A phone-browser web app that detects proximity to a hazardous road segment (an M1
motorway construction zone), fetches live hazard data from a mock cloud API, and warns
the driver in time. Fully demonstrable at a desk via route simulation — no real driving
required.

> Status: **Phase 0 (scaffold)**. Feature phases (mock cloud, map client, alert engine,
> alert UX, demo polish) land incrementally. See `docs/plans/` for the implementation
> plan and `CLAUDE.md` for architecture and conventions.

## Requirements

- Node ≥ 20 (dev machine uses v25.2.1)
- npm (workspaces)

## Install

```bash
npm install
```

## Run (dev)

```bash
npm run dev
```

- Client: http://localhost:5173
- Server (mock cloud): http://localhost:8080
- Health check: `curl localhost:8080/health` → `{"ok":true}`

The Vite dev server proxies `/api` → `http://localhost:8080`.

## Typecheck

```bash
npm run typecheck
```

Runs `tsc --noEmit` across `shared`, `server`, and `client`.

## Test

```bash
npm run test
```

## Layout

```
shared/   @m1/shared — shared TypeScript types (no build step)
server/   @m1/server — Express mock cloud (runs under tsx)
client/   @m1/client — Vite + React app (hand-written scaffold)
```
