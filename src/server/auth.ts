/** Authentication and user identity verification for HTTP and WebSocket requests. */
import type { IncomingMessage } from 'http';
import type { NextFunction, Request, Response } from 'express';
import { createPublicKey, verify } from 'crypto';

export interface AuthenticatedUser {
  userId: string;
  email?: string;
  authProvider: 'firebase' | 'google' | 'dev';
  claims?: Record<string, unknown>;
}

export interface AuthOptions {
  /** Enforce strict verification even in dev/test environments. */
  enforceAuth?: boolean;
  /** Firebase or Google Cloud project ID for audience and issuer validation. */
  projectId?: string;
  /** Google OAuth client ID for Google Identity token audience validation. */
  googleClientId?: string;
  /** Custom certificate resolver, useful for deterministic offline testing. */
  certResolver?: (kid: string) => Promise<string | null>;
}

const DEV_TOKEN_PREFIX = 'dev-token:';

/**
 * Decide whether real token verification is required.
 *
 * Args:
 *   options: Explicit override via `enforceAuth`.
 *
 * Returns:
 *   True when `enforceAuth` is set, `ENFORCE_AUTH=true`, or `NODE_ENV=production`.
 */
export function isAuthEnforced(options: AuthOptions = {}): boolean {
  return options.enforceAuth ?? (process.env.ENFORCE_AUTH === 'true' || process.env.NODE_ENV === 'production');
}

/**
 * Fail fast when auth is enforced but no token audience is configured.
 *
 * Without a project ID or client ID, ID tokens minted for other apps could not be
 * told apart from ours, so every token is rejected; this surfaces that at startup.
 *
 * Args:
 *   options: Authentication configuration options.
 *
 * Raises:
 *   Error: If auth is enforced and neither GCP_PROJECT nor GOOGLE_CLIENT_ID is set.
 */
export function assertAuthConfig(options: AuthOptions = {}): void {
  if (!isAuthEnforced(options)) return;
  const projectId = options.projectId || process.env.GCP_PROJECT;
  const googleClientId = options.googleClientId || process.env.GOOGLE_CLIENT_ID;
  if (!projectId && !googleClientId) {
    throw new Error(
      'Auth is enforced but no token audience is configured: set GCP_PROJECT (Firebase) or GOOGLE_CLIENT_ID (Google Identity)'
    );
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v1/certs';

interface CachedCerts {
  certs: Record<string, string>;
  expiresAt: number;
}

let cachedFirebaseCerts: CachedCerts | null = null;
let cachedGoogleCerts: CachedCerts | null = null;

/**
 * Fetch and cache public X.509 certificates from a Google endpoint.
 *
 * Args:
 *   url: Certificate metadata URL.
 *   currentCache: Existing cache object, if any.
 *
 * Returns:
 *   A map of key IDs to PEM certificates, or empty object on failure.
 */
async function fetchGoogleCerts(
  url: string,
  currentCache: CachedCerts | null
): Promise<Record<string, string>> {
  const now = Date.now();
  if (currentCache && currentCache.expiresAt > now) {
    return currentCache.certs;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) return currentCache?.certs ?? {};

    const maxAgeHeader = res.headers.get('cache-control');
    let maxAgeSec = 3600;
    if (maxAgeHeader) {
      const match = maxAgeHeader.match(/max-age=(\d+)/);
      if (match) maxAgeSec = Number(match[1]);
    }

    const certs = (await res.json()) as Record<string, string>;
    const updated: CachedCerts = {
      certs,
      expiresAt: now + maxAgeSec * 1000
    };

    if (url === FIREBASE_CERTS_URL) cachedFirebaseCerts = updated;
    else cachedGoogleCerts = updated;

    return certs;
  } catch {
    return currentCache?.certs ?? {};
  }
}

/**
 * Split and decode a standard Base64URL-encoded JWT into components.
 *
 * Args:
 *   jwt: Raw JWT string.
 *
 * Returns:
 *   Header, payload, signature buffer, and the signed data string.
 */
export function decodeJwt(jwt: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: Buffer;
  signedData: string;
} | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const signature = Buffer.from(parts[2], 'base64url');
    const signedData = `${parts[0]}.${parts[1]}`;
    return { header, payload, signature, signedData };
  } catch {
    return null;
  }
}

/**
 * Verify RSA-SHA256 signature against an X.509 public certificate.
 *
 * Args:
 *   signedData: Header and payload joined by dot.
 *   signature: Decoded signature buffer.
 *   certPem: PEM-formatted public certificate.
 *
 * Returns:
 *   True if signature matches the public key.
 */
export function verifyRsaSha256(
  signedData: string,
  signature: Buffer,
  certPem: string
): boolean {
  try {
    const publicKey = createPublicKey(certPem);
    return verify('RSA-SHA256', Buffer.from(signedData, 'utf8'), publicKey, signature);
  } catch {
    return false;
  }
}

/**
 * Verify a Firebase Auth or Google Identity ID token.
 *
 * Args:
 *   token: The bearer ID token string.
 *   options: Audience, project, and certificate validation options.
 *
 * Returns:
 *   The verified AuthenticatedUser, or null if validation fails.
 */
export async function verifyIdToken(
  token: string,
  options: AuthOptions = {}
): Promise<AuthenticatedUser | null> {
  if (!token || typeof token !== 'string') return null;

  // Dev tokens are only honoured when real verification is not enforced
  if (token.startsWith(DEV_TOKEN_PREFIX)) {
    if (isAuthEnforced(options)) return null;
    const parts = token.slice(DEV_TOKEN_PREFIX.length).split(':');
    const userId = parts[0] || 'dev-user';
    const email = parts[1] || `${userId}@example.com`;
    return {
      userId,
      email,
      authProvider: 'dev',
      claims: { dev: true }
    };
  }

  const decoded = decodeJwt(token);
  if (!decoded) return null;

  const { header, payload, signature, signedData } = decoded;
  const kid = String(header.kid ?? '');
  const alg = String(header.alg ?? '');
  if (!kid || alg !== 'RS256') return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const exp = Number(payload.exp);
  const iat = Number(payload.iat);

  if (!Number.isFinite(exp) || exp < nowSec) return null;
  if (!Number.isFinite(iat) || iat > nowSec + 300) return null;

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  const userId = typeof payload.user_id === 'string' ? payload.user_id : sub;
  if (!userId) return null;

  const iss = String(payload.iss ?? '');
  const aud = String(payload.aud ?? '');
  const expectedProjectId = options.projectId || process.env.GCP_PROJECT;
  const expectedClientId = options.googleClientId || process.env.GOOGLE_CLIENT_ID;

  // Issuer and audience are always checked: an unset expected audience rejects the
  // token rather than accepting ID tokens minted for any other app.
  let authProvider: 'firebase' | 'google';
  let certsUrl: string;
  let certsCache: CachedCerts | null;
  if (iss === `https://securetoken.google.com/${expectedProjectId}`) {
    if (!expectedProjectId || aud !== expectedProjectId) return null;
    authProvider = 'firebase';
    certsUrl = FIREBASE_CERTS_URL;
    certsCache = cachedFirebaseCerts;
  } else if (iss === 'https://accounts.google.com' || iss === 'accounts.google.com') {
    if (!expectedClientId || aud !== expectedClientId) return null;
    authProvider = 'google';
    certsUrl = GOOGLE_CERTS_URL;
    certsCache = cachedGoogleCerts;
  } else {
    return null;
  }

  const certPem = options.certResolver
    ? await options.certResolver(kid)
    : ((await fetchGoogleCerts(certsUrl, certsCache))[kid] ?? null);

  if (!certPem) return null;

  const isValid = verifyRsaSha256(signedData, signature, certPem);
  if (!isValid) return null;

  return {
    userId,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    authProvider,
    claims: payload
  };
}

/**
 * Extract bearer token from HTTP headers or URL query parameters.
 *
 * Args:
 *   req: Incoming HTTP request.
 *
 * Returns:
 *   Token string, or null if not found.
 */
export function extractTokenFromRequest(req: IncomingMessage): string | null {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  const customHeader = req.headers['x-firebase-token'];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim();
  }

  const url = req.url ?? '';
  try {
    const parsed = new URL(url, 'http://localhost');
    const tokenQuery = parsed.searchParams.get('token') || parsed.searchParams.get('auth_token');
    if (tokenQuery) return tokenQuery.trim();
  } catch {
    // Malformed URL
  }

  // Support Sec-WebSocket-Protocol (e.g. "auth, <token>" or "bearer, <token>")
  const protocolHeader = req.headers['sec-websocket-protocol'];
  if (typeof protocolHeader === 'string') {
    const parts = protocolHeader.split(',').map((p) => p.trim());
    for (let i = 0; i < parts.length; i++) {
      if ((parts[i] === 'auth' || parts[i] === 'bearer') && parts[i + 1]) {
        return parts[i + 1];
      }
    }
  }

  return null;
}

/**
 * Express middleware to authenticate users and protect billed API endpoints.
 *
 * Args:
 *   options: Authentication configuration options.
 *
 * Returns:
 *   Express middleware handler.
 */
export function authenticateHttpUser(options: AuthOptions = {}) {
  const enforceAuth = isAuthEnforced(options);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = extractTokenFromRequest(req);

    if (token) {
      const user = await verifyIdToken(token, options);
      if (user) {
        req.user = user;
        next();
        return;
      }
      res.status(401).json({
        error: 'Unauthorized: Invalid or expired authentication token',
        code: 'AUTH_TOKEN_INVALID'
      });
      return;
    }

    // Dev/Test bypass when auth is not enforced
    if (!enforceAuth) {
      const devUserId = String(req.headers['x-dev-user-id'] ?? 'dev-learner-default');
      req.user = {
        userId: devUserId,
        email: `${devUserId}@example.com`,
        authProvider: 'dev',
        claims: { dev: true }
      };
      next();
      return;
    }

    res.status(401).json({
      error: 'Unauthorized: Authentication required to access tutor services',
      code: 'AUTH_REQUIRED'
    });
  };
}

/**
 * Authenticate incoming WebSocket upgrade requests before establishing bridge.
 *
 * Args:
 *   req: Incoming HTTP upgrade request.
 *   options: Authentication configuration options.
 *
 * Returns:
 *   AuthenticatedUser, or null if unauthenticated.
 */
export async function authenticateWebSocketRequest(
  req: IncomingMessage,
  options: AuthOptions = {}
): Promise<AuthenticatedUser | null> {
  const token = extractTokenFromRequest(req);

  if (token) {
    return await verifyIdToken(token, options);
  }

  if (!isAuthEnforced(options)) {
    const url = req.url ?? '';
    const query = new URL(url, 'http://localhost').searchParams;
    const devUserId = query.get('devUserId') ?? 'dev-learner-default';
    return {
      userId: devUserId,
      email: `${devUserId}@example.com`,
      authProvider: 'dev',
      claims: { dev: true }
    };
  }

  return null;
}
