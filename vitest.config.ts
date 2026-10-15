import { defineConfig } from 'vitest/config';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// vite-node writes its SSR transform cache to the OS temp dir. In sandboxes
// where that is not writable the write fails with EPERM and vitest *silently
// drops the test file* from the run — the report looks green with fewer tests.
// Probe the temp dir once; only if it is broken do we redirect TEMP/TMP to a
// workspace-local folder. On a normal machine this changes nothing.
function ensureWritableTemp(): void {
  const probe = join(tmpdir(), `vitest-probe-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(probe, 'ok');
    rmSync(probe, { force: true });
  } catch {
    const fallback = fileURLToPath(new URL('./node_modules/.vitest-tmp', import.meta.url));
    mkdirSync(fallback, { recursive: true });
    process.env.TEMP = fallback;
    process.env.TMP = fallback;
  }
}
ensureWritableTemp();

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
