import { ForbiddenToolError, type McdClient, type McdToolName, type ToolResult } from './types.ts';
import { FORBIDDEN_TOOLS } from './types.ts';

/**
 * A replay fixture: a redacted capture of a real session, replayed offline.
 *
 * Two rules the contest depends on:
 *  1. Every fixture declares `mode: "replay"` and the client reports that mode
 *     on every result — replay output can never be labelled as live.
 *  2. Only redacted data lives in the file, so fixtures are safe to commit.
 */
export interface ReplayFixture {
  id: string;
  mode: 'replay';
  capturedAt: string;
  redacted: boolean;
  note?: string;
  /** Tool name -> recorded response, or a recorded failure. */
  tools: Record<string, { result?: unknown; error?: { code: string; message: string } }>;
  /**
   * Deterministic price simulation for replay: productCode -> unit price in FEN.
   * Verified against the live server — for non-discounted items `calculate-price`
   * returns exactly the sum of the menu prices, so summing is a faithful
   * stand-in. Coupon / membership logic is NOT simulated and is never claimed
   * to be. Present only so a replay run can finish end to end offline.
   */
  priceIndex?: Record<string, number>;
}

export class FixtureClient implements McdClient {
  readonly mode = 'replay' as const;

  constructor(readonly fixture: ReplayFixture) {}

  async callTool<T>(name: McdToolName, args: Record<string, unknown>): Promise<ToolResult<T>> {
    if (FORBIDDEN_TOOLS.includes(name)) throw new ForbiddenToolError(name);
    const startedAt = Date.now();

    if (name === 'calculate-price' && this.fixture.priceIndex) {
      return {
        ok: true,
        data: this.simulatePrice(args) as T,
        durationMs: Date.now() - startedAt,
      };
    }

    const recorded = this.fixture.tools[name];

    if (!recorded) {
      return {
        ok: false,
        errorCode: 'E301',
        message: `Replay fixture「${this.fixture.id}」没有记录 ${name} 的响应`,
        durationMs: Date.now() - startedAt,
      };
    }

    if (recorded.error) {
      return {
        ok: false,
        errorCode: recorded.error.code,
        message: recorded.error.message,
        durationMs: Date.now() - startedAt,
      };
    }

    return { ok: true, data: recorded.result as T, durationMs: Date.now() - startedAt };
  }

  /**
   * Replay-only settlement simulation. Mirrors the real envelope shape
   * (money in FEN) and is flagged `simulated: true` so the UI can never
   * mistake it for a verified live price.
   */
  private simulatePrice(args: Record<string, unknown>): unknown {
    const index = this.fixture.priceIndex ?? {};
    const items = (args['items'] as Array<{ productCode: string; quantity: number }> | undefined) ?? [];
    const productList: Array<Record<string, unknown>> = [];
    let total = 0;

    for (const item of items) {
      const unit = index[item.productCode];
      if (unit === undefined) {
        return {
          success: false,
          message: `Replay 价格索引缺少商品 ${item.productCode}`,
          simulated: true,
        };
      }
      const quantity = Math.max(1, item.quantity ?? 1);
      const subtotal = unit * quantity;
      total += subtotal;
      productList.push({
        productCode: item.productCode,
        productName: item.productCode,
        quantity,
        originalSubtotal: subtotal,
        subtotal,
      });
    }

    return {
      success: true,
      simulated: true,
      data: {
        productOriginalPrice: total,
        productPrice: total,
        originalPrice: total,
        discount: 0,
        price: total,
        productList,
      },
    };
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
