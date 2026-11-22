import { PROTOCOL_VERSION } from "@bentogether/shared";

/**
 * Where the realtime Worker lives. Set `VITE_REALTIME_URL` per environment
 * (Vercel project settings for preview and production); local dev defaults
 * to `wrangler dev`.
 */
const raw = (import.meta.env.VITE_REALTIME_URL as string | undefined) ?? "http://localhost:8787";

export const REALTIME_URL = raw.replace(/\/$/, "");

/**
 * The protocol version rides on the URL so the Worker can turn away a tab
 * running an older build before it wakes the box (see `socketVersion`).
 */
export function socketUrl(boxId: string): string {
  return `${REALTIME_URL.replace(/^http/, "ws")}/api/boxes/${boxId}/ws?v=${PROTOCOL_VERSION}`;
}
