/** Tests for authentication, token parsing, and user verification. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage } from 'http';
import { generateKeyPairSync, sign } from 'crypto';
import {
  assertAuthConfig,
  decodeJwt,
  extractTokenFromRequest,
  verifyIdToken,
  verifyRsaSha256
} from '../src/server/auth';

describe('decodeJwt', () => {
  it('correctly decodes standard Base64URL JWT', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'key-1' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'user-123', email: 'test@example.com' })).toString('base64url');
    const token = `${header}.${payload}.mockSignature`;

    const decoded = decodeJwt(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.header).toEqual({ alg: 'RS256', kid: 'key-1' });
    expect(decoded?.payload).toEqual({ sub: 'user-123', email: 'test@example.com' });
    expect(decoded?.signedData).toBe(`${header}.${payload}`);
  });

  it('returns null for malformed tokens', () => {
    expect(decodeJwt('not.a.jwt.with.four.parts')).toBeNull();
    expect(decodeJwt('invalid-base64')).toBeNull();
    expect(decodeJwt('')).toBeNull();
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('verifyIdToken with dev tokens', () => {
  it('accepts dev token fast-path with userId and email', async () => {
    const user = await verifyIdToken('dev-token:marco:marco@roma.it', { enforceAuth: false });
    expect(user).toEqual({
      userId: 'marco',
      email: 'marco@roma.it',
      authProvider: 'dev',
      claims: { dev: true }
    });
  });

  it('defaults email when omitted in dev token', async () => {
    const user = await verifyIdToken('dev-token:giulia', { enforceAuth: false });
    expect(user).toMatchObject({
      userId: 'giulia',
      email: 'giulia@example.com',
      authProvider: 'dev'
    });
  });

  it('rejects dev tokens when auth is enforced', async () => {
    expect(await verifyIdToken('dev-token:victim', { enforceAuth: true })).toBeNull();
  });

  it('rejects dev tokens in production by default', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(await verifyIdToken('dev-token:victim')).toBeNull();
  });
});

describe('verifyIdToken with RSA signature verification', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  function createSignedJwt(payload: Record<string, unknown>, kid = 'test-kid'): string {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url');
    const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signedData = `${header}.${b64Payload}`;

    const signature = sign('RSA-SHA256', Buffer.from(signedData, 'utf8'), privateKey);
    return `${signedData}.${signature.toString('base64url')}`;
  }

  function firebaseClaims(project = 'test-project'): Record<string, unknown> {
    const nowSec = Math.floor(Date.now() / 1000);
    return {
      sub: 'firebase-user-99',
      iss: `https://securetoken.google.com/${project}`,
      aud: project,
      exp: nowSec + 3600,
      iat: nowSec - 10
    };
  }

  function googleClaims(aud: string): Record<string, unknown> {
    const nowSec = Math.floor(Date.now() / 1000);
    return { sub: 'google-user-7', iss: 'https://accounts.google.com', aud, exp: nowSec + 3600, iat: nowSec - 10 };
  }

  const resolver = async (kid: string) => (kid === 'test-kid' ? publicKey : null);

  it('verifies a valid signed JWT using a custom certificate resolver', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = createSignedJwt({
      sub: 'firebase-user-99',
      email: 'student@parliamo.it',
      iss: 'https://securetoken.google.com/test-project',
      aud: 'test-project',
      exp: nowSec + 3600,
      iat: nowSec - 10
    });

    const user = await verifyIdToken(token, {
      projectId: 'test-project',
      certResolver: async (kid) => (kid === 'test-kid' ? publicKey : null)
    });

    expect(user).not.toBeNull();
    expect(user?.userId).toBe('firebase-user-99');
    expect(user?.email).toBe('student@parliamo.it');
  });

  it('rejects an expired token', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expiredToken = createSignedJwt({
      ...firebaseClaims(),
      exp: nowSec - 60, // expired 1 minute ago
      iat: nowSec - 3600
    });

    const user = await verifyIdToken(expiredToken, {
      projectId: 'test-project',
      certResolver: async () => publicKey
    });

    expect(user).toBeNull();
  });

  it('rejects an unknown key ID', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = createSignedJwt({ ...firebaseClaims(), exp: nowSec + 1000, iat: nowSec }, 'unknown-kid');

    const user = await verifyIdToken(token, {
      projectId: 'test-project',
      certResolver: async (kid) => (kid === 'known-kid' ? publicKey : null)
    });

    expect(user).toBeNull();
  });

  it('rejects a Firebase token issued for another project', async () => {
    const token = createSignedJwt(firebaseClaims('other-project'));
    expect(await verifyIdToken(token, { projectId: 'test-project', certResolver: resolver })).toBeNull();
  });

  it('rejects a Firebase token when no project ID is configured', async () => {
    vi.stubEnv('GCP_PROJECT', '');
    const token = createSignedJwt(firebaseClaims());
    expect(await verifyIdToken(token, { certResolver: resolver })).toBeNull();
  });

  it('accepts a Google token whose audience matches the configured client ID', async () => {
    const token = createSignedJwt(googleClaims('our-client'));
    const user = await verifyIdToken(token, { googleClientId: 'our-client', certResolver: resolver });
    expect(user).toMatchObject({ userId: 'google-user-7', authProvider: 'google' });
  });

  it('rejects a Google token minted for another OAuth client', async () => {
    const token = createSignedJwt(googleClaims('someone-elses-client'));
    expect(await verifyIdToken(token, { googleClientId: 'our-client', certResolver: resolver })).toBeNull();
  });

  it('rejects a Google token when no client ID is configured', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    const token = createSignedJwt(googleClaims('any-client'));
    expect(await verifyIdToken(token, { certResolver: resolver })).toBeNull();
  });
});

describe('assertAuthConfig', () => {
  it('throws when auth is enforced without any token audience', () => {
    vi.stubEnv('GCP_PROJECT', '');
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    expect(() => assertAuthConfig({ enforceAuth: true })).toThrow(/no token audience/);
  });

  it('passes when auth is enforced and a project ID is configured', () => {
    expect(() => assertAuthConfig({ enforceAuth: true, projectId: 'test-project' })).not.toThrow();
  });

  it('does nothing when auth is not enforced', () => {
    vi.stubEnv('GCP_PROJECT', '');
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    expect(() => assertAuthConfig({ enforceAuth: false })).not.toThrow();
  });
});

describe('extractTokenFromRequest', () => {
  it('extracts token from standard Authorization Bearer header', () => {
    const req = {
      headers: { authorization: 'Bearer my-secret-jwt-token' }
    } as unknown as IncomingMessage;

    expect(extractTokenFromRequest(req)).toBe('my-secret-jwt-token');
  });

  it('extracts token from x-firebase-token header', () => {
    const req = {
      headers: { 'x-firebase-token': 'firebase-token-123' }
    } as unknown as IncomingMessage;

    expect(extractTokenFromRequest(req)).toBe('firebase-token-123');
  });

  it('ignores tokens in the URL so they stay out of request logs', () => {
    const req = {
      headers: {},
      url: '/api/live?sampleRate=16000&token=ws-url-token'
    } as unknown as IncomingMessage;

    expect(extractTokenFromRequest(req)).toBeNull();
  });

  it('extracts token from Sec-WebSocket-Protocol header', () => {
    const req = {
      headers: { 'sec-websocket-protocol': 'auth, bearer-ws-token-456' }
    } as unknown as IncomingMessage;

    expect(extractTokenFromRequest(req)).toBe('bearer-ws-token-456');
  });

  it('returns null when no token is present', () => {
    const req = {
      headers: {},
      url: '/api/chat'
    } as unknown as IncomingMessage;

    expect(extractTokenFromRequest(req)).toBeNull();
  });
});
