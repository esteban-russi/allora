/** Shared per-user usage limits and concurrent active call management. */
import type { NextFunction, Request, Response } from 'express';

export const DEFAULT_USER_RPM = 60;
export const MAX_LIVE_CALLS_PER_USER = 1;

interface RateWindow {
  count: number;
  resetAt: number;
}

/** Rate limiter and concurrency tracking keyed by authenticated userId. */
export class UserRateLimiter {
  private userWindows = new Map<string, RateWindow>();
  private activeLiveCalls = new Map<string, Set<string>>(); // userId -> Set of connection/socket IDs

  constructor(
    private maxRpm: number = DEFAULT_USER_RPM,
    private maxConcurrentCalls: number = MAX_LIVE_CALLS_PER_USER,
    private now: () => number = Date.now
  ) {}

  /**
   * Check and consume one rate limit token for a user.
   *
   * Args:
   *   userId: Authenticated user identifier or fallback client key.
   *
   * Returns:
   *   True if within limit, false if limit exceeded.
   */
  consume(userId: string): { allowed: boolean; remaining: number; resetInSec: number } {
    const nowMs = this.now();
    const window = this.userWindows.get(userId);

    if (!window || window.resetAt <= nowMs) {
      this.userWindows.set(userId, {
        count: 1,
        resetAt: nowMs + 60_000
      });
      return {
        allowed: true,
        remaining: this.maxRpm - 1,
        resetInSec: 60
      };
    }

    if (window.count >= this.maxRpm) {
      return {
        allowed: false,
        remaining: 0,
        resetInSec: Math.max(1, Math.ceil((window.resetAt - nowMs) / 1000))
      };
    }

    window.count++;
    return {
      allowed: true,
      remaining: this.maxRpm - window.count,
      resetInSec: Math.max(1, Math.ceil((window.resetAt - nowMs) / 1000))
    };
  }

  /**
   * Register an open live voice call connection for a user.
   *
   * Args:
   *   userId: Authenticated user identifier.
   *   connectionId: Unique ID for this physical WebSocket connection.
   *   sessionId: Target learner session ID.
   *
   * Returns:
   *   True if accepted, false if user has exceeded concurrent call limit.
   */
  acquireLiveCall(userId: string, connectionId: string): boolean {
    const active = this.activeLiveCalls.get(userId) ?? new Set<string>();

    if (active.has(connectionId)) return true;

    if (active.size >= this.maxConcurrentCalls) {
      return false;
    }

    active.add(connectionId);
    this.activeLiveCalls.set(userId, active);
    return true;
  }

  /**
   * Release an active live voice call connection.
   *
   * Args:
   *   userId: Authenticated user identifier.
   *   connectionId: Unique connection ID to release.
   */
  releaseLiveCall(userId: string, connectionId: string): void {
    const active = this.activeLiveCalls.get(userId);
    if (!active) return;

    active.delete(connectionId);
    if (active.size === 0) {
      this.activeLiveCalls.delete(userId);
    }
  }

  /**
   * Count active voice calls for a user.
   *
   * Args:
   *   userId: Authenticated user identifier.
   *
   * Returns:
   *   Number of open calls.
   */
  getActiveCallCount(userId: string): number {
    return this.activeLiveCalls.get(userId)?.size ?? 0;
  }

  /**
   * Clean up expired rate limit windows to avoid unbounded memory growth.
   */
  cleanup(): void {
    const nowMs = this.now();
    for (const [key, window] of this.userWindows.entries()) {
      if (window.resetAt <= nowMs) {
        this.userWindows.delete(key);
      }
    }
  }
}

export const defaultUserLimiter = new UserRateLimiter();

/**
 * Express middleware to enforce per-user rate limits on billed endpoints.
 *
 * Args:
 *   limiter: UserRateLimiter instance.
 *
 * Returns:
 *   Express middleware handler.
 */
export function createUserRateLimitMiddleware(limiter: UserRateLimiter = defaultUserLimiter) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.user?.userId || req.ip || 'anonymous';
    const result = limiter.consume(key);

    res.setHeader('X-RateLimit-Limit', DEFAULT_USER_RPM);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetInSec);

    if (!result.allowed) {
      res.status(429).json({
        error: 'Too many requests for this account. Please slow down.',
        retryAfterSec: result.resetInSec,
        code: 'USER_RATE_LIMIT_EXCEEDED'
      });
      return;
    }

    next();
  };
}
