import type { Response } from 'express';
import type { HazardStreamEvent } from '@m1/shared';

/** Registry of connected SSE clients (raw Express responses). */
const clients = new Set<Response>();

export function addClient(res: Response): void {
  clients.add(res);
}

export function removeClient(res: Response): void {
  clients.delete(res);
}

export function clientCount(): number {
  return clients.size;
}

/** Broadcast a hazard stream event to every connected client. */
export function broadcast(event: HazardStreamEvent): void {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    res.write(frame);
  }
}

// 25 s keep-alive comment so proxies/browsers don't drop idle connections.
const KEEP_ALIVE_MS = 25_000;
setInterval(() => {
  for (const res of clients) {
    res.write(`: keep-alive\n\n`);
  }
}, KEEP_ALIVE_MS).unref();
