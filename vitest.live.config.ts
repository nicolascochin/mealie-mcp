import { defineConfig } from 'vitest/config';

/** Integration suite against a real Mealie: run it with `npm run test:live`, not directly. */
export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    environment: 'node',
    // One file at a time: some files create and delete recipes that searches in other files would see.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
