import { verifyPrice, type McdClient } from '@mealscript/mcp-adapter';
import type { Candidate } from '@mealscript/optimizer';

export interface VerifiedLine {
  productCode: string;
  productName: string;
  quantity: number;
  subtotalCny: number;
}

export interface VerifiedCandidate {
  lines: VerifiedLine[];
  /** Official settlement price in yuan. */
  totalCny: number;
  budgetRemainingCny: number;
  evidence: {
    tool: 'calculate-price';
    verifiedAt: string;
    /** True only for replay simulation — the UI must show the Replay badge. */
    simulated: boolean;
  };
}

export type VerifyStatus = 'BUILD_PASSED' | 'NO_VERIFIED_MATCH' | 'MCP_ERROR';

export interface VerifyResult {
  status: VerifyStatus;
  verified: VerifiedCandidate[];
  /** How many candidates were checked and how many were rejected. */
  checked: number;
  rejected: number;
  errorCode?: string;
  message?: string;
}

export interface VerifyOptions {
  budgetCny: number;
  /** Cap on official calculate-price calls (rate limit is 600/min per token). */
  maxVerifiedCalls?: number;
  /** Stop once this many candidates pass — they arrive cheapest-first. */
  stopAfter?: number;
  now?: () => string;
}

const DEFAULT_MAX_CALLS = 8;
const DEFAULT_STOP_AFTER = 3;

/**
 * Price verification (dev brief §05).
 *
 * The only number that decides whether a candidate passes is the official
 * `calculate-price` result. Menu prices are used for ordering and coarse
 * pruning, never for the final budget judgement.
 *
 * Failure policy: a failed or unparseable call is recorded and skipped. It is
 * never turned into a "success", and partial results are returned as-is.
 */
export async function verifyCandidates(
  client: McdClient,
  storeCode: string,
  candidates: Candidate[],
  options: VerifyOptions,
): Promise<VerifyResult> {
  const maxCalls = options.maxVerifiedCalls ?? DEFAULT_MAX_CALLS;
  const stopAfter = options.stopAfter ?? DEFAULT_STOP_AFTER;
  const now = options.now ?? (() => new Date().toISOString());

  const verified: VerifiedCandidate[] = [];
  let checked = 0;
  let rejected = 0;
  let firstErrorCode: string | undefined;
  let firstErrorMessage: string | undefined;

  for (const candidate of candidates) {
    if (verified.length >= stopAfter) break;
    if (checked >= maxCalls) break;
    checked += 1;

    const result = await verifyPrice(
      client,
      storeCode,
      candidate.items.map((item) => ({ productCode: item.code, quantity: 1 })),
    );

    if (!result.ok || !result.quote) {
      rejected += 1;
      firstErrorCode ??= result.errorCode ?? 'E500';
      firstErrorMessage ??= result.message ?? '官方价格计算失败';
      continue;
    }

    const quote = result.quote;
    const simulated = client.mode === 'replay';
    // Replay simulations carry productName = code; map back to real names.
    const nameByCode = new Map(candidate.items.map((item) => [item.code, item.name]));
    const lines: VerifiedLine[] = quote.lines.map((line) => ({
      productCode: line.productCode,
      productName: nameByCode.get(line.productCode) ?? line.productName,
      quantity: line.quantity,
      subtotalCny: line.subtotalCny,
    }));

    if (quote.totalCny > options.budgetCny) {
      rejected += 1;
      continue;
    }

    verified.push({
      lines,
      totalCny: quote.totalCny,
      budgetRemainingCny: Math.round((options.budgetCny - quote.totalCny) * 100) / 100,
      evidence: { tool: 'calculate-price', verifiedAt: now(), simulated },
    });
  }

  if (verified.length > 0) {
    return { status: 'BUILD_PASSED', verified, checked, rejected };
  }

  if (firstErrorCode) {
    return {
      status: 'MCP_ERROR',
      verified: [],
      checked,
      rejected,
      errorCode: firstErrorCode,
      message: firstErrorMessage,
    };
  }

  return {
    status: 'NO_VERIFIED_MATCH',
    verified: [],
    checked,
    rejected,
    errorCode: 'E220',
    message: `已用官方价格校验 ${checked} 个候选，均不满足预算 ${options.budgetCny} 元`,
  };
}
