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
  /** Distinct items, quantity 1 each. v0.1 does not repeat items. */
  items: OptimizerItem[];
  /** Sum of menu prices — a *coarse* estimate only, never the final answer. */
  menuTotalCny: number;
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
}

const DEFAULT_TOP_K = 12;
const DEFAULT_MAX_COMBINATIONS = 20000;

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
  ir: Pick<MealIR, 'requireKeywords' | 'excludeKeywords' | 'minItems' | 'maxItems' | 'budget'>,
  options: OptimizerOptions = {},
): OptimizerResult {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const maxCombinations = options.maxCombinations ?? DEFAULT_MAX_COMBINATIONS;
  const budget = ir.budget.amountCny;
  const menuSize = menu.length;

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
      `在 ${ir.minItems}–${ir.maxItems} 件窗口内搜索，允许集 ${allowed.length} 件` +
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
  if (ir.requireKeywords.length > Math.min(Math.max(1, ir.maxItems), 3)) {
    return {
      ok: false,
      candidates: [],
      errorCode: 'E220',
      message: `require_keyword 里每件商品都要占一个名额（共 ${ir.requireKeywords.length} 个），但 max_items 只有 ${ir.maxItems}`,
      stats: stats(0, true),
    };
  }

  // Ascending price: lets us break out of the inner loops as soon as the
  // running total exceeds the budget. Because the pool is sorted, a later `j`
  // (or `k`) can only be more expensive, so those `break`s are exact — the
  // budget pruning never skips a combination that could have fit.
  const pool = [...allowed].sort((a, b) => a.priceCny - b.priceCny);

  // Retention is kept exact: hold the cheapest `maxCombinations` combos rather
  // than the first ones encountered. Lexicographic order over a price-sorted
  // pool is NOT monotonic in total — (0,1,60) is visited before (0,2,3) yet can
  // cost more — so "fill up then stop accepting" silently returns a set that
  // need not contain the global minimum.
  const retained = new MaxHeapCandidates(maxCombinations);
  let enumerated = 0;
  let dropped = 0;

  const push = (combo: OptimizerItem[]) => {
    const total = round2(combo.reduce((sum, item) => sum + item.priceCny, 0));
    if (total > budget) return;
    enumerated += 1;
    if (!retained.offer({ items: combo, menuTotalCny: total })) dropped += 1;
  };

  const min = Math.max(1, ir.minItems);
  const requestedMax = Math.max(min, ir.maxItems);
  const max = Math.min(requestedMax, 3);
  // The DSL rejects max_items > 3, but the optimizer is also called directly,
  // so the silent clamp must still be reported honestly.
  const windowClamped = requestedMax > max;

  for (let i = 0; i < pool.length; i += 1) {
    const a = pool[i];
    if (!a) continue;
    if (min <= 1) push([a]);
    if (max < 2) continue;
    if (a.priceCny > budget) break;

    for (let j = i + 1; j < pool.length; j += 1) {
      const b = pool[j];
      if (!b) continue;
      if (a.priceCny + b.priceCny > budget) break;
      if (min <= 2) push([a, b]);
      if (max < 3) continue;

      for (let k = j + 1; k < pool.length; k += 1) {
        const c = pool[k];
        if (!c) continue;
        if (a.priceCny + b.priceCny + c.priceCny > budget) break;
        push([a, b, c]);
      }
    }
  }

  const candidates = retained.toArray();

  // Every required keyword needs at least one matching item in the combo; the
  // remaining slots may hold anything the store sells (after exclude_keywords).
  const qualified = candidates.filter(
    (candidate) =>
      ir.requireKeywords.length === 0 ||
      ir.requireKeywords.every((keyword) => candidate.items.some((item) => matches(item, keyword))),
  );

  qualified.sort((x, y) => x.menuTotalCny - y.menuTotalCny);
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
      message: `在已枚举的 ${enumerated} 个组合中，没有菜单价不超过 ${budget} 元的组合（${keywordHint}可提高预算，或把 min_items 调到 ${Math.max(1, ir.minItems - 1)} 试试）`,
      stats: stats(enumerated, !windowClamped),
    };
  }

  const notes =
    (dropped > 0 ? `，组合超过上限，已保留最便宜的 ${maxCombinations} 个` : '') +
    (windowClamped ? '，max_items 超过 3，本次只搜索到 3 件' : '') +
    (ir.requireKeywords.length > 0 ? `，已按主料与件数去重（${top.length} 个方案）` : '');

  return {
    ok: true,
    candidates: top,
    stats: stats(enumerated, !windowClamped, notes),
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
 * Fixed-capacity max-heap of candidates keyed by `menuTotalCny`.
 *
 * Keeps the N cheapest combos seen so far in O(log N) per offer. This is what
 * makes the enumeration cap safe: the cap bounds memory, but the *set* it holds
 * is still the globally cheapest one, so top-K never depends on the cap.
 */
class MaxHeapCandidates {
  private readonly heap: Candidate[] = [];

  constructor(private readonly capacity: number) {}

  /** False means the candidate was discarded because the heap was already cheaper. */
  offer(candidate: Candidate): boolean {
    if (this.capacity <= 0) return false;

    if (this.heap.length < this.capacity) {
      this.heap.push(candidate);
      this.siftUp(this.heap.length - 1);
      return true;
    }

    const worst = this.heap[0];
    if (!worst || candidate.menuTotalCny >= worst.menuTotalCny) return false;
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
      if (mother.menuTotalCny >= child.menuTotalCny) break;
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
      let largest = index;
      if (left < size && (this.heap[left] as Candidate).menuTotalCny > (this.heap[largest] as Candidate).menuTotalCny) {
        largest = left;
      }
      if (right < size && (this.heap[right] as Candidate).menuTotalCny > (this.heap[largest] as Candidate).menuTotalCny) {
        largest = right;
      }
      if (largest === index) return;
      const a = this.heap[index] as Candidate;
      this.heap[index] = this.heap[largest] as Candidate;
      this.heap[largest] = a;
      index = largest;
    }
  }
}
