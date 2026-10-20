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
  /** How many passing candidates to keep — lowest *official* price first. */
  stopAfter?: number;
  /** Parallel calculate-price calls. Defaults to 3. */
  concurrency?: number;
  now?: () => string;
}

const DEFAULT_MAX_CALLS = 8;
const DEFAULT_STOP_AFTER = 3;
/** Official price calls are I/O bound; 3 in flight stays far below 600/min. */
const DEFAULT_CONCURRENCY = 3;

type Verdict = { ok: true; value: VerifiedCandidate } | { ok: false; errorCode?: string; message?: string };

/** Run `fn` over `items` with at most `limit` in flight, preserving input order. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Price verification (dev brief §05).
 *
 * The only number that decides whether a candidate passes is the official
 * `calculate-price` result. Menu prices are used for ordering and coarse
 * pruning, never for the final budget judgement.
 *
 * Ordering matters: candidates arrive sorted by *menu* price, but the answer
 * must be sorted by *official* price — a discounted combo can be cheaper at
 * checkout than one that looked cheaper on the menu. So every candidate in the
 * batch is priced (in parallel, then re-ordered by the official total) before
 * the cheapest `stopAfter` are kept. Stopping at the first N that happen to
 * pass would return the cheapest *by menu*, which is not the same thing.
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
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const now = options.now ?? (() => new Date().toISOString());

  const batch = candidates.slice(0, Math.max(0, maxCalls));
  const simulated = client.mode === 'replay';

  const verdicts = await mapWithConcurrency(batch, concurrency, async (candidate): Promise<Verdict> => {
    const result = await verifyPrice(
      client,
      storeCode,
      candidate.items.map((item) => ({ productCode: item.code, quantity: 1 })),
    );

    if (!result.ok || !result.quote) {
      return { ok: false, errorCode: result.errorCode ?? 'E500', message: result.message ?? '官方价格计算失败' };
    }

    const quote = result.quote;
    if (quote.totalCny > options.budgetCny) return { ok: false };

    // Replay simulations carry productName = code; map back to real names.
    const nameByCode = new Map(candidate.items.map((item) => [item.code, item.name]));
    return {
      ok: true,
      value: {
        lines: quote.lines.map((line) => ({
          productCode: line.productCode,
          productName: nameByCode.get(line.productCode) ?? line.productName,
          quantity: line.quantity,
          subtotalCny: line.subtotalCny,
        })),
        totalCny: quote.totalCny,
        budgetRemainingCny: Math.round((options.budgetCny - quote.totalCny) * 100) / 100,
        evidence: { tool: 'calculate-price', verifiedAt: now(), simulated },
      },
    };
  });

  const checked = batch.length;
  const rejected = verdicts.filter((verdict) => !verdict.ok).length;
  const firstError = verdicts.find(
    (verdict): verdict is { ok: false; errorCode: string; message: string } =>
      !verdict.ok && typeof verdict.errorCode === 'string',
  );

  const verified = verdicts
    .filter((verdict): verdict is { ok: true; value: VerifiedCandidate } => verdict.ok)
    .map((verdict) => verdict.value)
    .sort((a, b) => a.totalCny - b.totalCny)
    .slice(0, Math.max(0, stopAfter));

  if (verified.length > 0) {
    return { status: 'BUILD_PASSED', verified, checked, rejected };
  }

  if (firstError) {
    return {
      status: 'MCP_ERROR',
      verified: [],
      checked,
      rejected,
      errorCode: firstError.errorCode,
      message: firstError.message,
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
