import { defineConfig } from 'vitest/config';

/** Unit tests: pure logic only (engines, contracts, formatting). The browser flows are Playwright's (tests/e2e). */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
