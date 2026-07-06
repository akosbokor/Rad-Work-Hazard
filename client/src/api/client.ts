import type { Hazard, HazardStreamEvent } from '@m1/shared';

export type ConnectionState = 'connecting' | 'live' | 'lost';

/**
 * Fetch active hazards whose zone is within `radiusM` of (lat, lon).
 * Goes through the Vite `/api` proxy → server 8080. This is the ONLY list
 * endpoint the app client may call (the unfiltered list is admin-only).
 */
export async function fetchHazardsNear(
  lat: number,
  lon: number,
  radiusM: number,
): Promise<Hazard[]> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    radius: String(radiusM),
  });
  const res = await fetch(`/api/v1/hazards?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`fetchHazardsNear failed: ${res.status}`);
  }
  const data = (await res.json()) as { hazards: Hazard[] };
  return data.hazards;
}

export interface StreamHandle {
  close: () => void;
}

const RECONNECT_DELAY_MS = 2000;

/**
 * Subscribe to the hazard SSE stream via EventSource with auto-reconnect.
 * `onEvent` receives each parsed HazardStreamEvent; `onConnection` receives
 * connection-state transitions ('connecting' | 'live' | 'lost').
 */
export function subscribeToStream(
  onEvent: (event: HazardStreamEvent) => void,
  onConnection?: (state: ConnectionState) => void,
): StreamHandle {
  let es: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const connect = (): void => {
    if (closed) return;
    onConnection?.('connecting');
    es = new EventSource('/api/v1/stream');

    es.onopen = () => {
      if (!closed) onConnection?.('live');
    };

    es.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data) as HazardStreamEvent);
      } catch {
        // ignore keep-alive comments / malformed frames
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects, but we close and reconnect on our own
      // schedule so the connection-state callback stays accurate.
      onConnection?.('lost');
      es?.close();
      es = null;
      if (!closed) {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };
  };

  connect();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
      es = null;
    },
  };
}
