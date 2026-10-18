import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { MealieUser } from '../../src/mealie/types.js';
import { TEST_MEALIE_URL } from './app.js';

export const VALID_TOKEN = 'valid-mealie-token';

export const TEST_USER: MealieUser & Record<string, unknown> = {
  id: '6f1c3d2e-0000-4000-8000-000000000001',
  username: 'alice',
  fullName: 'Alice Martin',
  email: 'alice@example.com',
  admin: false,
  group: 'Home',
  groupSlug: 'home',
  household: 'Family',
  householdSlug: 'family',
};

/** URL of a Mealie API path on the simulated Mealie. */
export const mealieUrl = (path: string) => `${TEST_MEALIE_URL}${path}`;

/** `GET /api/users/self` as Mealie answers it: the user for VALID_TOKEN, 401 otherwise. */
export const selfHandler = http.get(mealieUrl('/api/users/self'), ({ request }) =>
  request.headers.get('authorization') === `Bearer ${VALID_TOKEN}`
    ? HttpResponse.json(TEST_USER)
    : HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 })
);

/** `GET /api/users/self/ratings` for a user who has rated nothing yet. */
export const ratingsHandler = http.get(mealieUrl('/api/users/self/ratings'), () => HttpResponse.json({ ratings: [] }));

/** Simulated Mealie shared by all tests; handlers added with `use()` are reset after each test. */
export const mealie = setupServer(selfHandler, ratingsHandler);
