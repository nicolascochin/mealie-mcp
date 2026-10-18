import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Needs a real Mealie: see vitest.live.config.ts and `npm run test:live`.
    exclude: ['tests/live/**', 'node_modules/**'],
    setupFiles: ['tests/setup.ts'],
    environment: 'node',
  },
});
