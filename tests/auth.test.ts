import { http, HttpResponse } from 'msw';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { parseBearer } from '../src/auth/bearer.js';
import { FailureLimiter } from '../src/auth/limiter.js';
import { TokenValidator } from '../src/auth/validator.js';
import { clientIp } from '../src/http/client-ip.js';
import { TEST_MEALIE_URL } from './helpers/app.js';
import { mealie, mealieUrl, TEST_USER, VALID_TOKEN } from './helpers/mealie.js';

describe('parseBearer', () => {
  it.each([
    ['Bearer abc.def', 'abc.def'],
    ['bearer abc', 'abc'],
    [undefined, undefined],
    ['', undefined],
    ['Basic abc', undefined],
    ['Bearer', undefined],
    ['Bearer a b', undefined],
    [`Bearer ${'x'.repeat(5000)}`, undefined],
  ])('parses %j', (header, token) => {
    expect(parseBearer(header)).toBe(token);
  });
});

/** Counts calls to Mealie's `GET /api/users/self`. */
function countSelfCalls(): { count: number } {
  const counter = { count: 0 };
  mealie.events.on('request:start', ({ request }) => {
    if (new URL(request.url).pathname === '/api/users/self') counter.count++;
  });
  return counter;
}

describe('TokenValidator', () => {
  it('accepts a valid token and caches it for the TTL', async () => {
    let now = 0;
    const validator = new TokenValidator({ mealieUrl: TEST_MEALIE_URL, ttlMs: 1000, now: () => now });
    const calls = countSelfCalls();
    await expect(validator.validate(VALID_TOKEN)).resolves.toMatchObject({ ok: true, user: { username: TEST_USER.username } });
    now = 999;
    await validator.validate(VALID_TOKEN);
    expect(calls.count).toBe(1);
    now = 1000;
    await validator.validate(VALID_TOKEN);
    expect(calls.count).toBe(2);
  });

  it('rejects an invalid token and does not cache the failure', async () => {
    const validator = new TokenValidator({ mealieUrl: TEST_MEALIE_URL });
    const calls = countSelfCalls();
    await expect(validator.validate('wrong')).resolves.toEqual({ ok: false, reason: 'invalid_token' });
    await validator.validate('wrong');
    expect(calls.count).toBe(2);
  });

  it('reports Mealie being unavailable separately from an invalid token', async () => {
    mealie.use(http.get(mealieUrl('/api/users/self'), () => new HttpResponse(null, { status: 503 })));
    await expect(new TokenValidator({ mealieUrl: TEST_MEALIE_URL }).validate(VALID_TOKEN)).resolves.toMatchObject({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('evicts the oldest entry when full', async () => {
    mealie.use(
      http.get(mealieUrl('/api/users/self'), ({ request }) =>
        HttpResponse.json({ ...TEST_USER, username: request.headers.get('authorization') })
      )
    );
    const validator = new TokenValidator({ mealieUrl: TEST_MEALIE_URL, maxEntries: 2 });
    await validator.validate('a');
    await validator.validate('b');
    await validator.validate('c');
    const calls = countSelfCalls();
    await validator.validate('c');
    await validator.validate('a');
    expect(calls.count).toBe(1);
  });
});

describe('FailureLimiter', () => {
  it('blocks a key after maxFailures within the window, then lets it retry', () => {
    let now = 0;
    const limiter = new FailureLimiter({ maxFailures: 3, windowMs: 10_000, now: () => now });
    limiter.recordFailure('1.2.3.4');
    limiter.recordFailure('1.2.3.4');
    expect(limiter.retryAfterSeconds('1.2.3.4')).toBe(0);
    limiter.recordFailure('1.2.3.4');
    expect(limiter.retryAfterSeconds('1.2.3.4')).toBe(10);
    expect(limiter.retryAfterSeconds('5.6.7.8')).toBe(0);
    now = 10_000;
    expect(limiter.retryAfterSeconds('1.2.3.4')).toBe(0);
    limiter.recordFailure('1.2.3.4');
    expect(limiter.retryAfterSeconds('1.2.3.4')).toBe(0);
  });

  it('bounds the number of tracked keys', () => {
    const limiter = new FailureLimiter({ maxFailures: 1, maxKeys: 2 });
    limiter.recordFailure('a');
    limiter.recordFailure('b');
    limiter.recordFailure('c');
    expect(limiter.retryAfterSeconds('a')).toBe(0);
    expect(limiter.retryAfterSeconds('c')).toBeGreaterThan(0);
  });
});

describe('clientIp', () => {
  const req = (forwarded?: string) =>
    ({ socket: { remoteAddress: '10.0.0.2' }, headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded } }) as IncomingMessage;

  it('uses the socket address when no proxy is trusted', () => {
    expect(clientIp(req('6.6.6.6'), 0)).toBe('10.0.0.2');
  });

  it('takes the n-th address from the right of X-Forwarded-For', () => {
    expect(clientIp(req('6.6.6.6, 1.2.3.4'), 1)).toBe('1.2.3.4');
    expect(clientIp(req('6.6.6.6, 1.2.3.4, 10.0.0.1'), 2)).toBe('1.2.3.4');
  });

  it('falls back to the leftmost address when the header is shorter', () => {
    expect(clientIp(req('1.2.3.4'), 3)).toBe('1.2.3.4');
    expect(clientIp(req(), 1)).toBe('10.0.0.2');
  });
});
