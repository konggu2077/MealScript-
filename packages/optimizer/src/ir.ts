/** Minimal structural copy of the compiler's MealIR, so the optimizer stays dependency-free. */
export interface MealIR {
  budget: { amountCny: number };
  /** Every keyword must be satisfied by at least one item (AND). */
  requireKeywords: string[];
  excludeKeywords: string[];
  minItems: number;
  maxItems: number;
  /**
   * Allow the same product to fill more than one slot, e.g. two 麦香鸡.
   *
   * Off by default on purpose: with `min(total_price)` and repetition allowed,
   * the cheapest answer is always "N copies of the cheapest item", which is
   * mathematically right and practically useless. Repetition therefore has to
   * be asked for explicitly (`allow_repeat: true;`).
   */
  allowRepeat: boolean;
}
