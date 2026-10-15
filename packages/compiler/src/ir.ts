/** Unified intermediate representation (dev brief §03: Parser → AST → Semantic → IR). */

export interface LocationIR {
  /** The raw text the user wrote. */
  raw: string;
  /** Split result fed to `query-nearby-stores`. */
  city: string;
  keyword: string;
}

export interface BudgetIR {
  /** Upper bound in yuan. */
  amountCny: number;
}

export interface MealIR {
  name: string;
  location: LocationIR;
  /** v0.1 supports pickup only (E102 for anything else). */
  mode: 'pickup';
  budget: BudgetIR;
  /** Empty string means "no hard product requirement". */
  requireKeyword: string;
  excludeKeywords: string[];
  minItems: number;
  maxItems: number;
  optimize: { fn: 'min'; target: 'total_price' };
  /** v0.1 is dry_run only (E105 for anything else). */
  execution: 'dry_run';
}
