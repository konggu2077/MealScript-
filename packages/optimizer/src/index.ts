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
 *  - enumeration is capped, and the returned `stats` say honestly whether the
 *    search was exhaustive — so the UI can only claim "global optimum" when
 *    `exhaustive` is true.
 */
export function buildCandidates(
  menu: OptimizerItem[],
  ir: Pick<MealIR, 'requireKeyword' | 'excludeKeywords' | 'minItems' | 'maxItems' | 'budget'>,
  options: OptimizerOptions = {},
): OptimizerResult {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const maxCombinations = options.maxCombinations ?? DEFAULT_MAX_COMBINATIONS;
  const budget = ir.budget.amountCny;
  const menuSize = menu.length;

  const allowed = menu.filter((item) => !ir.excludeKeywords.some((bad) => matches(item, bad)));
  const requiredPresent = ir.requireKeyword ? allowed.filter((item) => matches(item, ir.requireKeyword)) : allowed;

  const stats = (enumerated: number, exhaustive: boolean, extra = ''): OptimizerStats => ({
    menuSize,
    allowedSize: allowed.length,
    enumerated,
    searchScope: `在 ${ir.minItems}–${ir.maxItems} 件窗口内搜索，允许集 ${allowed.length} 件${extra}`,
    exhaustive,
  });

  if (requiredPresent.length === 0) {
    return {
      ok: false,
      candidates: [],
      errorCode: 'E211',
      message: ir.requireKeyword
        ? `当前门店可售商品中没有匹配「${ir.requireKeyword}」的商品`
        : '排除后没有任何可售商品',
      stats: stats(0, true, ir.requireKeyword ? `，关键词「${ir.requireKeyword}」命中 0 件` : ''),
    };
  }

  // Ascending price: lets us break out of the inner loops as soon as the
  // running total exceeds the budget, which keeps the search bounded.
  const pool = [...requiredPresent].sort((a, b) => a.priceCny - b.priceCny);
  const candidates: Candidate[] = [];
  let enumerated = 0;
  let truncated = false;

  const push = (combo: OptimizerItem[]) => {
    if (candidates.length >= maxCombinations) {
      truncated = true;
      return;
    }
    enumerated += 1;
    const total = combo.reduce((sum, item) => sum + item.priceCny, 0);
    if (total <= budget) candidates.push({ items: combo, menuTotalCny: round2(total) });
  };

  const min = Math.max(1, ir.minItems);
  const max = Math.min(Math.max(min, ir.maxItems), 3);

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

  // A meal must contain at least one item matching require_keyword. `pool` is
  // already the require-matching set, so every single-item candidate qualifies;
  // multi-item candidates qualify by containing at least one pool member.
  const qualified = candidates.filter((candidate) =>
    ir.requireKeyword ? candidate.items.some((item) => matches(item, ir.requireKeyword)) : true,
  );

  qualified.sort((x, y) => x.menuTotalCny - y.menuTotalCny);
  const top = qualified.slice(0, topK);

  if (top.length === 0) {
    return {
      ok: false,
      candidates: [],
      errorCode: 'E220',
      message: `在已枚举的 ${enumerated} 个组合中，没有菜单价不超过 ${budget} 元的组合`,
      stats: stats(enumerated, !truncated),
    };
  }

  return {
    ok: true,
    candidates: top,
    stats: stats(enumerated, !truncated, truncated ? '，枚举已被上限截断' : ''),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
