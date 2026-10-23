import { describe, expect, it } from 'vitest';
import { aggregateItems, buildCandidates, MAX_SEARCH_ITEMS, type OptimizerItem } from '@mealscript/optimizer';
import { MAX_ITEMS_LIMIT } from '@mealscript/compiler';

const MENU: OptimizerItem[] = [
  { code: 'a', name: '香辣汉堡', priceCny: 20, tags: ['汉堡'] },
  { code: 'b', name: '双层汉堡', priceCny: 25 },
  { code: 'c', name: '薯条', priceCny: 10 },
  { code: 'd', name: '冰咖啡', priceCny: 12 },
  { code: 'e', name: '可乐', priceCny: 8 },
  { code: 'f', name: '汉堡套餐', priceCny: 30 },
  { code: 'g', name: '麦咖啡美式', priceCny: 15 },
];

const base = {
  requireKeywords: [],
  excludeKeywords: [] as string[],
  minItems: 1,
  maxItems: 2,
  budget: { amountCny: 40 },
};

describe('bounded combination search', () => {
  it('drops every item matching an exclude keyword', () => {
    const result = buildCandidates(MENU, { ...base, excludeKeywords: ['咖啡'] });
    const codes = result.candidates.flatMap((c) => c.items.map((i) => i.code));
    expect(codes).not.toContain('d');
    expect(codes).not.toContain('g');
  });

  it('keeps only combinations containing the required keyword', () => {
    const result = buildCandidates(MENU, { ...base, requireKeywords: ['汉堡'], maxItems: 2 });
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.items.some((item) => item.name.includes('汉堡'))).toBe(true);
    }
  });

  it('matches the required keyword against tags as well as names', () => {
    const tagged: OptimizerItem[] = [{ code: 'x', name: '神秘单品', priceCny: 9, tags: ['汉堡'] }];
    const result = buildCandidates(tagged, { ...base, requireKeywords: ['汉堡'] });
    expect(result.ok).toBe(true);
  });

  it('matches the required keyword against category names too', () => {
    // Users naturally type category names like "小食" / "饮品" as keywords.
    const categorized: OptimizerItem[] = [
      { code: 'a', name: '薯条', priceCny: 14.5, category: '小食' },
      { code: 'b', name: '圆筒冰淇淋', priceCny: 5, category: '甜品冰淇淋' },
    ];
    const snack = buildCandidates(categorized, { ...base, requireKeywords: ['小食'] });
    expect(snack.ok).toBe(true);
    expect(snack.candidates[0]?.items[0]?.code).toBe('a');
    const dessert = buildCandidates(categorized, { ...base, requireKeywords: ['甜品'] });
    expect(dessert.ok).toBe(true);
    expect(dessert.candidates[0]?.items[0]?.code).toBe('b');
  });

  it('excludes items by category keyword as well', () => {
    const categorized: OptimizerItem[] = [
      { code: 'a', name: '鲜萃美式', priceCny: 9.5, category: '麦咖啡™' },
      { code: 'b', name: '薯条', priceCny: 14.5, category: '小食' },
    ];
    const result = buildCandidates(categorized, { ...base, excludeKeywords: ['咖啡'], minItems: 1, maxItems: 1 });
    const codes = result.candidates.flatMap((c) => c.items.map((i) => i.code));
    expect(codes).not.toContain('a');
    expect(codes).toContain('b');
  });

  it('builds a multi-item meal from the whole menu, not just the keyword hits', () => {
    // Regression: the pool used to be narrowed to keyword hits, so "汉堡 + 小食"
    // was impossible — the second item had to be another burger.
    const menu: OptimizerItem[] = [
      { code: 'burger', name: '香辣汉堡', priceCny: 20, category: '鸡肉汉堡/卷' },
      { code: 'fries', name: '薯条', priceCny: 10, category: '小食' },
      { code: 'coke', name: '可乐', priceCny: 8, category: '饮品' },
    ];
    const result = buildCandidates(menu, { ...base, requireKeywords: ['汉堡'], minItems: 2, maxItems: 2 });
    expect(result.ok).toBe(true); // before the fix this was E220 with 0 combinations
    const combos = result.candidates.map((c) => c.items.map((i) => i.code).sort().join('+'));
    expect(combos.length).toBeGreaterThan(0);
    // The second item comes from the wider menu (薯条 / 可乐), not another burger.
    for (const combo of combos) {
      expect(combo).toContain('burger');
      expect(combo === 'burger+coke' || combo === 'burger+fries').toBe(true);
    }
    for (const candidate of result.candidates) {
      expect(candidate.items.some((i) => i.name.includes('汉堡'))).toBe(true);
    }
  });

  it('offers distinct plans instead of the same hit padded with a different side', () => {
    const menu: OptimizerItem[] = [
      { code: 'burger', name: '香辣汉堡', priceCny: 20, category: '鸡肉汉堡/卷' },
      { code: 'd1', name: '圆筒A', priceCny: 5, category: '甜品冰淇淋' },
      { code: 'd2', name: '圆筒B', priceCny: 5, category: '甜品冰淇淋' },
      { code: 'd3', name: '圆筒C', priceCny: 5, category: '甜品冰淇淋' },
    ];
    const result = buildCandidates(menu, { ...base, requireKeywords: ['汉堡'], minItems: 1, maxItems: 2, budget: { amountCny: 40 } });
    const signatures = result.candidates.map((c) => `${c.items.length}:${c.items.map((i) => i.code).sort().join('+')}`);
    expect(signatures).toEqual(['1:burger', '2:burger+d1']);
  });

  it('tells the user which categories exist when a keyword matches nothing', () => {
    const menu: OptimizerItem[] = [
      { code: 'a', name: '薯条', priceCny: 14.5, category: '小食' },
      { code: 'b', name: '雪碧', priceCny: 9.5, category: '饮品' },
    ];
    const result = buildCandidates(menu, { ...base, requireKeywords: ['饮料'] });
    expect(result.errorCode).toBe('E211');
    expect(result.message).toContain('小食');
    expect(result.message).toContain('饮品');
  });

  it('E211 when nothing in the menu matches the required keyword', () => {
    const result = buildCandidates(MENU, { ...base, requireKeywords: ['披萨'] });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('E211');
  });

  it('AND-requires every keyword: each one needs its own item in the meal', () => {
    // 薯条 + 可乐 are two separate products, so a valid meal needs both.
    const result = buildCandidates(MENU, {
      ...base,
      requireKeywords: ['薯条', '可乐'],
      minItems: 2,
      maxItems: 3,
      budget: { amountCny: 60 },
    });
    expect(result.ok).toBe(true);
    for (const candidate of result.candidates) {
      expect(candidate.items.some((item) => item.name.includes('薯条'))).toBe(true);
      expect(candidate.items.some((item) => item.name.includes('可乐'))).toBe(true);
    }
  });

  it('a one-word keyword list behaves exactly like the old single keyword', () => {
    const single = buildCandidates(MENU, { ...base, requireKeywords: ['汉堡'] });
    expect(single.ok).toBe(true);
    expect(single.candidates.length).toBeGreaterThan(0);
    for (const candidate of single.candidates) {
      expect(candidate.items.some((item) => item.name.includes('汉堡'))).toBe(true);
    }
  });

  it('names only the keywords that found no product', () => {
    const result = buildCandidates(MENU, { ...base, requireKeywords: ['汉堡', '披萨'] });
    expect(result.errorCode).toBe('E211');
    expect(result.message).toContain('披萨');
    expect(result.message).not.toContain('「汉堡」');
  });

  it('reports each keyword hit count in the search scope', () => {
    const result = buildCandidates(MENU, { ...base, requireKeywords: ['薯条', '可乐'], budget: { amountCny: 60 } });
    expect(result.stats.searchScope).toContain('「薯条」命中 1 件');
    expect(result.stats.searchScope).toContain('「可乐」命中 1 件');
  });

  it('E220 when the window is too narrow for one item per keyword', () => {
    const result = buildCandidates(MENU, {
      ...base,
      requireKeywords: ['薯条', '可乐'],
      minItems: 1,
      maxItems: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('E220');
    expect(result.message).toContain('max_items 只有 1');
  });

  it('an empty keyword list means "no product requirement"', () => {
    const result = buildCandidates(MENU, { ...base, requireKeywords: [] });
    expect(result.ok).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('respects the declared item-count window', () => {
    const result = buildCandidates(MENU, { ...base, minItems: 2, maxItems: 2, budget: { amountCny: 100 } });
    for (const candidate of result.candidates) {
      expect(candidate.items).toHaveLength(2);
    }
  });

  it('never produces an empty meal', () => {
    const result = buildCandidates(MENU, { ...base, minItems: 1, budget: { amountCny: 100 } });
    for (const candidate of result.candidates) {
      expect(candidate.items.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('hard-caps the window at three items', () => {
    const result = buildCandidates(MENU, { ...base, minItems: 3, maxItems: 3, budget: { amountCny: 100 } });
    for (const candidate of result.candidates) {
      expect(candidate.items.length).toBeLessThanOrEqual(3);
    }
  });

  it('prunes combinations that already exceed the budget on menu price', () => {
    const result = buildCandidates(MENU, { ...base, budget: { amountCny: 12 } });
    for (const candidate of result.candidates) {
      expect(candidate.menuTotalCny).toBeLessThanOrEqual(12);
    }
  });

  it('orders candidates cheapest first for min(total_price)', () => {
    const result = buildCandidates(MENU, { ...base, budget: { amountCny: 100 } });
    const totals = result.candidates.map((c) => c.menuTotalCny);
    expect([...totals].sort((a, b) => a - b)).toEqual(totals);
  });

  it('never repeats the same item inside one candidate by default', () => {
    const result = buildCandidates(MENU, { ...base, budget: { amountCny: 100 } });
    for (const candidate of result.candidates) {
      expect(new Set(candidate.items.map((i) => i.code)).size).toBe(candidate.items.length);
    }
  });

  it('fills two slots with one product once allow_repeat is on', () => {
    // 排除可乐后，2 件能吃下的只有 薯条×2 = ¥20（薯条+冰咖啡要 ¥22）。
    const result = buildCandidates(MENU, {
      ...base,
      minItems: 2,
      maxItems: 2,
      allowRepeat: true,
      excludeKeywords: ['可乐'],
      requireKeywords: ['薯条'],
      budget: { amountCny: 20 },
    });
    expect(result.ok).toBe(true);
    const top = result.candidates[0];
    expect(top?.items.map((i) => i.code)).toEqual(['c', 'c']);
    expect(top?.menuTotalCny).toBe(20);
    expect(result.stats.searchScope).toContain('允许同款多份');
  });

  it('cannot build 薯条 ×2 while allow_repeat is off', () => {
    const result = buildCandidates(MENU, {
      ...base,
      minItems: 2,
      maxItems: 2,
      requireKeywords: ['薯条'],
      budget: { amountCny: 20 },
    });
    for (const candidate of result.candidates) {
      expect(new Set(candidate.items.map((i) => i.code)).size).toBe(candidate.items.length);
    }
  });

  it('counts pieces, not distinct products, when a product repeats', () => {
    const result = buildCandidates(MENU, {
      ...base,
      minItems: 3,
      maxItems: 3,
      allowRepeat: true,
      requireKeywords: ['可乐'],
      budget: { amountCny: 24 },
    });
    // 可乐 ¥8 ×3 = ¥24 是最便宜的 3 件解。
    expect(result.candidates[0]?.items).toHaveLength(3);
    expect(result.candidates[0]?.items.every((i) => i.code === 'e')).toBe(true);
  });

  it('honours the topK ceiling', () => {
    const result = buildCandidates(MENU, { ...base, budget: { amountCny: 100 } }, { topK: 3 });
    expect(result.candidates.length).toBeLessThanOrEqual(3);
  });

  it('E220 when no combination fits the budget', () => {
    const result = buildCandidates(MENU, { ...base, requireKeywords: ['汉堡'], budget: { amountCny: 5 } });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('E220');
  });

  it('reports the search scope and whether it was exhaustive', () => {
    const result = buildCandidates(MENU, { ...base, budget: { amountCny: 100 } });
    expect(result.stats.searchScope).toContain('1–2');
    expect(result.stats.exhaustive).toBe(true);
    expect(result.stats.menuSize).toBe(MENU.length);
  });

  it('stays bounded on a large menu', () => {
    const big: OptimizerItem[] = Array.from({ length: 200 }, (_, i) => ({
      code: `p${i}`,
      name: `商品${i}`,
      priceCny: 1 + (i % 20),
    }));
    const started = Date.now();
    const result = buildCandidates(big, { ...base, maxItems: 3, budget: { amountCny: 30 } });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.candidates.length).toBeLessThanOrEqual(12);
  });

  it('retention keeps the globally cheapest combos, not the first ones enumerated', () => {
    // Enumeration is lexicographic over a price-sorted pool, which is not
    // monotonic in total: for prices 1,2,3,100 the pair (0,3)=101 is visited
    // before (1,2)=5. A "fill up then refuse" cap keeps 101 and loses the real
    // third-cheapest combo.
    const skewed: OptimizerItem[] = [
      { code: 'p0', name: 'A', priceCny: 1 },
      { code: 'p1', name: 'B', priceCny: 2 },
      { code: 'p2', name: 'C', priceCny: 3 },
      { code: 'p3', name: 'D', priceCny: 100 },
    ];

    const result = buildCandidates(
      skewed,
      { requireKeywords: [], excludeKeywords: [], minItems: 2, maxItems: 2, budget: { amountCny: 200 } },
      { maxCombinations: 3, topK: 3 },
    );

    expect(result.candidates.map((candidate) => candidate.menuTotalCny)).toEqual([3, 4, 5]);
  });

  it('says so when the retention cap dropped cheaper-or-equal combos', () => {
    const result = buildCandidates(
      MENU,
      { requireKeywords: [], excludeKeywords: [], minItems: 2, maxItems: 2, budget: { amountCny: 100 } },
      { maxCombinations: 2 },
    );
    expect(result.stats.searchScope).toContain('已保留最便宜的');
  });

  it('reports a clamped max_items instead of claiming exhaustiveness', () => {
    // The DSL rejects max_items above MAX_SEARCH_ITEMS, but direct callers are
    // not protected — the clamp has to stay honest on its own.
    const result = buildCandidates(MENU, { ...base, maxItems: MAX_SEARCH_ITEMS + 2, budget: { amountCny: 100 } });
    expect(result.stats.exhaustive).toBe(false);
    expect(result.stats.searchScope).toContain(`max_items 超过 ${MAX_SEARCH_ITEMS}`);
  });

  it('keeps its search ceiling in sync with the compiler limit', () => {
    // Duplicated constants in two dependency-free packages: if one moves, this
    // test is the only thing standing between the user and a silent E103.
    expect(MAX_SEARCH_ITEMS).toBe(MAX_ITEMS_LIMIT);
  });
});

/**
 * The DFS replaced three hard-coded nested loops, so the safest possible
 * check is to keep a stupid-but-obvious brute force next to it and demand
 * identical answers. If the pruning is ever wrong, this is what catches it.
 */
function bruteForceTotals(
  menu: OptimizerItem[],
  minItems: number,
  maxItems: number,
  budget: number,
  allowRepeat: boolean,
): number[] {
  const pool = [...menu].sort((a, b) => a.priceCny - b.priceCny);
  const totals: number[] = [];
  const pick: OptimizerItem[] = [];

  const walk = (start: number, sum: number) => {
    if (pick.length >= minItems) totals.push(Math.round(sum * 100) / 100);
    if (pick.length === maxItems) return;
    for (let i = start; i < pool.length; i += 1) {
      const item = pool[i] as OptimizerItem;
      const next = sum + item.priceCny;
      if (next > budget) break;
      pick.push(item);
      walk(allowRepeat ? i : i + 1, next);
      pick.pop();
    }
  };

  walk(0, 0);
  return totals;
}

const LADDER: OptimizerItem[] = [
  { code: 'p1', name: 'A', priceCny: 3 },
  { code: 'p2', name: 'B', priceCny: 5 },
  { code: 'p3', name: 'C', priceCny: 7 },
  { code: 'p4', name: 'D', priceCny: 9 },
  { code: 'p5', name: 'E', priceCny: 11 },
  { code: 'p6', name: 'F', priceCny: 13 },
  { code: 'p7', name: 'G', priceCny: 17 },
];

describe('search agrees with brute force (4–5 items)', () => {
  for (const size of [4, 5]) {
    for (const budget of [30, 40, 60]) {
      it(`min: ${size} items under ¥${budget}`, () => {
        const totals = bruteForceTotals(LADDER, size, size, budget, false);
        const expected = Math.min(...totals);
        const result = buildCandidates(LADDER, {
          requireKeywords: [],
          excludeKeywords: [],
          minItems: size,
          maxItems: size,
          budget: { amountCny: budget },
        });

        if (!Number.isFinite(expected)) {
          expect(result.ok).toBe(false);
          return;
        }
        expect(result.ok).toBe(true);
        expect(result.candidates[0]?.menuTotalCny).toBe(expected);
        expect(result.stats.exhaustive).toBe(true);
      });

      it(`max: ${size} items under ¥${budget}`, () => {
        const totals = bruteForceTotals(LADDER, size, size, budget, false);
        const expected = Math.max(...totals);
        const result = buildCandidates(LADDER, {
          requireKeywords: [],
          excludeKeywords: [],
          minItems: size,
          maxItems: size,
          budget: { amountCny: budget },
          optimize: { fn: 'max', target: 'total_price' },
        });

        if (!Number.isFinite(expected)) {
          expect(result.ok).toBe(false);
          return;
        }
        expect(result.ok).toBe(true);
        expect(result.candidates[0]?.menuTotalCny).toBe(expected);
        expect(result.candidates[0]?.menuTotalCny).toBeLessThanOrEqual(budget);
      });
    }
  }

  it('min/max with repetition still match brute force', () => {
    const totals = bruteForceTotals(LADDER, 4, 4, 20, true);
    const min = buildCandidates(LADDER, {
      requireKeywords: [],
      excludeKeywords: [],
      minItems: 4,
      maxItems: 4,
      budget: { amountCny: 20 },
      allowRepeat: true,
    });
    const max = buildCandidates(LADDER, {
      requireKeywords: [],
      excludeKeywords: [],
      minItems: 4,
      maxItems: 4,
      budget: { amountCny: 20 },
      allowRepeat: true,
      optimize: { fn: 'max', target: 'total_price' },
    });

    expect(min.candidates[0]?.menuTotalCny).toBe(Math.min(...totals));
    expect(max.candidates[0]?.menuTotalCny).toBe(Math.max(...totals));
    // ¥3 × 4 is the cheapest legal multiset, and it repeats the same product.
    expect(min.candidates[0]?.items.map((item) => item.code)).toEqual(['p1', 'p1', 'p1', 'p1']);
  });

  it('candidate order follows the optimize direction', () => {
    const shared = {
      requireKeywords: [],
      excludeKeywords: [] as string[],
      minItems: 4,
      maxItems: 4,
      budget: { amountCny: 60 },
    };
    const ascending = buildCandidates(LADDER, shared);
    const descending = buildCandidates(LADDER, { ...shared, optimize: { fn: 'max' as const, target: 'total_price' as const } });

    const ascTotals = ascending.candidates.map((c) => c.menuTotalCny);
    const descTotals = descending.candidates.map((c) => c.menuTotalCny);
    expect(ascTotals).toEqual([...ascTotals].sort((a, b) => a - b));
    expect(descTotals).toEqual([...descTotals].sort((a, b) => b - a));
    expect(descTotals[0]).toBeGreaterThan(ascTotals[0] as number);
  });

  it('admits when the node budget truncated the search', () => {
    const big: OptimizerItem[] = Array.from({ length: 40 }, (_, i) => ({
      code: `p${i}`,
      name: `商品${i}`,
      priceCny: 1 + ((i * 7) % 9),
    }));

    const result = buildCandidates(
      big,
      { requireKeywords: [], excludeKeywords: [], minItems: 5, maxItems: 5, budget: { amountCny: 400 } },
      { maxEnumerations: 500 },
    );

    expect(result.stats.exhaustive).toBe(false);
    expect(result.stats.searchScope).toContain('规模上限');
  });
});

describe('aggregateItems', () => {
  it('collapses repeated pieces into one line with a quantity, keeping order', () => {
    const a = { code: 'a', name: 'A', priceCny: 10 };
    const b = { code: 'b', name: 'B', priceCny: 8 };
    expect(aggregateItems([a, a, b])).toEqual([
      { item: a, qty: 2 },
      { item: b, qty: 1 },
    ]);
  });

  it('leaves a distinct meal untouched', () => {
    const a = { code: 'a', name: 'A', priceCny: 10 };
    const b = { code: 'b', name: 'B', priceCny: 8 };
    expect(aggregateItems([a, b]).map((line) => line.qty)).toEqual([1, 1]);
  });
});
