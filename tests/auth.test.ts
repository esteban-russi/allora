/** Tests for authentication, token parsing, and user verification. */
import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'http';
import { generateKeyPairSync } from 'crypto';
import {
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

describe('verifyIdToken with dev tokens', () => {
  it('accepts dev token fast-path with userId and email', async () => {
    const user = await verifyIdToken('dev-token:marco:marco@roma.it');
    expect(user).toEqual({
      userId: 'marco',
      email: 'marco@roma.it',
      authProvider: 'dev',
      claims: { dev: true }
    });
  });

  it('defaults email when omitted in dev token', async () => {
    const user = await verifyIdToken('dev-token:giulia');
    expect(user).toMatchObject({
      userId: 'giulia',
      email: 'giulia@example.com',
      authProvider: 'dev'
    });
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

    const { sign } = require('crypto');
    const signature = sign('RSA-SHA256', Buffer.from(signedData, 'utf8'), privateKey);
    return `${signedData}.${signature.toString('base64url')}`;
  }

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
      sub: 'user-old',
      exp: nowSec - 60, // expired 1 minute ago
      iat: nowSec - 3600
    });

    const user = await verifyIdToken(expiredToken, {
      certResolver: async () => publicKey
    });

    expect(user).toBeNull();
  });

  it('rejects an unknown key ID', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = createSignedJwt(
      { sub: 'user-test', exp: nowSec + 1000, iat: nowSec },
      'unknown-kid'
    );

    const user = await verifyIdToken(token, {
      certResolver: async (kid) => (kid === 'known-kid' ? publicKey : null)
    });

    expect(user).toBeNull();
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

  it('extracts token from URL search parameter', () => {
    const req = {
      headers: {},
      url: '/api/live?sampleRate=16000&token=ws-url-token'
    } as unknown as IncomingMessage;

    expect(extractTokenFromRequest(req)).toBe('ws-url-token');
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
