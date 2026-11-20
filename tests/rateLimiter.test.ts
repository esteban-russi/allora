/** Tests for shared per-user usage limits and concurrent call management. */
import { describe, expect, it } from 'vitest';
import { UserRateLimiter, createUserRateLimitMiddleware } from '../src/platform/server/rateLimiter';
import type { Request, Response } from 'express';

describe('UserRateLimiter', () => {
  it('allows requests within the configured RPM limit', () => {
    let now = 100_000;
    const limiter = new UserRateLimiter(3, 1, () => now);

    const r1 = limiter.consume('user-1');
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = limiter.consume('user-1');
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = limiter.consume('user-1');
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    const r4 = limiter.consume('user-1');
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it('resets rate limit window after 60 seconds', () => {
    let now = 100_000;
    const limiter = new UserRateLimiter(2, 1, () => now);

    limiter.consume('user-reset');
    limiter.consume('user-reset');
    expect(limiter.consume('user-reset').allowed).toBe(false);

    now += 60_001;
    const afterWindow = limiter.consume('user-reset');
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.remaining).toBe(1);
  });

  it('enforces maximum concurrent live voice calls per user', () => {
    const limiter = new UserRateLimiter(60, 1);

    const call1 = limiter.acquireLiveCall('user-voice', 'socket-1');
    expect(call1).toBe(true);

    // Second call on a different socket is rejected
    const call2 = limiter.acquireLiveCall('user-voice', 'socket-2');
    expect(call2).toBe(false);

    // Same socket reconnecting is allowed
    const sameCall = limiter.acquireLiveCall('user-voice', 'socket-1');
    expect(sameCall).toBe(true);

    // Releasing call1 allows another call
    limiter.releaseLiveCall('user-voice', 'socket-1');
    const call3 = limiter.acquireLiveCall('user-voice', 'socket-2');
    expect(call3).toBe(true);
  });
});

describe('createUserRateLimitMiddleware', () => {
  it('attaches rate limit headers and calls next() when within limit', () => {
    const limiter = new UserRateLimiter(10, 1);
    const middleware = createUserRateLimitMiddleware(limiter);

    const req = { user: { userId: 'req-user' } } as unknown as Request;
    const headers: Record<string, unknown> = {};
    const res = {
      setHeader: (k: string, v: unknown) => {
        headers[k] = v;
      },
      status: () => res,
      json: () => undefined
    } as unknown as Response;

    let nextCalled = false;
    middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(headers['X-RateLimit-Limit']).toBe(60);
    expect(headers['X-RateLimit-Remaining']).toBe(9);
  });

  it('returns 429 when per-user rate limit is exceeded', () => {
    const limiter = new UserRateLimiter(1, 1);
    const middleware = createUserRateLimitMiddleware(limiter);

    const req = { user: { userId: 'exhausted-user' } } as unknown as Request;
    const res = {
      setHeader: () => undefined,
      status: (code: number) => ({
        json: (payload: any) => {
          expect(code).toBe(429);
          expect(payload.code).toBe('USER_RATE_LIMIT_EXCEEDED');
        }
      })
    } as unknown as Response;

    // First request passes
    middleware(req, res, () => undefined);

    // Second request is blocked
    let nextCalled = false;
    middleware(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
  });
});
