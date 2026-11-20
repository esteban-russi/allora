/** Firebase App Check token extraction, verification, and Express middleware. */
import type { IncomingMessage } from 'http';
import type { NextFunction, Request, Response } from 'express';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAdminApp } from './firebaseAdmin';
import { defaultMetrics, type MetricsCollector } from './metrics';

export type AppCheckMode = 'off' | 'monitor' | 'enforce';

export interface AppCheckVerifier {
  /**
   * Verify a Firebase App Check token.
   *
   * Args:
   *   token: Raw App Check JWT string.
   *
   * Returns:
   *   True if the token is valid, false otherwise.
   */
  verify(token: string): Promise<boolean>;
}

export interface RequireAppCheckDeps {
  verifier?: AppCheckVerifier;
  mode?: AppCheckMode;
  metrics?: MetricsCollector;
}

/**
 * Determine the active App Check enforcement mode from environment variables.
 *
 * Args:
 *   env: Environment dictionary (defaults to `process.env`).
 *
 * Returns:
 *   'off', 'monitor', or 'enforce'.
 *
 * Raises:
 *   Error: If `APP_CHECK_MODE` has an unexpected value.
 */
export function appCheckMode(env: NodeJS.ProcessEnv = process.env): AppCheckMode {
  const raw = env.APP_CHECK_MODE?.trim() || 'off';
  if (raw === 'off' || raw === 'monitor' || raw === 'enforce') {
    return raw;
  }
  throw new Error(`APP_CHECK_MODE must be "off", "monitor", or "enforce", got "${raw}"`);
}

/**
 * Create a Firebase Admin-backed App Check verifier.
 *
 * Initializes the shared Firebase Admin app lazily on the first verification call
 * and treats any verification error as an invalid token.
 *
 * Args:
 *   env: Process environment overrides for Firebase Admin initialization.
 *
 * Returns:
 *   An AppCheckVerifier backed by `firebase-admin/app-check`.
 */
export function createAppCheckVerifier(env: NodeJS.ProcessEnv = process.env): AppCheckVerifier {
  return {
    async verify(token: string): Promise<boolean> {
      if (!token) return false;
      try {
        await getAppCheck(getAdminApp(env)).verifyToken(token);
        return true;
      } catch {
        return false;
      }
    }
  };
}

/**
 * Extract an App Check token from HTTP headers or WebSocket subprotocol entries.
 *
 * Checks `X-Firebase-AppCheck` first, then falls back to the value following
 * `appcheck` in `Sec-WebSocket-Protocol` (for browsers that cannot set headers
 * on WebSocket upgrades).
 *
 * Args:
 *   req: Incoming HTTP or WebSocket upgrade request.
 *
 * Returns:
 *   The token string, or null if absent.
 */
export function extractAppCheckToken(req: IncomingMessage): string | null {
  const header = req.headers['x-firebase-appcheck'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }

  const protocolHeader = req.headers['sec-websocket-protocol'];
  if (typeof protocolHeader === 'string') {
    const parts = protocolHeader.split(',').map((p) => p.trim());
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === 'appcheck' && parts[i + 1]) {
        return parts[i + 1];
      }
    }
  }

  return null;
}

/**
 * Express middleware enforcing or monitoring Firebase App Check tokens.
 *
 * Args:
 *   deps: Optional verifier, mode, and metrics collector overrides.
 *
 * Returns:
 *   Express middleware handler.
 */
export function requireAppCheck(deps: RequireAppCheckDeps = {}) {
  const verifier = deps.verifier ?? createAppCheckVerifier();
  const metrics = deps.metrics ?? defaultMetrics;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const mode = deps.mode ?? appCheckMode();
    if (mode === 'off') {
      next();
      return;
    }

    const token = extractAppCheckToken(req);
    if (!token) {
      metrics.recordAppCheck('missing');
      if (mode === 'enforce') {
        res.status(401).json({
          error: 'App verification failed',
          code: 'APP_CHECK_REQUIRED'
        });
        return;
      }
      console.warn('[AppCheck] missing token (monitor)');
      next();
      return;
    }

    let valid = false;
    try {
      valid = await verifier.verify(token);
    } catch {
      valid = false;
    }

    if (valid) {
      metrics.recordAppCheck('ok');
      next();
      return;
    }

    metrics.recordAppCheck('failed');
    if (mode === 'enforce') {
      res.status(401).json({
        error: 'App verification failed',
        code: 'APP_CHECK_REQUIRED'
      });
      return;
    }
    console.warn('[AppCheck] invalid token (monitor)');
    next();
  };
}
