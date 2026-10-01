import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    pool: 'threads',
    maxWorkers: 4,
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      thresholds: { lines: 70, statements: 70 },
    },
  },
});
