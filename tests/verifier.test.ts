import { describe, expect, it } from 'vitest';
import { verifyCandidates } from '@mealscript/verifier';
import type { McdClient, ToolResult } from '@mealscript/mcp-adapter';
import type { Candidate } from '@mealscript/optimizer';

/** Unit price in YUAN, keyed by product code. */
const PRICES: Record<string, number> = { a: 20, b: 25, c: 10 };

function fakeClient(
  options: { mode?: 'live' | 'replay'; official?: Record<string, number>; fail?: boolean; discountCny?: number } = {},
): McdClient {
  const official = options.official ?? PRICES;
  const discountFen = Math.round((options.discountCny ?? 0) * 100);
  return {
    mode: options.mode ?? 'live',
    async callTool<T>(name: string, args: Record<string, unknown>): Promise<ToolResult<T>> {
      if (name !== 'calculate-price') {
        return { ok: false, errorCode: 'E500', message: 'unexpected tool', durationMs: 1 };
      }
      if (options.fail) {
        return { ok: false, errorCode: 'E401', message: 'Token 错误或过期', durationMs: 1 };
      }
      const items = (args['items'] as Array<{ productCode: string; quantity: number }>) ?? [];
      let fen = 0;
      const productList = items.map((item) => {
        const unit = official[item.productCode] ?? 0;
        const subtotal = unit * 100 * item.quantity;
        fen += subtotal;
        return { productCode: item.productCode, productName: item.productCode, quantity: item.quantity, subtotal };
      });
      const payload = {
        success: true,
        data: { price: fen - discountFen, productPrice: fen, discount: discountFen, productList },
      };
      return { ok: true, data: payload as T, durationMs: 1 };
    },
    async close() {},
  };
}

const candidate = (codes: string[]): Candidate => ({
  items: codes.map((code) => ({ code, name: `商品-${code}`, priceCny: PRICES[code] ?? 0 })),
  menuTotalCny: codes.reduce((sum, code) => sum + (PRICES[code] ?? 0), 0),
});

describe('price verification', () => {
  it('accepts a candidate whose official price fits the budget', async () => {
    const result = await verifyCandidates(fakeClient(), 'STORE', [candidate(['a'])], { budgetCny: 25 });
    expect(result.status).toBe('BUILD_PASSED');
    expect(result.verified[0]?.totalCny).toBe(20);
    expect(result.verified[0]?.budgetRemainingCny).toBe(5);
  });

  it('uses the official price, not the menu price, for the final decision', async () => {
    // Menu says 20, the official settlement says 26 → over a 25 budget.
    const result = await verifyCandidates(fakeClient({ official: { a: 26 } }), 'STORE', [candidate(['a'])], {
      budgetCny: 25,
    });
    expect(result.status).toBe('NO_VERIFIED_MATCH');
    expect(result.errorCode).toBe('E220');
  });

  it('maps line names back to the real menu names', async () => {
    const result = await verifyCandidates(fakeClient(), 'STORE', [candidate(['a', 'c'])], { budgetCny: 40 });
    expect(result.verified[0]?.lines.map((l) => l.productName)).toEqual(['商品-a', '商品-c']);
  });

  it('surfaces the official discount instead of silently dropping it', async () => {
    const result = await verifyCandidates(fakeClient({ discountCny: 5 }), 'STORE', [candidate(['a'])], {
      budgetCny: 25,
    });
    const best = result.verified[0];
    // 20 元原价，官方优惠 5 元 → 实付 15。三者都必须来自官方报价。
    expect(best?.productTotalCny).toBe(20);
    expect(best?.discountCny).toBe(5);
    expect(best?.totalCny).toBe(15);
    expect(best?.budgetRemainingCny).toBe(10);
    // 行小计是折扣前的价，不能被 discount 污染。
    expect(best?.lines[0]?.subtotalCny).toBe(20);
  });

  it('reports zero discount when the official quote has none', async () => {
    const result = await verifyCandidates(fakeClient(), 'STORE', [candidate(['a'])], { budgetCny: 25 });
    expect(result.verified[0]?.discountCny).toBe(0);
    expect(result.verified[0]?.productTotalCny).toBe(20);
  });


  it('prices a repeated product with its real quantity, not as one piece', async () => {
    const seen: Array<Array<{ productCode: string; quantity: number }>> = [];
    const client: McdClient = {
      mode: 'replay',
      async callTool<T>(name: string, args: Record<string, unknown>): Promise<ToolResult<T>> {
        seen.push((args['items'] as Array<{ productCode: string; quantity: number }>) ?? []);
        const payload = {
          success: true,
          data: {
            price: 2000,
            productPrice: 2000,
            discount: 0,
            productList: [{ productCode: 'a', productName: 'a', quantity: 2, subtotal: 2000 }],
          },
        };
        return { ok: true, data: payload as T, durationMs: 1 };
      },
      async close() {},
    };
    const twoOfA: Candidate = {
      items: [
        { code: 'a', name: '商品-a', priceCny: 10 },
        { code: 'a', name: '商品-a', priceCny: 10 },
      ],
      menuTotalCny: 20,
    };

    const result = await verifyCandidates(client, 'STORE', [twoOfA], { budgetCny: 25 });

    // 一件商品只发一行请求，quantity = 2 —— 否则官方会按一件结算。
    expect(seen[0]).toEqual([{ productCode: 'a', quantity: 2 }]);
    expect(result.verified[0]?.totalCny).toBe(20);
  });


  it('returns MCP_ERROR and never a fake success when the tool fails', async () => {
    const result = await verifyCandidates(fakeClient({ fail: true }), 'STORE', [candidate(['a'])], { budgetCny: 100 });
    expect(result.status).toBe('MCP_ERROR');
    expect(result.errorCode).toBe('E401');
    expect(result.verified).toHaveLength(0);
  });

  it('keeps verified results when only some calls fail', async () => {
    let calls = 0;
    const flaky: McdClient = {
      mode: 'live',
      async callTool<T>(_name: string, args: Record<string, unknown>): Promise<ToolResult<T>> {
        calls += 1;
        if (calls === 1) return { ok: false, errorCode: 'E500', message: 'boom', durationMs: 1 };
        const items = (args['items'] as Array<{ productCode: string; quantity: number }>) ?? [];
        const fen = items.reduce((sum, i) => sum + (PRICES[i.productCode] ?? 0) * 100, 0);
        return {
          ok: true,
          data: { success: true, data: { price: fen, productPrice: fen, discount: 0, productList: [] } } as T,
          durationMs: 1,
        };
      },
      async close() {},
    };
    const result = await verifyCandidates(flaky, 'STORE', [candidate(['a']), candidate(['c'])], { budgetCny: 100 });
    expect(result.status).toBe('BUILD_PASSED');
    expect(result.verified.length).toBeGreaterThanOrEqual(1);
  });

  it('caps the number of official price calls', async () => {
    const result = await verifyCandidates(
      fakeClient(),
      'STORE',
      [candidate(['a']), candidate(['b']), candidate(['c']), candidate(['a'])],
      { budgetCny: 100, maxVerifiedCalls: 2 },
    );
    expect(result.checked).toBeLessThanOrEqual(2);
  });

  it('flags replay results as simulated', async () => {
    const result = await verifyCandidates(fakeClient({ mode: 'replay' }), 'STORE', [candidate(['a'])], {
      budgetCny: 100,
    });
    expect(result.verified[0]?.evidence.simulated).toBe(true);
  });

  it('picks the cheapest by official price even when menu order disagrees', async () => {
    // Candidate order is "cheapest menu price first": c ¥10, a ¥20, b ¥25.
    // b is discounted at checkout, so the official ranking is b ¥12 < a ¥20 < c ¥24.
    // Taking the first N that *pass* would return c — the cheapest on the menu,
    // not the cheapest at checkout.
    const official = { a: 20, b: 12, c: 24 };
    const one = (code: string, menu: number): Candidate => ({
      items: [{ code, name: `商品-${code}`, priceCny: menu }],
      menuTotalCny: menu,
    });

    const result = await verifyCandidates(fakeClient({ official }), 'STORE', [one('c', 10), one('b', 25), one('a', 20)], {
      budgetCny: 100,
      stopAfter: 1,
    });

    expect(result.status).toBe('BUILD_PASSED');
    expect(result.verified[0]?.totalCny).toBe(12);
  });

  it('returns the verified list sorted by official price', async () => {
    const official = { a: 20, b: 12, c: 24 };
    const one = (code: string, menu: number): Candidate => ({
      items: [{ code, name: `商品-${code}`, priceCny: menu }],
      menuTotalCny: menu,
    });

    const result = await verifyCandidates(fakeClient({ official }), 'STORE', [one('c', 10), one('a', 20), one('b', 25)], {
      budgetCny: 100,
      stopAfter: 3,
    });

    expect(result.verified.map((v) => v.totalCny)).toEqual([12, 20, 24]);
  });

  it('verifies in parallel while respecting the call cap', async () => {
    let inFlight = 0;
    let peak = 0;
    let calls = 0;

    const slow: McdClient = {
      mode: 'live',
      async callTool<T>(_name: string, args: Record<string, unknown>): Promise<ToolResult<T>> {
        calls += 1;
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        const items = (args['items'] as Array<{ productCode: string; quantity: number }>) ?? [];
        const fen = items.reduce((sum, i) => sum + (PRICES[i.productCode] ?? 0) * 100, 0);
        return {
          ok: true,
          data: { success: true, data: { price: fen, productPrice: fen, discount: 0, productList: [] } } as T,
          durationMs: 1,
        };
      },
      async close() {},
    };

    const list = ['a', 'b', 'c', 'a', 'b', 'c'].map((code) => candidate([code]));
    const result = await verifyCandidates(slow, 'STORE', list, {
      budgetCny: 100,
      maxVerifiedCalls: 6,
      concurrency: 3,
    });

    expect(calls).toBe(6);
    expect(result.checked).toBe(6);
    // Proves it is actually concurrent, and that the limit is honoured.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
