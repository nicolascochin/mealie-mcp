import { defineConfig } from 'vitest/config';

/** Integration suite against a real Mealie: run it with `npm run test:live`, not directly. */
export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
