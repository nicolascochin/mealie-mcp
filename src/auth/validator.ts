import { createHash } from 'node:crypto';
import { MealieClient } from '../mealie/client.js';
import { MealieError } from '../mealie/errors.js';
import type { MealieUser } from '../mealie/types.js';

export const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_ENTRIES = 1000;

export type ValidationResult =
  | { ok: true; user: MealieUser }
  /** Mealie refused the token. */
  | { ok: false; reason: 'invalid_token' }
  /** Mealie could not tell: unreachable, timed out or failed. */
  | { ok: false; reason: 'unavailable'; error: MealieError };

export interface TokenValidatorOptions {
  mealieUrl: string;
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

/**
 * Checks Mealie API tokens with `GET /api/users/self`. Valid tokens are remembered for a few
 * minutes, keyed by the SHA-256 of the token: the token itself is never kept.
 */
export class TokenValidator {
  private readonly cache = new Map<string, { user: MealieUser; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(private readonly options: TokenValidatorOptions) {
    this.ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  async validate(token: string): Promise<ValidationResult> {
    const key = createHash('sha256').update(token).digest('hex');
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return { ok: true, user: cached.user };
    if (cached) this.cache.delete(key);

    let user: MealieUser;
    try {
      user = await new MealieClient({ baseUrl: this.options.mealieUrl, token }).getSelf();
    } catch (err) {
      if (err instanceof MealieError && err.kind === 'http' && (err.status === 401 || err.status === 403)) {
        return { ok: false, reason: 'invalid_token' };
      }
      if (err instanceof MealieError) return { ok: false, reason: 'unavailable', error: err };
      throw err;
    }

    if (this.cache.size >= this.maxEntries) {
      // Maps iterate in insertion order: drop the oldest entry.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { user, expiresAt: this.now() + this.ttlMs });
    return { ok: true, user };
  }
}
