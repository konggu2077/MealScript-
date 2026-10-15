/**
 * Builds `dist/mealscript.html` — a single self-contained file (inline CSS +
 * inline JS, zero external requests, zero secrets).
 *
 * The bundle deliberately resolves `@mealscript/mcp-adapter` to `browser.ts`,
 * so neither `node:fs`, the MCP SDK nor any token can end up in the output.
 */
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
  alias: {
    '@mealscript/mcp-adapter': join(root, 'packages/mcp-adapter/src/browser.ts'),
  },
  logLevel: 'warning',
});

const bundle = result.outputFiles[0].text;
const template = readFileSync(join(root, 'apps/single/template.html'), 'utf8');

if (!template.includes('{{BUNDLE}}')) {
  throw new Error('template.html is missing the {{BUNDLE}} placeholder');
}

// Guard: a literal closing script tag inside the bundle would break the page.
const safeBundle = bundle.replaceAll('</script', '<\\/script');

const html = template.replace('{{BUNDLE}}', () => safeBundle);

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist/mealscript.html');
writeFileSync(out, html, 'utf8');

const kb = (statSync(out).size / 1024).toFixed(1);
console.log(`dist/mealscript.html  ${kb} KB  (bundle ${(bundle.length / 1024).toFixed(1)} KB)`);

// Guard: only a *value* would be a leak. Bare identifier names are safe —
// `create-order` appears in the forbidden-tool blocklist (a safety feature)
// and `MCD_MCP_TOKEN` only ever appears as documentation text.
const leaks = [
  /MCD_MCP_TOKEN\s*[:=]\s*["'][^"']+["']/,
  /Bearer\s+[A-Za-z0-9._-]{8,}/,
  /mcp\.mcd\.cn[^"'\s]*[?&]token=/i,
  /authorization["']?\s*[:=]\s*["'][^"']+["']/i,
];
let leaked = false;
for (const re of leaks) {
  if (re.test(html)) {
    console.error(`LEAK: ${re}`);
    leaked = true;
  }
}
if (leaked) process.exitCode = 1;

// The page must work with the network unplugged.
const external = html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi);
if (external) {
  console.error(`LEAK: external resource ${external[0]}`);
  process.exitCode = 1;
} else {
  console.log('external resources: none');
}
