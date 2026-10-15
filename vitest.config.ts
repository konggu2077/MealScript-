import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Vite's default dep-optimisation cache lives in the OS temp dir, which is
  // not writable in this sandbox. Keep it inside the workspace instead.
  cacheDir: 'node_modules/.vite',
  resolve: {
    alias: {
      '@mealscript/compiler': fileURLToPath(new URL('./packages/compiler/src/index.ts', import.meta.url)),
      '@mealscript/mcp-adapter': fileURLToPath(new URL('./packages/mcp-adapter/src/index.ts', import.meta.url)),
      '@mealscript/optimizer': fileURLToPath(new URL('./packages/optimizer/src/index.ts', import.meta.url)),
      // More specific aliases must come first — Vite matches by prefix.
      '@mealscript/verifier/pipeline': fileURLToPath(new URL('./packages/verifier/src/pipeline.ts', import.meta.url)),
      '@mealscript/verifier': fileURLToPath(new URL('./packages/verifier/src/index.ts', import.meta.url)),
      '@mealscript/trace': fileURLToPath(new URL('./packages/trace/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
    reporters: ['default'],
    server: {
      // Inlining these keeps Vite from pre-bundling them into the OS temp dir,
      // which is not writable in this sandbox (intermittent EPERM on cold runs).
      deps: {
        inline: [/@mealscript\//, /chevrotain/, /zod/, /@modelcontextprotocol/],
        // The SSR optimiser still writes to the OS temp dir, which intermittently
        // raises EPERM and silently drops a test file from the run. We inline
        // everything we depend on, so it can be turned off outright.
        optimizer: { ssr: { enabled: false } },
      },
    },
  },
});
