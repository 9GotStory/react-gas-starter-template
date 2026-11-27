import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'frontend',
      'backend',
      {
        test: {
          name: 'contract',
          environment: 'node',
          include: ['tests/contract/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'tooling',
          environment: 'node',
          include: ['scripts/**/*.test.mjs'],
        },
      },
    ],
  },
});
