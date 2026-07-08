import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import type { Hazard, Severity, VehicleFix } from '@m1/shared';
import * as store from './store.js';
import { addClient, removeClient, broadcast } from './sse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(cors()); // allow all origins (POC)
app.use(express.json());

// --- Admin panel (static) ---
app.use('/admin', express.static(path.resolve(__dirname, '../public/admin')));

const shouldPersist = (req: express.Request): boolean => req.query.persist === 'true';

// --- Hazards ---

// GET /api/v1/hazards            → all (admin only)
// GET /api/v1/hazards?lat&lon&radius → active hazards within radius (app client)
app.get('/api/v1/hazards', (req, res) => {
  const { lat, lon, radius } = req.query;
  const anyPresent = lat !== undefined || lon !== undefined || radius !== undefined;
  const allPresent = lat !== undefined && lon !== undefined && radius !== undefined;
  if (anyPresent) {
    // Radius query: all three params must be present and finite, else 400.
    if (!allPresent) {
      res
        .status(400)
        .json({ error: 'lat, lon and radius must all be provided together' });
      return;
    }
    const latN = Number(lat);
    const lonN = Number(lon);
    const radiusN = Number(radius);
    if (!Number.isFinite(latN) || !Number.isFinite(lonN) || !Number.isFinite(radiusN)) {
      res.status(400).json({ error: 'lat, lon and radius must be finite numbers' });
      return;
    }
    const hazards = store.findNear(latN, lonN, radiusN);
    res.json({ hazards });
    return;
  }
  res.json({ hazards: store.getAll() });
});

app.get('/api/v1/hazards/:id', (req, res) => {
  const hazard = store.getById(req.params.id);
  if (!hazard) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(hazard);
});

app.post('/api/v1/hazards', (req, res) => {
  let hazard: Hazard;
  try {
    hazard = store.create(req.body as Partial<Hazard>);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }
  if (shouldPersist(req)) store.persist();
  broadcast({ type: 'hazard_created', hazard });
  res.status(201).json(hazard);
});

app.patch('/api/v1/hazards/:id', (req, res) => {
  const hazard = store.update(req.params.id, req.body as Partial<Hazard>);
  if (!hazard) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (shouldPersist(req)) store.persist();
  broadcast({ type: 'hazard_updated', hazard });
  res.json(hazard);
});

app.delete('/api/v1/hazards/:id', (req, res) => {
  const ok = store.remove(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (shouldPersist(req)) store.persist();
  broadcast({ type: 'hazard_deleted', hazardId: req.params.id });
  res.status(204).end();
});

// --- Vehicles (live tracker) ---
// Latest fix per vehicle id in a simple in-memory Map; entries older than 30 s
// are treated as stale (dropped on GET).
const VEHICLE_TTL_MS = 30_000;
const vehicles = new Map<string, VehicleFix>();

app.post('/api/v1/vehicles', (req, res) => {
  const b = req.body as Partial<VehicleFix>;
  if (typeof b.id !== 'string' || !b.id || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) {
    res.status(400).json({ error: 'id (string) and finite lat/lon are required' });
    return;
  }
  const vehicle: VehicleFix = {
    id: b.id,
    lat: b.lat as number,
    lon: b.lon as number,
    speedKmh: Number.isFinite(b.speedKmh) ? (b.speedKmh as number) : null,
    headingDeg: Number.isFinite(b.headingDeg) ? (b.headingDeg as number) : null,
    timestamp: Number.isFinite(b.timestamp) ? (b.timestamp as number) : Date.now(),
  };
  vehicles.set(vehicle.id, vehicle);
  broadcast({ type: 'vehicle_position', vehicle });
  res.status(204).end();
});

app.get('/api/v1/vehicles', (_req, res) => {
  const cutoff = Date.now() - VEHICLE_TTL_MS;
  const list: VehicleFix[] = [];
  for (const [id, v] of vehicles) {
    if (v.timestamp < cutoff) vehicles.delete(id);
    else list.push(v);
  }
  res.json({ vehicles: list });
});

// --- Admin → driver notification (broadcast only, no storage) ---
app.post('/api/v1/notify', (req, res) => {
  const b = req.body as { text?: unknown; severity?: unknown };
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text || text.length > 200) {
    res.status(400).json({ error: 'text is required and must be 1–200 characters' });
    return;
  }
  const severity: Severity =
    b.severity === 'info' || b.severity === 'danger' ? b.severity : 'warning';
  broadcast({ type: 'admin_message', message: { text, severity, timestamp: Date.now() } });
  res.status(204).end();
});

// --- SSE stream ---
app.get('/api/v1/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  addClient(res);
  req.on('close', () => {
    removeClient(res);
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const PORT = 8080;
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
