import { afterAll, afterEach, beforeAll } from 'vitest';
import { mealie } from './helpers/mealie.js';

// Requests to the server under test (127.0.0.1) are not mocked and go through.
beforeAll(() => mealie.listen({ onUnhandledFrame: 'bypass' }));
afterEach(() => {
  mealie.resetHandlers();
  mealie.events.removeAllListeners();
});
afterAll(() => mealie.close());
