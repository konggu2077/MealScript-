#!/usr/bin/env tsx
/**
 * CLI front end for the compiler half of the pipeline.
 *
 *   pnpm compile:cli examples/budget.meal
 *
 * This is deliberately offline: it never touches the MCP server. It exists so
 * "the compiler is real" can be demonstrated without any credentials.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from './index.ts';
import { formatDiagnostic } from './diagnostics.ts';

const args = process.argv.slice(2);
const target = args[0];

if (!target) {
  console.error('用法: pnpm compile:cli <file.meal>');
  process.exit(2);
}

const source = readFileSync(resolve(process.cwd(), target), 'utf8');
const result = compile(source);
const stage = args.includes('--json') ? 'json' : 'text';

if (stage === 'json') {
  console.log(
    JSON.stringify(
      { ok: result.ok, ir: result.ir, diagnostics: result.diagnostics, ast: result.ast },
      null,
      2,
    ),
  );
  process.exit(result.ok ? 0 : 1);
}

console.log(`MealScript compiler v0.1  ·  ${target}`);
console.log('');

if (!result.ok) {
  console.log('COMPILATION_ERROR');
  console.log('');
  for (const d of result.diagnostics) {
    console.log(`  ${formatDiagnostic(d)}`);
  }
  process.exit(1);
}

console.log('BUILD_PASSED (front half — no MCP call was made)');
console.log('');
console.log(JSON.stringify(result.ir, null, 2));
process.exit(0);
