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
  requireKeyword: '',
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
    const result = buildCandidates(MENU, { ...base, requireKeyword: '汉堡', maxItems: 2 });
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.items.some((item) => item.name.includes('汉堡'))).toBe(true);
    }
  });

  it('matches the required keyword against tags as well as names', () => {
    const tagged: OptimizerItem[] = [{ code: 'x', name: '神秘单品', priceCny: 9, tags: ['汉堡'] }];
    const result = buildCandidates(tagged, { ...base, requireKeyword: '汉堡' });
    expect(result.ok).toBe(true);
  });

  it('matches the required keyword against category names too', () => {
    // Users naturally type category names like "小食" / "饮品" as keywords.
    const categorized: OptimizerItem[] = [
      { code: 'a', name: '薯条', priceCny: 14.5, category: '小食' },
      { code: 'b', name: '圆筒冰淇淋', priceCny: 5, category: '甜品冰淇淋' },
    ];
    const snack = buildCandidates(categorized, { ...base, requireKeyword: '小食' });
    expect(snack.ok).toBe(true);
    expect(snack.candidates[0]?.items[0]?.code).toBe('a');
    const dessert = buildCandidates(categorized, { ...base, requireKeyword: '甜品' });
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

  it('E211 when nothing in the menu matches the required keyword', () => {
    const result = buildCandidates(MENU, { ...base, requireKeyword: '披萨' });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('E211');
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
    const result = buildCandidates(MENU, { ...base, requireKeyword: '汉堡', budget: { amountCny: 5 } });
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
});
