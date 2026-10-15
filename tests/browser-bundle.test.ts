import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE = `meal lunch {
  location: "北京市海淀区五道口";
  mode: pickup;
  budget: <= 35 CNY;
  require_keyword: "汉堡";
  exclude_keywords: ["咖啡"];
  min_items: 1;
  max_items: 2;
  optimize: min(total_price);
  execution: dry_run;
}`;

/**
 * The single-file HTML page ships the compiler as a browser IIFE bundle.
 * These tests build that exact bundle and execute it in a VM, so "the page
 * works" is verified by running the shipped code — not by trusting it.
 */
async function bundle(): Promise<string> {
  const result = await build({
    entryPoints: [join(root, 'apps/single/src/main.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'MealScript',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    write: false,
    legalComments: 'none',
    alias: { '@mealscript/mcp-adapter': join(root, 'packages/mcp-adapter/src/browser.ts') },
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

async function loadApi() {
  const code = await bundle();
  const context = { console, setTimeout, clearTimeout, Date, Math, JSON, crypto: globalThis.crypto };
  vm.createContext(context);
  vm.runInContext(code + '\n;this.MealScript = MealScript;', context);
  return (context as unknown as { MealScript: any }).MealScript;
}

describe('browser bundle (single-file HTML payload)', () => {
  it('bundles without pulling in node builtins or the MCP SDK', async () => {
    const code = await bundle();
    expect(code).not.toMatch(/require\(["']node:/);
    expect(code).not.toMatch(/@modelcontextprotocol/);
    expect(code).not.toMatch(/process\.env/);
  });

  it('exposes compile + run and produces a real build result', async () => {
    const api = await loadApi();
    expect(typeof api.run).toBe('function');
    expect(typeof api.compile).toBe('function');

    const result = await api.run(SOURCE);
    expect(result.status).toBe('REPLAY_RESULT');
    expect(result.mode).toBe('replay');
    expect(result.verified.length).toBeGreaterThan(0);
    expect(result.verified[0].totalCny).toBeLessThanOrEqual(35);
    expect(result.trace.events.length).toBeGreaterThan(3);
  });

  it('reports compilation errors with line and column', async () => {
    const api = await loadApi();
    const result = await api.run('meal lunch {\n  mode: delivery;\n  budget: <= -10 CNY;\n}');
    expect(result.status).toBe('COMPILATION_ERROR');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    const codes = result.diagnostics.map((d: any) => d.code);
    expect(codes).toContain('E101');
    expect(result.diagnostics[0].line).toBeGreaterThan(0);
  });

  it('never allows a write-capable tool through the bundled client', async () => {
    const api = await loadApi();
    const fixture = api.FIXTURE;
    expect(fixture.mode).toBe('replay');
    expect(fixture.redacted).toBe(true);
    const tools = Object.keys(fixture.tools ?? {});
    for (const forbidden of ['create-order', 'cancel-order', 'auto-bind-coupons']) {
      expect(tools).not.toContain(forbidden);
    }
  });
});

describe('single-file HTML output', () => {
  it('has no external resource references and no credential values', () => {
    const html = readFileSync(join(root, 'dist/mealscript.html'), 'utf8');
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:\/\//i);
    expect(html).not.toMatch(/MCD_MCP_TOKEN\s*[:=]\s*["'][^"']+["']/);
    expect(html).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{8,}/);
    expect(html).toContain('MealScript');
  });
});
