export * from './ast.ts';
export * from './diagnostics.ts';
export * from './ir.ts';
export * from './location.ts';
export * from './parser.ts';
export * from './semantic.ts';
export * from './tokens.ts';

import { parseMealScript } from './parser.ts';
import { analyze } from './semantic.ts';
import type { Diagnostic } from './diagnostics.ts';
import type { Program } from './ast.ts';
import type { MealIR } from './ir.ts';

export interface CompileResult {
  ok: boolean;
  ast: Program | null;
  ir: MealIR | null;
  diagnostics: Diagnostic[];
}

/**
 * Full compile pipeline for the front half: source → AST → semantic → IR.
 * Pure and synchronous — no MCP, no network, no side effects.
 * Returns diagnostics instead of throwing, so the Playground can render them.
 */
export function compile(source: string): CompileResult {
  const { ast, diagnostics } = parseMealScript(source);
  if (!ast) {
    return { ok: false, ast: null, ir: null, diagnostics };
  }
  const { ir, diagnostics: semanticDiagnostics } = analyze(ast);
  const all = [...diagnostics, ...semanticDiagnostics];
  return { ok: ir !== null, ast, ir, diagnostics: all };
}
