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
  /**
   * Every keyword must be satisfied by at least one item in the meal (AND).
   * Matched against product name / category name / tags. Empty array means
   * "no hard product requirement".
   */
  requireKeywords: string[];
  /** No item matching any of these may end up in the meal. */
  excludeKeywords: string[];
  minItems: number;
  maxItems: number;
  /**
   * Whether one product may fill more than one slot (e.g. two 麦香鸡).
   * `minItems` / `maxItems` always count pieces, not distinct products.
   */
  allowRepeat: boolean;
  optimize: { fn: 'min'; target: 'total_price' };
  /** v0.1 is dry_run only (E105 for anything else). */
  execution: 'dry_run';
}
