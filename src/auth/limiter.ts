export const DEFAULT_MAX_FAILURES = 10;
export const DEFAULT_WINDOW_MS = 15 * 60_000;
const DEFAULT_MAX_KEYS = 10_000;

export interface FailureLimiterOptions {
  maxFailures?: number;
  windowMs?: number;
  maxKeys?: number;
  now?: () => number;
}

/**
 * Counts authentication failures per key (the client IP). Once a key reaches `maxFailures`
 * within a window that starts at its first failure, it is blocked until the window ends.
 * Successful requests are not counted.
 */
export class FailureLimiter {
  private readonly windows = new Map<string, { failures: number; resetAt: number }>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: FailureLimiterOptions = {}) {
    this.maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
    this.now = options.now ?? Date.now;
  }

  /** Seconds until `key` may try again, or 0 if it is not blocked. */
  retryAfterSeconds(key: string): number {
    const window = this.windows.get(key);
    if (!window) return 0;
    const remaining = window.resetAt - this.now();
    if (remaining <= 0) {
      this.windows.delete(key);
      return 0;
    }
    return window.failures >= this.maxFailures ? Math.ceil(remaining / 1000) : 0;
  }

  recordFailure(key: string): void {
    const now = this.now();
    const window = this.windows.get(key);
    if (window && window.resetAt > now) {
      window.failures++;
      return;
    }
    if (window) this.windows.delete(key);
    if (this.windows.size >= this.maxKeys) this.prune(now);
    this.windows.set(key, { failures: 1, resetAt: now + this.windowMs });
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
    // Still full: drop the oldest windows (Maps iterate in insertion order).
    for (const key of this.windows.keys()) {
      if (this.windows.size < this.maxKeys) break;
      this.windows.delete(key);
    }
  }
}
