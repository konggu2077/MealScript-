import { describe, expect, it } from 'vitest';
import { buildCandidates, type OptimizerItem } from '@mealscript/optimizer';

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

  it('never repeats the same item inside one candidate', () => {
    const result = buildCandidates(MENU, { ...base, budget: { amountCny: 100 } });
    for (const candidate of result.candidates) {
      expect(new Set(candidate.items.map((i) => i.code)).size).toBe(candidate.items.length);
    }
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
    // The DSL rejects max_items > 3, but direct callers are not protected.
    const result = buildCandidates(MENU, { ...base, maxItems: 5, budget: { amountCny: 100 } });
    expect(result.stats.exhaustive).toBe(false);
    expect(result.stats.searchScope).toContain('max_items 超过 3');
  });
});
