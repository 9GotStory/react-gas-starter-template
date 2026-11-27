import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { MOCK_GAS_API_PATH } from '../tests/fixtures/items';
import { createMockGasApiPlugin } from './dev/mockGasMiddleware';

const frontendDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ command, mode, isPreview }) => {
  const isVitest = Boolean(process.env.VITEST);
  const env = loadEnv(mode, frontendDir, 'VITE_');
  const configuredApiUrl = (process.env.VITE_GAS_API_URL ?? env.VITE_GAS_API_URL ?? '').trim();
  const useDevMockApi =
    command === 'serve' &&
    !isPreview &&
    !isVitest &&
    (!configuredApiUrl || configuredApiUrl === MOCK_GAS_API_PATH);

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(useDevMockApi ? [createMockGasApiPlugin({ apiPath: MOCK_GAS_API_PATH })] : []),
    ],
    define:
      useDevMockApi && !configuredApiUrl
        ? {
            'import.meta.env.VITE_GAS_API_URL': JSON.stringify(MOCK_GAS_API_PATH),
          }
        : undefined,
    test: {
      environment: 'jsdom',
      globals: true,
    },
  };
});
