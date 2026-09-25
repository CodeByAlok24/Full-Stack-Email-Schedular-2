export const MAX_SEND_GAP_MS = 3_600_000;

function parseNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeMinimumMs(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function resolveDelayBetweenEmailsMs(
  body: Record<string, unknown>,
  fallbackMs: number,
): number | null {
  let requestedMs: number | null;

  if (body.delayBetweenEmails !== undefined) {
    const seconds = parseNonNegativeNumber(body.delayBetweenEmails);
    if (seconds === null) return null;
    requestedMs = Math.floor(seconds * 1000);
  } else if (body.delayBetweenEmailsMs !== undefined) {
    const milliseconds = parseNonNegativeNumber(body.delayBetweenEmailsMs);
    if (milliseconds === null) return null;
    requestedMs = Math.floor(milliseconds);
  } else if (body.delayMs !== undefined) {
    const milliseconds = parseNonNegativeNumber(body.delayMs);
    if (milliseconds === null) return null;
    requestedMs = Math.floor(milliseconds);
  } else {
    requestedMs = normalizeMinimumMs(fallbackMs);
  }

  if (requestedMs === null || requestedMs > MAX_SEND_GAP_MS) return null;
  return Math.max(requestedMs, normalizeMinimumMs(fallbackMs));
}

export function effectiveSendGapMs(requestedMs: unknown, minimumMs: number): number {
  const floorMs = normalizeMinimumMs(minimumMs);
  const requested = parseNonNegativeNumber(requestedMs);
  if (requested === null) return floorMs;
  return Math.max(floorMs, Math.min(MAX_SEND_GAP_MS, Math.floor(requested)));
}
