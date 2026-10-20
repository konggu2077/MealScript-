import { defineConfig } from 'vitest/config';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// vite-node writes its SSR transform cache to the OS temp dir. In sandboxes
// where that is not writable the write fails with EPERM and vitest *silently
// drops the test file* from the run — the report looks green with fewer tests.
// A one-time probe is racy (the failure is intermittent), so we unconditionally
// redirect TEMP/TMP to a workspace-local folder for the test process. This is
// self-contained and harmless on any machine.
{
  const fallback = fileURLToPath(new URL('./node_modules/.vitest-tmp', import.meta.url));
  mkdirSync(fallback, { recursive: true });
  process.env.TEMP = fallback;
  process.env.TMP = fallback;
}

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
    // Inlining these keeps Vite from pre-bundling them into the OS temp dir,
    // which is not writable in this sandbox (intermittent EPERM on cold runs).
    deps: {
      // The SSR optimiser also writes to the OS temp dir, which intermittently
      // raises EPERM and silently drops a test file from the run. We inline
      // everything we depend on, so it can be turned off outright.
      // (`deps.optimizer` lives here, not under `server.deps`.)
      optimizer: { ssr: { enabled: false }, web: { enabled: false } },
    },
    server: {
      deps: {
        inline: [/@mealscript\//, /chevrotain/, /zod/, /@modelcontextprotocol/],
      },
    },
  },
});
