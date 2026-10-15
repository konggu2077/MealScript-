import { describe, expect, it } from 'vitest';
import { verifyCandidates } from '@mealscript/verifier';
import type { McdClient, ToolResult } from '@mealscript/mcp-adapter';
import type { Candidate } from '@mealscript/optimizer';

/** Unit price in YUAN, keyed by product code. */
const PRICES: Record<string, number> = { a: 20, b: 25, c: 10 };

function fakeClient(options: { mode?: 'live' | 'replay'; official?: Record<string, number>; fail?: boolean } = {}): McdClient {
  const official = options.official ?? PRICES;
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
        data: { price: fen, productPrice: fen, discount: 0, productList },
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
});
