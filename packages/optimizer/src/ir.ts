/** Minimal structural copy of the compiler's MealIR, so the optimizer stays dependency-free. */
export interface MealIR {
  budget: { amountCny: number };
  /** Every keyword must be satisfied by at least one item (AND). */
  requireKeywords: string[];
  excludeKeywords: string[];
  minItems: number;
  maxItems: number;
}
