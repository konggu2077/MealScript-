import { z } from 'zod';
import type { MenuItem, PriceQuote, Store } from './types.ts';

/**
 * Response validation with Zod.
 *
 * The official server is the source of truth, so schemas are intentionally
 * permissive (`.passthrough()`): we validate the fields MealScript actually
 * depends on and ignore everything else. A shape change surfaces as a parse
 * failure instead of silently producing a wrong price.
 */

const StoresResponse = z
  .object({
    data: z.array(
      z
        .object({
          storeCode: z.string(),
          storeName: z.string(),
          beCode: z.string().optional(),
          reservation: z.boolean().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const MealsResponse = z
  .object({
    data: z
      .object({
        categories: z.array(
          z
            .object({
              name: z.string(),
              meals: z
                .array(z.object({ code: z.string(), tags: z.array(z.string()).optional() }).passthrough())
                .optional(),
            })
            .passthrough(),
        ),
        meals: z.record(
          z
            .object({
              name: z.string(),
              currentPrice: z.union([z.string(), z.number()]),
              originalPrice: z.union([z.string(), z.number()]).optional(),
              canWithOrder: z.boolean().optional(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
  })
  .passthrough();

const PriceResponse = z
  .object({
    data: z
      .object({
        price: z.number(),
        productPrice: z.number().optional(),
        discount: z.number().optional(),
        productList: z
          .array(
            z
              .object({
                productCode: z.string(),
                productName: z.string(),
                quantity: z.number(),
                subtotal: z.number(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

/** The official price API returns FEN; everything in MealScript is YUAN. */
export function fenToYuan(fen: number): number {
  return Math.round(fen) / 100;
}

const toYuan = (value: string | number | undefined): number => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? 'NaN');
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

/**
 * Store list → only storeCode / storeName / beCode survive.
 * Address, distance and coordinates are dropped on purpose: they are not
 * needed and keeping them would put location data into the repo.
 */
export function normalizeStores(raw: unknown): Store[] {
  const parsed = StoresResponse.safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data.data.map((store) => ({
    storeCode: store.storeCode,
    storeName: store.storeName,
    ...(store.beCode ? { beCode: store.beCode } : {}),
    supportsReservation: store.reservation ?? false,
  }));
}

/** Menu payload → flat, deduplicated item list with category and tags. */
export function normalizeMenu(raw: unknown): MenuItem[] {
  const parsed = MealsResponse.safeParse(raw);
  if (!parsed.success) return [];

  const { categories, meals } = parsed.data.data;
  const tagIndex = new Map<string, string[]>();
  const categoryIndex = new Map<string, string>();

  for (const category of categories) {
    for (const meal of category.meals ?? []) {
      const existing = tagIndex.get(meal.code) ?? [];
      tagIndex.set(meal.code, [...new Set([...existing, ...(meal.tags ?? [])])]);
      if (!categoryIndex.has(meal.code)) categoryIndex.set(meal.code, category.name.replace(/\s+/g, ''));
    }
  }

  const items: MenuItem[] = [];
  for (const [code, detail] of Object.entries(meals)) {
    const priceCny = toYuan(detail.currentPrice);
    if (!Number.isFinite(priceCny)) continue;
    items.push({
      code,
      name: detail.name,
      priceCny,
      originalPriceCny: toYuan(detail.originalPrice) || priceCny,
      tags: tagIndex.get(code) ?? [],
      category: categoryIndex.get(code) ?? '未分类',
      requiresWithOrder: detail.canWithOrder ?? false,
    });
  }
  return items.sort((a, b) => a.priceCny - b.priceCny);
}

/** Price payload → the single number the budget decision is made on. */
export function normalizePrice(raw: unknown): PriceQuote | null {
  const parsed = PriceResponse.safeParse(raw);
  if (!parsed.success) return null;
  const data = parsed.data.data;
  return {
    totalCny: fenToYuan(data.price),
    productTotalCny: fenToYuan(data.productPrice ?? data.price),
    discountCny: fenToYuan(data.discount ?? 0),
    lines: (data.productList ?? []).map((line) => ({
      productCode: line.productCode,
      productName: line.productName,
      quantity: line.quantity,
      subtotalCny: fenToYuan(line.subtotal),
    })),
    verified: true,
  };
}
