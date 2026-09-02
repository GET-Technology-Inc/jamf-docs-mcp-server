import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Unit tests are hermetic; the setup below turns a missed mock into a
    // failure instead of a slow pass. Integration and e2e reach live Jamf
    // endpoints on purpose and are excluded.
    setupFiles: ['test/helpers/no-network.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts']
    },
    testTimeout: 30000, // 30s for integration tests that hit network
    hookTimeout: 10000
  }
});
