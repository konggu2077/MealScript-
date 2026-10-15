/** Minimal structural copy of the compiler's MealIR, so the optimizer stays dependency-free. */
export interface MealIR {
  budget: { amountCny: number };
  requireKeyword: string;
  excludeKeywords: string[];
  minItems: number;
  maxItems: number;
}
