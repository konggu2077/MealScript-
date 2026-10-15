export type McdToolName =
  | 'query-nearby-stores'
  | 'query-meals'
  | 'query-meal-detail'
  | 'calculate-price'
  | 'query-store-coupons'
  | 'list-nutrition-foods';

/** Tools the adapter is allowed to call. Everything else is refused. */
export const READ_ONLY_TOOLS: McdToolName[] = [
  'query-nearby-stores',
  'query-meals',
  'query-meal-detail',
  'calculate-price',
  'query-store-coupons',
  'list-nutrition-foods',
];

/** Hard blocklist — these change the account or create a transaction. */
export const FORBIDDEN_TOOLS = [
  'create-order',
  'cancel-order',
  'mall-create-order',
  'party-order-create',
  'auto-bind-coupons',
  'draw-lottery',
  'delivery-create-address',
];

export interface Store {
  storeCode: string;
  storeName: string;
  /** `beCode` is only present for drive-through (beType=5). */
  beCode?: string;
  supportsReservation: boolean;
}

export interface MenuItem {
  code: string;
  name: string;
  /** Menu price in yuan (not fen). */
  priceCny: number;
  originalPriceCny: number;
  tags: string[];
  category: string;
  /** True when the price only applies if a membership card is bought alongside. */
  requiresWithOrder: boolean;
}

export interface PriceLine {
  productCode: string;
  productName: string;
  quantity: number;
  /** Line subtotal in yuan. */
  subtotalCny: number;
}

export interface PriceQuote {
  /** Final payable amount in yuan — the only number used for budget judgement. */
  totalCny: number;
  productTotalCny: number;
  discountCny: number;
  lines: PriceLine[];
  /** Always true when it came back from the official tool. */
  verified: boolean;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  errorCode?: string;
  message?: string;
  durationMs: number;
}

export interface McdClient {
  readonly mode: 'live' | 'replay';
  callTool<T = unknown>(name: McdToolName, args: Record<string, unknown>): Promise<ToolResult<T>>;
  close(): Promise<void>;
}

/** Rejection raised if anything tries to call a write operation. */
export class ForbiddenToolError extends Error {
  constructor(tool: string) {
    super(`MealScript never calls write operations. Refused: ${tool}`);
    this.name = 'ForbiddenToolError';
  }
}
