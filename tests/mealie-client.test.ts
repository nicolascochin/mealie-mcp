import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { MealieClient } from '../src/mealie/client.js';
import { describeError, InvalidPathSegmentError, MealieError } from '../src/mealie/errors.js';
import { api, pathSegment } from '../src/mealie/path.js';
import { TEST_MEALIE_URL } from './helpers/app.js';
import { mealie, mealieUrl, TEST_USER, VALID_TOKEN } from './helpers/mealie.js';

const client = (timeoutMs?: number) => new MealieClient({ baseUrl: TEST_MEALIE_URL, token: VALID_TOKEN, timeoutMs });

async function failure(promise: Promise<unknown>): Promise<MealieError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof MealieError) return err;
    throw err;
  }
  throw new Error('expected a MealieError');
}

describe('MealieClient', () => {
  it('sends the token and returns the JSON body', async () => {
    await expect(client().getSelf()).resolves.toMatchObject({ username: TEST_USER.username });
  });

  it('retries a GET once after a 5xx', async () => {
    let calls = 0;
    mealie.use(
      http.get(mealieUrl('/api/flaky'), () => {
        calls++;
        return calls === 1 ? new HttpResponse(null, { status: 502 }) : HttpResponse.json({ ok: true });
      })
    );
    await expect(client().get(api`/api/flaky`)).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('retries a GET once after a network error, then gives up', async () => {
    let calls = 0;
    mealie.use(
      http.get(mealieUrl('/api/down'), () => {
        calls++;
        return HttpResponse.error();
      })
    );
    expect((await failure(client().get(api`/api/down`))).kind).toBe('network');
    expect(calls).toBe(2);
  });

  it('does not retry a 4xx', async () => {
    let calls = 0;
    mealie.use(
      http.get(mealieUrl('/api/missing'), () => {
        calls++;
        return HttpResponse.json({ detail: 'Recipe not found' }, { status: 404 });
      })
    );
    const err = await failure(client().get(api`/api/missing`));
    expect(err).toMatchObject({ kind: 'http', status: 404, detail: 'Recipe not found' });
    expect(calls).toBe(1);
  });

  it('does not retry other methods', async () => {
    let calls = 0;
    mealie.use(
      http.post(mealieUrl('/api/things'), () => {
        calls++;
        return new HttpResponse(null, { status: 500 });
      })
    );
    expect((await failure(client().request('POST', api`/api/things`, { a: 1 }))).status).toBe(500);
    expect(calls).toBe(1);
  });

  it('times out', async () => {
    mealie.use(http.get(mealieUrl('/api/slow'), () => new Promise<never>(() => {})));
    expect((await failure(client(50).get(api`/api/slow`))).kind).toBe('timeout');
  });

  it('reads FastAPI error details without internals', async () => {
    mealie.use(
      http.get(mealieUrl('/api/validation'), () =>
        HttpResponse.json({ detail: [{ msg: 'field required' }, { msg: 'too long' }] }, { status: 422 })
      ),
      http.get(mealieUrl('/api/message'), () =>
        HttpResponse.json({ detail: { message: 'Already exists', exception: 'Traceback ...' } }, { status: 409 })
      )
    );
    expect((await failure(client().get(api`/api/validation`))).detail).toBe('field required; too long');
    expect((await failure(client().get(api`/api/message`))).detail).toBe('Already exists');
  });
});

describe('path segments', () => {
  it('encodes interpolated values', () => {
    expect(api`/api/recipes/${'pâte à crêpes?x=1#y'}/image`).toBe('/api/recipes/p%C3%A2te%20%C3%A0%20cr%C3%AApes%3Fx%3D1%23y/image');
    expect(pathSegment(42)).toBe('42');
  });

  it.each(['', '.', '..', 'a/b', '../admin', 'a\\b'])('rejects %j', (value) => {
    expect(() => api`/api/recipes/${value}`).toThrow(InvalidPathSegmentError);
  });
});

describe('describeError', () => {
  it.each([
    [new MealieError('http', '', 401), 'update the token'],
    [new MealieError('http', '', 403, 'Admin only'), 'not allowed to do this. Mealie says: Admin only'],
    [new MealieError('http', '', 404), 'Not found in Mealie. Use mealie_search_recipes.'],
    [new MealieError('http', '', 503), 'Try again later'],
    [new MealieError('timeout', ''), 'did not answer in time'],
    [new MealieError('network', ''), 'unreachable'],
    [new InvalidPathSegmentError('..'), 'Invalid identifier ".."'],
    [new Error('secret internals'), 'Unexpected server error.'],
  ])('describes %s', (err, message) => {
    expect(describeError(err, { notFound: 'Use mealie_search_recipes.' })).toContain(message);
  });
});
