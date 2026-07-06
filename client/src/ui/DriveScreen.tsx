import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polygon, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { buffer, distance as turfDistance, lineString, point } from '@turf/turf';
import type { Hazard, Severity } from '@m1/shared';
import { useAppStore } from '../store';
import { fetchHazardsNear, subscribeToStream } from '../api/client';
import type { PositionProvider } from '../providers/types';
import { SimulatedProvider } from '../providers/SimulatedProvider';
import { StatusStrip } from './StatusStrip';
import { SimControls } from './SimControls';
import { AlertOverlay } from './AlertOverlay';
import { DebugDrawer } from './DebugDrawer';
import { useWakeLock } from './useWakeLock';
import { t } from '../i18n';

const FETCH_RADIUS_M = 5000;
const REFETCH_INTERVAL_MS = 30_000;
const REFETCH_MOVE_M = 2000;
// When no real fix is available yet (e.g. headless/desktop), centre near the
// local-test seed so the map and its zone still render.
const DEFAULT_CENTER: [number, number] = [47.4985, 19.041];

const SEVERITY_COLORS: Record<Severity, string> = {
  info: '#3b82f6',
  warning: '#f59e0b',
  danger: '#ef4444',
};

const ARROW_SVG =
  '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">' +
  '<path d="M12 2 L20 21 L12 16 L4 21 Z" fill="#38bdf8" stroke="#0b0f14" stroke-width="1.5" stroke-linejoin="round"/>' +
  '</svg>';

/** L.divIcon carrying an inline SVG arrow, rotated via CSS by headingDeg. */
function carIcon(headingDeg: number | null): L.DivIcon {
  const rotation = headingDeg ?? 0;
  return L.divIcon({
    className: 'car-marker',
    html: `<div class="car-marker-inner" style="transform: rotate(${rotation}deg)">${ARROW_SVG}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** Buffer a hazard centerline into presentation polygons (lat/lon outer rings). */
function hazardZoneRings(hazard: Hazard): [number, number][][] {
  const line = lineString(hazard.geometry.coordinates);
  const buffered = buffer(line, hazard.bufferMeters, { units: 'meters' });
  if (!buffered) return [];
  const g = buffered.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys.map((poly) =>
    (poly[0] as [number, number][]).map(([lon, lat]) => [lat, lon] as [number, number]),
  );
}

/** Auto-pan the map to the latest fix while follow-mode is on. */
function FollowController({ target, follow }: { target: [number, number] | null; follow: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (follow && target) map.panTo(target, { animate: true });
  }, [map, follow, target]);
  return null;
}

export function DriveScreen({ provider }: { provider: PositionProvider }) {
  const hazards = useAppStore((s) => s.hazards);
  const lastFix = useAppStore((s) => s.lastFix);
  const [follow, setFollow] = useState(true);
  useWakeLock();

  // Session lifecycle: SSE stream, GPS provider, and hazard refetch loop.
  useEffect(() => {
    let cancelled = false;
    let lastFetchPos: { lat: number; lon: number } | null = null;

    async function refetch(lat: number, lon: number): Promise<void> {
      try {
        const fetched = await fetchHazardsNear(lat, lon, FETCH_RADIUS_M);
        if (cancelled) return;
        useAppStore.getState().setHazards(fetched);
        lastFetchPos = { lat, lon };
      } catch (err) {
        console.warn('[DriveScreen] hazard fetch failed:', err);
      }
    }

    const stream = subscribeToStream(
      (event) => useAppStore.getState().applyStreamEvent(event),
      (state) => useAppStore.getState().setConnection(state),
    );

    provider.start((fix) => useAppStore.getState().pushFix(fix));

    const first = useAppStore.getState().lastFix;
    void refetch(first?.lat ?? DEFAULT_CENTER[0], first?.lon ?? DEFAULT_CENTER[1]);

    const interval = setInterval(() => {
      const f = useAppStore.getState().lastFix;
      void refetch(f?.lat ?? DEFAULT_CENTER[0], f?.lon ?? DEFAULT_CENTER[1]);
    }, REFETCH_INTERVAL_MS);

    // Refetch when the driver has moved ≥ 2 km since the last fetch.
    const unsub = useAppStore.subscribe((state, prev) => {
      const f = state.lastFix;
      if (!f || f === prev.lastFix) return;
      if (!lastFetchPos) {
        void refetch(f.lat, f.lon);
        return;
      }
      const moved = turfDistance(
        point([lastFetchPos.lon, lastFetchPos.lat]),
        point([f.lon, f.lat]),
        { units: 'meters' },
      );
      if (moved >= REFETCH_MOVE_M) void refetch(f.lat, f.lon);
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsub();
      stream.close();
      provider.stop();
    };
  }, [provider]);

  const carPos = useMemo<[number, number] | null>(
    () => (lastFix ? [lastFix.lat, lastFix.lon] : null),
    [lastFix],
  );
  const initialCenter = carPos ?? DEFAULT_CENTER;

  return (
    <div className="drive-screen">
      <StatusStrip />
      <MapContainer
        center={initialCenter}
        zoom={14}
        className="map"
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {hazards.map((hazard) =>
          hazardZoneRings(hazard).map((ring, i) => (
            <Polygon
              key={`${hazard.id}-${i}`}
              positions={ring}
              pathOptions={{
                color: SEVERITY_COLORS[hazard.severity],
                fillColor: SEVERITY_COLORS[hazard.severity],
                fillOpacity: 0.25,
                weight: 2,
              }}
            />
          )),
        )}
        {carPos && (
          <Marker position={carPos} icon={carIcon(lastFix?.headingDeg ?? null)} />
        )}
        <FollowController target={carPos} follow={follow} />
      </MapContainer>
      <button
        type="button"
        className={`follow-toggle ${follow ? 'on' : ''}`}
        onClick={() => setFollow((v) => !v)}
      >
        {follow ? t('drive.followOn') : t('drive.followOff')}
      </button>
      {provider instanceof SimulatedProvider && <SimControls provider={provider} />}
      <AlertOverlay />
      <DebugDrawer />
    </div>
  );
}
