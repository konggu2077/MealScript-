import { compile, type Diagnostic } from '@mealscript/compiler';
import { fetchMenu, findStores, type McdClient, type MenuItem, type Store } from '@mealscript/mcp-adapter';
import { buildCandidates, type OptimizerStats } from '@mealscript/optimizer';
import { TraceRecorder, type Trace, type TraceMode } from '@mealscript/trace';
import { verifyCandidates, type VerifiedCandidate } from './index.ts';

export type BuildStatus =
  | 'BUILD_PASSED'
  | 'NO_VERIFIED_MATCH'
  | 'COMPILATION_ERROR'
  | 'MCP_ERROR'
  | 'REPLAY_RESULT';

export interface BuildResult {
  status: BuildStatus;
  /** Live or replay — surfaced to the UI on every result. */
  mode: TraceMode;
  trace: Trace;
  diagnostics: Diagnostic[];
  store?: Store;
  menuSize?: number;
  searchScope?: string;
  stats?: OptimizerStats;
  budgetCny?: number;
  verified: VerifiedCandidate[];
  errorCode?: string;
  message?: string;
}

/**
 * The whole pipeline: source → compile → store → menu → candidates → price.
 *
 * Honesty rules baked in:
 *  - a compile failure stops before any network call,
 *  - replay results are labelled REPLAY_RESULT and never BUILD_PASSED,
 *  - a failed price call is recorded and skipped, never faked as success,
 *  - the trace always carries the mode and the tool call evidence.
 */
export async function runBuild(source: string, client: McdClient): Promise<BuildResult> {
  const recorder = new TraceRecorder({ mode: client.mode });

  // --- parse + check ------------------------------------------------------
  const finishParse = recorder.start('parse', 'Parse · 词法与语法分析');
  const compiled = compile(source);
  const finishCheck = recorder.start('check', 'Check · 语义检查与 IR 生成');
  finishParse(compiled.ast ? 'ok' : 'error');
  finishCheck(compiled.ok ? 'ok' : 'error');

  if (!compiled.ok || !compiled.ir) {
    for (const diagnostic of compiled.diagnostics) {
      recorder.diagnostic(diagnostic.code.startsWith('E0') ? 'check' : 'result', diagnostic.code, diagnostic.message, `${diagnostic.line}:${diagnostic.column}`);
    }
    return {
      status: 'COMPILATION_ERROR',
      mode: client.mode,
      trace: recorder.finish(),
      diagnostics: compiled.diagnostics,
      verified: [],
      errorCode: compiled.diagnostics[0]?.code ?? 'E001',
      message: compiled.diagnostics[0]?.message ?? '编译失败',
    };
  }

  const ir = compiled.ir;

  // --- menu ---------------------------------------------------------------
  const finishMenu = recorder.start('menu', 'Menu · 查询门店与可售商品');
  const stores = await findStores(client, { city: ir.location.city, keyword: ir.location.keyword });
  if (!stores.ok) {
    finishMenu('error', stores.message);
    recorder.toolCall({
      phase: 'menu',
      tool: 'query-nearby-stores',
      status: 'error',
      errorCode: stores.errorCode,
      message: stores.message,
      durationMs: stores.durationMs,
    });
    return fail('MCP_ERROR', stores.errorCode, stores.message);
  }
  const store = stores.stores[0] as Store;
  recorder.toolCall({
    phase: 'menu',
    tool: 'query-nearby-stores',
    label: `找到门店 ${store.storeName}`,
    request: { city: ir.location.city, keyword: ir.location.keyword, beType: 1, searchType: 2 },
    response: { storeCode: store.storeCode, storeName: store.storeName, count: stores.stores.length },
    durationMs: stores.durationMs,
  });

  const menu = await fetchMenu(client, store.storeCode);
  if (!menu.ok) {
    finishMenu('error', menu.message);
    recorder.toolCall({
      phase: 'menu',
      tool: 'query-meals',
      status: 'error',
      errorCode: menu.errorCode,
      message: menu.message,
      durationMs: menu.durationMs,
    });
    return fail('MCP_ERROR', menu.errorCode, menu.message);
  }
  finishMenu('ok', `${menu.items.length} 个可售商品`);
  recorder.toolCall({
    phase: 'menu',
    tool: 'query-meals',
    label: `菜单 ${menu.items.length} 件`,
    request: { storeCode: store.storeCode, orderType: 1, beType: 1 },
    responseSummary: { count: menu.items.length },
    durationMs: menu.durationMs,
  });

  // --- optimize -----------------------------------------------------------
  const finishOptimize = recorder.start('optimize', 'Optimize · 有界组合搜索');
  const optimized = buildCandidates(menu.items as MenuItem[], ir);
  finishOptimize(optimized.ok ? 'ok' : 'error', optimized.stats.searchScope);
  recorder.note('optimize', optimized.stats.searchScope, `枚举 ${optimized.stats.enumerated} 个组合`);

  if (!optimized.ok) {
    return done('NO_VERIFIED_MATCH', optimized.errorCode, optimized.message, {
      store,
      menuSize: menu.items.length,
      stats: optimized.stats,
      budgetCny: ir.budget.amountCny,
    });
  }

  // --- price --------------------------------------------------------------
  const finishPrice = recorder.start('price', 'Price · 官方价格校验');
  const verification = await verifyCandidates(client, store.storeCode, optimized.candidates, {
    budgetCny: ir.budget.amountCny,
    fn: ir.optimize.fn,
  });
  finishPrice(verification.status === 'BUILD_PASSED' ? 'ok' : 'error', `校验 ${verification.checked} 个候选`);

  for (const candidate of verification.verified) {
    recorder.toolCall({
      phase: 'price',
      tool: 'calculate-price',
      label: `官方结算价 ¥${candidate.totalCny.toFixed(2)}`,
      request: { storeCode: store.storeCode, items: candidate.lines.map((l) => ({ productCode: l.productCode, quantity: l.quantity })) },
      response: { price: candidate.totalCny, productPrice: candidate.productTotalCny, discount: candidate.discountCny },
    });
  }

  if (verification.status === 'MCP_ERROR') {
    return done('MCP_ERROR', verification.errorCode, verification.message, {
      store,
      menuSize: menu.items.length,
      stats: optimized.stats,
      budgetCny: ir.budget.amountCny,
    });
  }

  if (verification.status === 'NO_VERIFIED_MATCH') {
    return done('NO_VERIFIED_MATCH', verification.errorCode, verification.message, {
      store,
      menuSize: menu.items.length,
      stats: optimized.stats,
      budgetCny: ir.budget.amountCny,
    });
  }

  recorder.stage('result', 'Result · 生成 Build Report', 'ok');
  const scope = optimized.stats.searchScope;
  return done(client.mode === 'live' ? 'BUILD_PASSED' : 'REPLAY_RESULT', undefined, undefined, {
    store,
    menuSize: menu.items.length,
    searchScope: scope,
    stats: optimized.stats,
    budgetCny: ir.budget.amountCny,
    verified: verification.verified,
  });

  function fail(status: BuildStatus, errorCode?: string, message?: string): BuildResult {
    return {
      status,
      mode: client.mode,
      trace: recorder.finish(),
      diagnostics: compiled.diagnostics,
      verified: [],
      ...(errorCode ? { errorCode } : {}),
      ...(message ? { message } : {}),
    };
  }

  function done(
    status: BuildStatus,
    errorCode: string | undefined,
    message: string | undefined,
    extra: Partial<BuildResult>,
  ): BuildResult {
    return {
      status,
      mode: client.mode,
      trace: recorder.finish(),
      diagnostics: compiled.diagnostics,
      verified: [],
      ...(errorCode ? { errorCode } : {}),
      ...(message ? { message } : {}),
      ...extra,
    };
  }
}
