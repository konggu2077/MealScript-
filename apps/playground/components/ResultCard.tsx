'use client';

import type { BuildResult } from '@mealscript/verifier/pipeline';

const STATUS_STYLE: Record<string, string> = {
  BUILD_PASSED: 'border-ok-line bg-ok-bg text-ok-fg',
  REPLAY_RESULT: 'border-warn-line bg-warn-bg text-warn-fg',
  NO_VERIFIED_MATCH: 'border-warn-line bg-warn-bg text-warn-fg',
  COMPILATION_ERROR: 'border-err-line bg-err-bg text-[#ffb4a2]',
  MCP_ERROR: 'border-err-line bg-err-bg text-[#ffb4a2]',
};

export default function ResultCard({ result }: { result: BuildResult | null }) {
  if (!result) {
    return <p className="py-2 text-sm text-fg-3">点击 Compile 后，这里会显示 Build Report。</p>;
  }

  const badge = STATUS_STYLE[result.status] ?? 'border-ink-600 bg-ink-850 text-fg-2';
  const best = result.verified[0];

  return (
    <div className="flex flex-col">
      <div className="mb-3.5 flex items-center gap-2">
        <span className={`rounded-lg border px-2.5 py-1 font-mono text-[13px] ${badge}`}>{result.status}</span>
        <span
          className={`rounded-lg border px-2.5 py-1 font-mono text-[13px] ${
            result.mode === 'live' ? 'border-ok-line bg-ok-bg text-ok-fg' : 'border-ink-600 bg-ink-850 text-fg-2'
          }`}
        >
          {result.mode === 'live' ? 'LIVE' : 'REPLAY'}
        </span>
      </div>

      {result.status === 'COMPILATION_ERROR' ? (
        <p className="py-2 text-sm text-fg-3">编译在第一步就失败了，因此没有发起任何 MCP 调用。</p>
      ) : null}

      {result.message ? <p className="py-2 text-sm text-fg-3">{result.message}</p> : null}

      {result.store ? (
        <dl className="mb-3.5 grid grid-cols-[max-content_1fr] gap-x-[18px] gap-y-2 text-sm">
          <dt className="text-fg-3">门店</dt>
          <dd className="m-0">{result.store.storeName}</dd>
          <dt className="text-fg-3">门店编号</dt>
          <dd className="m-0 font-mono">{result.store.storeCode}</dd>
          {result.menuSize != null ? (
            <>
              <dt className="text-fg-3">可售商品</dt>
              <dd className="m-0">{result.menuSize} 件</dd>
            </>
          ) : null}
          {result.budgetCny != null ? (
            <>
              <dt className="text-fg-3">预算</dt>
              <dd className="m-0">≤ ¥{result.budgetCny.toFixed(2)}</dd>
            </>
          ) : null}
          {result.stats ? (
            <>
              <dt className="text-fg-3">组合枚举</dt>
              <dd className="m-0">{result.stats.enumerated} 个</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {best ? (
        <>
          <div className="mb-3.5 overflow-hidden rounded-[10px] border border-ink-700">
            {best.lines.map((line) => (
              <div
                key={line.productCode}
                className="flex items-center gap-2.5 border-b border-ink-700 px-3 py-2.5 text-sm last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate">{line.productName}</span>
                {/* 同款多份：官方回合并后的一行 + quantity，标出份数免得看起来像单价错了 */}
                {line.quantity > 1 ? (
                  <span className="shrink-0 rounded-[5px] border border-warn-line bg-warn-bg px-1.5 py-px font-mono text-xs text-gold-300">
                    ×{line.quantity}
                  </span>
                ) : null}
                <span className="ml-auto font-mono text-xs text-fg-3">#{line.productCode}</span>
                <span className="w-[78px] shrink-0 text-right font-mono">¥{line.subtotalCny.toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* 折扣取官方 calculate-price 的 productPrice - price；无折扣时不渲染，避免噪声 */}
          {best.discountCny > 0 ? (
            <p className="-mt-1 mb-2.5 flex items-baseline gap-2 text-[13px] text-fg-3">
              原价 <s className="font-mono">¥{best.productTotalCny.toFixed(2)}</s>
              <b className="font-semibold text-ok-fg">已省 ¥{best.discountCny.toFixed(2)}</b>
            </p>
          ) : null}

          <div className="mb-3 flex items-baseline gap-3 rounded-[10px] border border-warn-line bg-warn-bg px-4 py-3.5">
            <span className="font-mono text-[28px] font-semibold leading-none text-gold-300">
              ¥{best.totalCny.toFixed(2)}
            </span>
            <span className="text-[13px] text-fg-2">
              官方结算价 · 预算剩余 ¥{best.budgetRemainingCny.toFixed(2)}
            </span>
          </div>

          <p className="text-xs leading-relaxed text-fg-3">
            证据：<code className="font-mono text-fg-2">{best.evidence.tool}</code> · 校验于{' '}
            <code className="font-mono text-fg-2">{new Date(best.evidence.verifiedAt).toLocaleString('zh-CN')}</code>
            {best.evidence.simulated ? <span className="text-warn-fg"> · 脱敏样例模拟价，非实时查询</span> : null}
          </p>
        </>
      ) : result.status !== 'COMPILATION_ERROR' ? (
        <p className="py-2 text-sm text-fg-3">没有产出通过官方价格校验的组合。</p>
      ) : null}

      {result.searchScope ? (
        <p className="mt-2.5 text-xs leading-relaxed text-fg-3">搜索范围：{result.searchScope}</p>
      ) : null}
    </div>
  );
}
