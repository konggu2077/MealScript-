/** AST produced by the MealScript v0.1 parser. */

export interface SourceLocation {
  startOffset: number;
  endOffset: number;
  /** 1-based line. */
  startLine: number;
  /** 1-based column. */
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export type FieldKind =
  | 'location'
  | 'mode'
  | 'budget'
  | 'require_keyword'
  | 'exclude_keywords'
  | 'min_items'
  | 'max_items'
  | 'optimize'
  | 'execution';

export type FieldValue =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'array'; items: string[] }
  | { kind: 'budget'; op: '<=' | '<'; amount: number; currency: string }
  | { kind: 'optimize'; fn: string; target: string };

export interface Field {
  type: 'Field';
  kind: FieldKind;
  value: FieldValue;
  /** Location of the whole `key: value;` statement. */
  loc: SourceLocation;
  /** Location of the value expression only — diagnostics point here. */
  valueLoc: SourceLocation;
}

export interface Program {
  type: 'Program';
  /** The `meal <name> { ... }` name. */
  name: string;
  loc: SourceLocation;
  fields: Field[];
}

export const FIELD_KINDS: FieldKind[] = [
  'location',
  'mode',
  'budget',
  'require_keyword',
  'exclude_keywords',
  'min_items',
  'max_items',
  'optimize',
  'execution',
];

export function findField(program: Program | null, kind: FieldKind): Field | undefined {
  return program?.fields.find((f) => f.kind === kind);
}
