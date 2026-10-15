import type { McdClient, MenuItem, PriceQuote, Store, ToolResult } from './types.ts';
import { normalizeMenu, normalizePrice, normalizeStores } from './normalizer.ts';

/** High-level read operations. Each one is read-only and never mutates state. */
export interface CatalogResult {
  ok: boolean;
  stores: Store[];
  errorCode?: string;
  message?: string;
  durationMs: number;
}

export interface MenuResult {
  ok: boolean;
  items: MenuItem[];
  errorCode?: string;
  message?: string;
  durationMs: number;
}

export interface PriceResult {
  ok: boolean;
  quote: PriceQuote | null;
  errorCode?: string;
  message?: string;
  durationMs: number;
}

type RawEnvelope = { success?: boolean; data?: unknown };

function unwrap<T>(result: ToolResult<unknown>): { raw: unknown; errorCode?: string; message?: string } {
  if (!result.ok) return { raw: undefined, errorCode: result.errorCode, message: result.message };
  const envelope = result.data as RawEnvelope | undefined;
  if (envelope && envelope.success === false) {
    return { raw: undefined, errorCode: 'E500', message: '工具返回 success=false' };
  }
  return { raw: result.data };
}

/** Step 1 — find a real store. v0.1 is pickup-only, so beType is always 1. */
export async function findStores(client: McdClient, location: { city: string; keyword: string }): Promise<CatalogResult> {
  const result = await client.callTool('query-nearby-stores', {
    beType: 1,
    searchType: 2,
    city: location.city,
    keyword: location.keyword,
  });
  const { raw, errorCode, message } = unwrap(result);
  const stores = normalizeStores(raw);
  if (errorCode) return { ok: false, stores: [], errorCode, message, durationMs: result.durationMs };
  if (stores.length === 0) {
    return {
      ok: false,
      stores: [],
      errorCode: 'E301',
      message: '该位置没有查询到可售门店，请调整 location 后重试',
      durationMs: result.durationMs,
    };
  }
  return { ok: true, stores, durationMs: result.durationMs };
}

/** Step 2 — fetch the sellable catalogue for a store. */
export async function fetchMenu(client: McdClient, storeCode: string): Promise<MenuResult> {
  const result = await client.callTool('query-meals', { storeCode, orderType: 1, beType: 1 });
  const { raw, errorCode, message } = unwrap(result);
  const items = normalizeMenu(raw);
  if (errorCode) return { ok: false, items: [], errorCode, message, durationMs: result.durationMs };
  if (items.length === 0) {
    return {
      ok: false,
      items: [],
      errorCode: 'E301',
      message: '该门店当前没有可售商品',
      durationMs: result.durationMs,
    };
  }
  return { ok: true, items, durationMs: result.durationMs };
}

/** Step 3 — verify a candidate's composition (kept shallow in v0.1). */
export async function fetchMealDetail(client: McdClient, storeCode: string, code: string) {
  return client.callTool('query-meal-detail', { storeCode, orderType: 1, beType: 1, code });
}

/** Step 4 — the official settlement price. This is the budget authority. */
export async function verifyPrice(
  client: McdClient,
  storeCode: string,
  items: Array<{ productCode: string; quantity: number }>,
): Promise<PriceResult> {
  const result = await client.callTool('calculate-price', { storeCode, orderType: 1, beType: 1, items });
  const { raw, errorCode, message } = unwrap(result);
  const quote = normalizePrice(raw);
  if (errorCode) return { ok: false, quote: null, errorCode, message, durationMs: result.durationMs };
  if (!quote) {
    return {
      ok: false,
      quote: null,
      errorCode: 'E500',
      message: '官方价格计算返回的响应无法解析，不视为验证通过',
      durationMs: result.durationMs,
    };
  }
  return { ok: true, quote, durationMs: result.durationMs };
}
