/** Short-term memory of Vertex AI models that keep failing, so requests go straight to AI Studio. */

const DEFAULT_COOLDOWN_MS = 5 * 60_000;
const MAX_LOG_MESSAGE_LENGTH = 200;

/** Tracks, per model, until when Vertex AI should be skipped. */
export class VertexCooldown {
  private skipUntil = new Map<string, number>();

  constructor(private cooldownMs: number = DEFAULT_COOLDOWN_MS, private now: () => number = Date.now) {}

  /** Whether Vertex AI is currently being skipped for `model`. */
  isCoolingDown(model: string): boolean {
    const until = this.skipUntil.get(model);
    if (until === undefined) return false;
    if (this.now() < until) return true;
    this.skipUntil.delete(model);
    return false;
  }

  /** Skip Vertex AI for `model` for the cooldown period. */
  trip(model: string): void {
    this.skipUntil.set(model, this.now() + this.cooldownMs);
  }

  get cooldownMinutes(): number {
    return Math.round(this.cooldownMs / 60_000);
  }
}

/**
 * Whether a Vertex AI error will keep happening if retried.
 *
 * Bad request, auth, permission and not-found errors come from configuration
 * (IAM, region, model name), not load, so retrying every request only adds latency.
 *
 * Args:
 *   err: The error thrown by the Gemini SDK.
 *
 * Returns:
 *   True for HTTP 400, 401, 403 and 404 responses.
 */
export function isPersistentVertexError(err: unknown): boolean {
  const status = Number((err as { status?: unknown })?.status);
  return [400, 401, 403, 404].includes(status);
}

/**
 * One-line summary of a Gemini SDK error for logs.
 *
 * The SDK puts the whole JSON response in `message`; keep just the inner
 * `error.message`, truncated.
 *
 * Args:
 *   err: Any thrown value.
 *
 * Returns:
 *   A message of at most 200 characters.
 */
export function summarizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  let message = raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.error?.message === 'string') message = parsed.error.message;
  } catch {
    // Not JSON; use the raw message
  }
  message = message.replace(/\s+/g, ' ').trim();
  return message.length > MAX_LOG_MESSAGE_LENGTH ? `${message.slice(0, MAX_LOG_MESSAGE_LENGTH - 1)}…` : message;
}
