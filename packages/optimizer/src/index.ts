import type { MealIR } from './ir.ts';

/** A menu item as the optimizer sees it (structurally compatible with the adapter's MenuItem). */
export interface OptimizerItem {
  code: string;
  name: string;
  priceCny: number;
  tags?: string[];
  category?: string;
}

export interface Candidate {
  /**
   * One entry **per piece**, in menu order. A repeated product appears once per
   * piece (`[麦香鸡, 麦香鸡]`), so `items.length` is the piece count that
   * `min_items` / `max_items` measure. Repetition only ever happens when the
   * source asked for it with `allow_repeat: true;`.
   */
  items: OptimizerItem[];
  /** Sum of menu prices — a *coarse* estimate only, never the final answer. */
  menuTotalCny: number;
}

/**
 * Collapse a per-piece list into per-product lines with a quantity, which is
 * what `calculate-price` and the UI actually need.
 *
 * Order follows first appearance, so the report reads the same way the meal was
 * built.
 */
export function aggregateItems(items: OptimizerItem[]): Array<{ item: OptimizerItem; qty: number }> {
  const lines: Array<{ item: OptimizerItem; qty: number }> = [];
  const index = new Map<string, { item: OptimizerItem; qty: number }>();
  for (const item of items) {
    const hit = index.get(item.code);
    if (hit) {
      hit.qty += 1;
      continue;
    }
    const line = { item, qty: 1 };
    index.set(item.code, line);
    lines.push(line);
  }
  return lines;
}

export interface OptimizerStats {
  /** Menu size before filtering. */
  menuSize: number;
  /** Size after exclude/require filtering. */
  allowedSize: number;
  /** Number of combinations actually enumerated. */
  enumerated: number;
  /** Human-readable description of what was and was not searched. */
  searchScope: string;
  /** True only when every combination in the window was checked. */
  exhaustive: boolean;
}

export interface OptimizerResult {
  ok: boolean;
  candidates: Candidate[];
  errorCode?: string;
  message?: string;
  stats: OptimizerStats;
}

export interface OptimizerOptions {
  /** How many candidates survive for price verification. */
  topK?: number;
  /** Hard ceiling on enumeration, so a large menu can never explode. */
  maxCombinations?: number;
  /**
   * Ceiling on *visited search nodes* (not on retained candidates).
   *
   * `maxCombinations` bounds memory and never changes the answer; this one
   * bounds wall-clock time and therefore *can* truncate the search. When it
   * fires, `stats.exhaustive` goes false and `searchScope` says so — the user
   * is told the result may not be the global optimum instead of being lied to.
   */
  maxEnumerations?: number;
  /** Which direction counts as best. Defaults to the IR's own setting. */
  fn?: OptimizeFn;
}

export type OptimizeFn = 'min' | 'max';

/**
 * Largest meal size the optimizer will search.
 *
 * Must stay in sync with the compiler's `MAX_ITEMS_LIMIT`; `tests/optimizer.test.ts`
 * asserts the two are equal so they cannot drift apart silently.
 */
export const MAX_SEARCH_ITEMS = 5;

const DEFAULT_TOP_K = 12;
const DEFAULT_MAX_COMBINATIONS = 20000;
/**
 * Node budget. A 61-item menu at size 5 is ~5.4M raw combinations; the budget
 * pruning below collapses that to a few thousand in practice, but a generous
 * budget with cheap items can still blow up. 400k keeps a cold browser tab
 * responsive (tens of ms) while leaving the normal case untouched.
 */
const DEFAULT_MAX_ENUMERATIONS = 400_000;

function matches(item: OptimizerItem, keyword: string): boolean {
  if (!keyword) return true;
  if (item.name.includes(keyword)) return true;
  // Category names like "小食" / "饮品" / "甜品冰淇淋" are what users naturally
  // type as keywords, so they must participate in matching too.
  if (item.category && item.category.includes(keyword)) return true;
  return (item.tags ?? []).some((tag) => tag.includes(keyword));
}

/**
 * Bounded combination search (dev brief §5.1).
 *
 * Guarantees:
 *  - never returns an empty meal (min_items >= 1),
 *  - never explores beyond the declared window,
 *  - the enumeration cap bounds memory only, never the answer: the retained
 *    set is always the cheapest `maxCombinations` combos, so top-K does not
 *    depend on enumeration order,
 *  - `stats.exhaustive` reports whether the *window* was searched in full, so
 *    the UI can only claim "global optimum" when it is true.
 */
export function buildCandidates(
  menu: OptimizerItem[],
  ir: Pick<MealIR, 'requireKeywords' | 'excludeKeywords' | 'minItems' | 'maxItems' | 'budget'> &
    Partial<Pick<MealIR, 'allowRepeat' | 'optimize'>>,
  options: OptimizerOptions = {},
): OptimizerResult {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const maxCombinations = options.maxCombinations ?? DEFAULT_MAX_COMBINATIONS;
  const maxEnumerations = options.maxEnumerations ?? DEFAULT_MAX_ENUMERATIONS;
  const budget = ir.budget.amountCny;
  const menuSize = menu.length;
  const allowRepeat = ir.allowRepeat === true;
  const fn: OptimizeFn = options.fn ?? ir.optimize?.fn ?? 'min';

  const allowed = menu.filter((item) => !ir.excludeKeywords.some((bad) => matches(item, bad)));
  // Keywords select *which* items satisfy the request, not *what the rest of the
  // meal may be built from. Requiring "汉堡" must still allow 汉堡 + 薯条 — so
  // combinations are enumerated over the whole allowed menu and then filtered to
  // those containing at least one hit. (Restricting the pool to hits only made
  // every multi-item request impossible unless it repeated the same food type.)
  //
  // Multiple keywords are AND-ed: each one needs its own hit inside the meal, so
  // `["汉堡", "可乐"]` means "a burger *and* a coke", not "either one".
  const hits = ir.requireKeywords.map((keyword) => allowed.filter((item) => matches(item, keyword)));
  const missing = ir.requireKeywords.filter((_, index) => hits[index]?.length === 0);
  const categories = [...new Set(allowed.map((item) => item.category).filter((c): c is string => Boolean(c)))];

  const keywordSummary = ir.requireKeywords
    .map((keyword, index) => `「${keyword}」命中 ${hits[index]?.length ?? 0} 件`)
    .join('、');

  const stats = (enumerated: number, exhaustive: boolean, extra = ''): OptimizerStats => ({
    menuSize,
    allowedSize: allowed.length,
    enumerated,
    searchScope:
      `在 ${ir.minItems}–${ir.maxItems} 件窗口内搜索（${fn === 'min' ? '最低总价' : '尽量花满预算'}），允许集 ${allowed.length} 件` +
      (allowRepeat ? '（允许同款多份）' : '') +
      (ir.requireKeywords.length > 0 ? `（${keywordSummary}）` : '') +
      extra,
    exhaustive,
  });

  if (allowed.length === 0) {
    return {
      ok: false,
      candidates: [],
      errorCode: 'E211',
      message: '排除后没有任何可售商品',
      stats: stats(0, true),
    };
  }

  if (missing.length > 0) {
    return {
      ok: false,
      candidates: [],
      errorCode: 'E211',
      message:
        `当前门店可售商品中没有匹配${missing.map((keyword) => `「${keyword}」`).join('')}的商品` +
        (categories.length ? `；可用分类：${categories.join('、')}` : ''),
      stats: stats(0, true),
    };
  }

  // A meal can only be assembled if the window is wide enough for one item per
  // required keyword. The compiler already rejects the obvious case, but the
  // optimizer is also called directly (tests, other front ends), so it stays
  // honest on its own.
  if (ir.requireKeywords.length > Math.min(Math.max(1, ir.maxItems), MAX_SEARCH_ITEMS)) {
    return {
      ok: false,
      candidates: [],
      errorCode: 'E220',
      message: `require_keyword 里每件商品都要占一个名额（共 ${ir.requireKeywords.length} 个），但 max_items 只有 ${ir.maxItems}`,
      stats: stats(0, true),
    };
  }

  // Ascending price. This ordering is what makes the budget cutoff exact: once
  // a running total is over budget, every later index is at least as expensive,
  // so the whole remaining subtree can be abandoned.
  const pool = [...allowed].sort((a, b) => a.priceCny - b.priceCny);

  // Retention is kept exact: hold the `maxCombinations` *best* combos rather
  // than the first ones encountered. Lexicographic order over a price-sorted
  // pool is NOT monotonic in total — (0,1,60) is visited before (0,2,3) yet can
  // cost more — so "fill up then stop accepting" silently returns a set that
  // need not contain the global optimum.
  const retained = new BoundedCandidates(maxCombinations, fn);
  const chosen: OptimizerItem[] = [];
  let enumerated = 0;
  let visited = 0;
  let dropped = 0;
  let capped = false;

  const min = Math.max(1, ir.minItems);
  const requestedMax = Math.max(min, ir.maxItems);
  const max = Math.min(requestedMax, MAX_SEARCH_ITEMS);
  // The DSL rejects max_items above the ceiling, but the optimizer is also
  // called directly (tests, other front ends), so the silent clamp must still
  // be reported honestly.
  const windowClamped = requestedMax > max;

  // Prefix sums let max-mode compute "the most expensive completion available
  // below index i" in O(1), which is what makes the branch-and-bound pruning
  // affordable. `prefix[i]` = sum of pool[0..i-1].
  const prefix = new Array<number>(pool.length + 1);
  prefix[0] = 0;
  for (let i = 0; i < pool.length; i += 1) {
    prefix[i + 1] = (prefix[i] as number) + (pool[i] as OptimizerItem).priceCny;
  }

  const offer = (sum: number) => {
    enumerated += 1;
    if (!retained.offer({ items: [...chosen], menuTotalCny: round2(sum) })) dropped += 1;
  };

  /**
   * Cheapest-first search (ascending indices).
   *
   * Indices are chosen strictly increasing (`i < j < k`) unless `allowRepeat`,
   * in which case non-decreasing — that is the only difference between
   * combinations and multisets, and it also keeps each combo enumerated once.
   */
  const searchMin = (start: number, sum: number): void => {
    visited += 1;
    if (visited > maxEnumerations) {
      capped = true;
      return;
    }

    // Lower-bound prune: even filling the remaining slots with the cheapest
    // available items would blow the budget, so no completion can fit. Done
    // before recursing because it kills whole subtrees at shallow depth — this
    // is what keeps a generous budget at five items from exploding.
    const need = min - chosen.length;
    if (need > 0) {
      if (allowRepeat) {
        const cheapest = pool[0];
        if (!cheapest) return;
        if (sum + need * cheapest.priceCny > budget) return;
      } else {
        if (start + need > pool.length) return; // not enough items left
        const extra = (prefix[start + need] as number) - (prefix[start] as number);
        if (sum + extra > budget) return;
      }
    }

    if (chosen.length >= min) offer(sum);
    if (chosen.length === max) return;

    for (let i = start; i < pool.length; i += 1) {
      const item = pool[i];
      if (!item) continue;
      const next = sum + item.priceCny;
      if (next > budget) break; // ascending pool: nothing later can fit either
      chosen.push(item);
      searchMin(allowRepeat ? i : i + 1, next);
      chosen.pop();
      if (capped) return;
    }
  };

  /**
   * Most-expensive-first search, for `max(total_price)` — "spend as much of the
   * budget as you can without going over".
   *
   * Two things differ from the min search:
   *  - indices descend, so the expensive end of the pool is explored first and
   *    the budget cutoff bites early instead of after millions of cheap combos;
   *  - a `break` is impossible (a lower index is cheaper, so it may still fit),
   *    so over-budget items are skipped with `continue` and pruned instead by
   *    branch-and-bound: if even filling the remaining slots with the most
   *    expensive items available cannot beat the worst combo we already keep,
   *    the subtree is worthless.
   */
  const searchMax = (end: number, sum: number): void => {
    visited += 1;
    if (visited > maxEnumerations) {
      capped = true;
      return;
    }

    // Lower-bound prune, same idea as in the min search: the *cheapest* way to
    // reach `min` items is always the first `need` entries of the ascending
    // pool, so if even that exceeds the budget this branch is hopeless.
    const need = min - chosen.length;
    if (need > 0) {
      if (allowRepeat) {
        const cheapest = pool[0];
        if (!cheapest) return;
        if (sum + need * cheapest.priceCny > budget) return;
      } else {
        if (end < need) return; // not enough distinct items left below `end`
        if (sum + (prefix[need] as number) > budget) return;
      }
    }

    if (chosen.length >= min) offer(sum);
    if (chosen.length === max) return;

    const slotsLeft = max - chosen.length - 1;
    const worst = retained.worstValue();

    for (let i = end - 1; i >= 0; i -= 1) {
      const item = pool[i];
      if (!item) continue;
      const next = sum + item.priceCny;
      if (next > budget) continue;

      if (worst !== null && slotsLeft > 0) {
        // Best total still reachable from here. With repetition the dearest
        // item below can be taken every remaining slot; without it, the
        // `slotsLeft` priciest distinct ones.
        const upper = allowRepeat
          ? next + slotsLeft * item.priceCny
          : next + ((prefix[i] as number) - (prefix[Math.max(0, i - slotsLeft)] as number));
        if (upper < worst) continue;
      }

      chosen.push(item);
      searchMax(allowRepeat ? i + 1 : i, next);
      chosen.pop();
      if (capped) return;
    }
  };

  if (fn === 'max') searchMax(pool.length, 0);
  else searchMin(0, 0);

  const candidates = retained.toArray();

  // Every required keyword needs at least one matching item in the combo; the
  // remaining slots may hold anything the store sells (after exclude_keywords).
  const qualified = candidates.filter(
    (candidate) =>
      ir.requireKeywords.length === 0 ||
      ir.requireKeywords.every((keyword) => candidate.items.some((item) => matches(item, keyword))),
  );

  const direction = fn === 'min' ? 1 : -1;
  qualified.sort((x, y) => direction * (x.menuTotalCny - y.menuTotalCny));
  const top =
    ir.requireKeywords.length > 0 ? pickDiverse(qualified, topK, ir.requireKeywords) : qualified.slice(0, topK);

  if (top.length === 0) {
    const keywordHint =
      ir.requireKeywords.length > 1
        ? `${ir.requireKeywords.length} 个关键词各要占一件商品，最低也要买 ${ir.requireKeywords.length} 件；`
        : '';
    return {
      ok: false,
      candidates: [],
      errorCode: 'E220',
      message:
        `在已枚举的 ${enumerated} 个组合中，没有菜单价不超过 ${budget} 元的组合（${keywordHint}` +
        `可提高预算，或把 min_items 调到 ${Math.max(1, ir.minItems - 1)} 试试）` +
        (capped ? '。注意：本次搜索因规模上限被截断，可能漏掉了更优解' : ''),
      stats: stats(enumerated, !windowClamped && !capped),
    };
  }

  const notes =
    (dropped > 0 ? `，组合超过容量上限，已保留最${fn === 'min' ? '便宜' : '贵'}的 ${maxCombinations} 个` : '') +
    (windowClamped ? `，max_items 超过 ${MAX_SEARCH_ITEMS}，本次只搜索到 ${MAX_SEARCH_ITEMS} 件` : '') +
    (capped ? `，搜索达到 ${maxEnumerations} 个节点的规模上限，结果可能不是全局最优` : '') +
    (ir.requireKeywords.length > 0 ? `，已按主料与件数去重（${top.length} 个方案）` : '');

  return {
    ok: true,
    candidates: top,
    stats: stats(enumerated, !windowClamped && !capped, notes),
  };
}

/**
 * Pick up to `topK` candidates that are not all the *same* required item padded
 * with a cheaper side dish.
 *
 * `min(total_price)` alone returns three meals that differ only by which ¥5
 * dessert fills the gap — mathematically correct, useless as a choice. Two
 * candidates are treated as duplicates when they have the same item count and
 * the same set of keyword hits, so the report shows e.g. three different burgers
 * instead of one burger three times.
 */
function pickDiverse(candidates: Candidate[], topK: number, keywords: string[]): Candidate[] {
  const picked: Candidate[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (picked.length >= topK) break;
    const hits = [
      ...new Set(
        candidate.items
          .filter((item) => keywords.some((keyword) => matches(item, keyword)))
          .map((item) => item.code),
      ),
    ].sort();
    const signature = `${candidate.items.length}:${hits.join(',')}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    picked.push(candidate);
  }

  return picked;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Fixed-capacity heap that keeps the `capacity` *best* candidates, where "best"
 * depends on the optimize direction.
 *
 * The root is always the worst retained candidate, which is what both uses need:
 * `offer` compares against the worst to decide whether a newcomer is worth
 * keeping, and the max-direction branch-and-bound reads `worstValue()` as the
 * bar any unexplored subtree has to clear.
 *
 * Keeping the best N (rather than the first N) is what makes `maxCombinations`
 * safe: it bounds memory but never changes the answer.
 */
class BoundedCandidates {
  private readonly heap: Candidate[] = [];

  constructor(
    private readonly capacity: number,
    private readonly fn: OptimizeFn,
  ) {}

  /** True when `a` is worse than `b` under the current direction. */
  private worse(a: Candidate, b: Candidate): boolean {
    return this.fn === 'min'
      ? a.menuTotalCny > b.menuTotalCny
      : a.menuTotalCny < b.menuTotalCny;
  }

  /** Worst retained total, or null when nothing is retained yet. */
  worstValue(): number | null {
    return this.heap.length > 0 ? (this.heap[0] as Candidate).menuTotalCny : null;
  }

  /** False means the candidate was dropped because it was not better than the worst kept. */
  offer(candidate: Candidate): boolean {
    if (this.capacity <= 0) return false;

    if (this.heap.length < this.capacity) {
      this.heap.push(candidate);
      this.siftUp(this.heap.length - 1);
      return true;
    }

    const worst = this.heap[0];
    if (!worst || !this.worse(worst, candidate)) return false;
    this.heap[0] = candidate;
    this.siftDown(0);
    return true;
  }

  toArray(): Candidate[] {
    return [...this.heap];
  }

  private siftUp(start: number): void {
    let index = start;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const child = this.heap[index] as Candidate;
      const mother = this.heap[parent] as Candidate;
      // Root must stay the worst: stop as soon as the parent is already worse.
      if (!this.worse(child, mother)) break;
      this.heap[index] = mother;
      this.heap[parent] = child;
      index = parent;
    }
  }

  private siftDown(start: number): void {
    const size = this.heap.length;
    let index = start;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let worstIndex = index;
      if (left < size && this.worse(this.heap[left] as Candidate, this.heap[worstIndex] as Candidate)) {
        worstIndex = left;
      }
      if (right < size && this.worse(this.heap[right] as Candidate, this.heap[worstIndex] as Candidate)) {
        worstIndex = right;
      }
      if (worstIndex === index) return;
      const a = this.heap[index] as Candidate;
      this.heap[index] = this.heap[worstIndex] as Candidate;
      this.heap[worstIndex] = a;
      index = worstIndex;
    }
  }
}
