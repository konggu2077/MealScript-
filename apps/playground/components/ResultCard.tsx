'use client';

import type { BuildResult } from '@mealscript/verifier/pipeline';

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  BUILD_PASSED: { label: 'BUILD_PASSED', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  REPLAY_RESULT: { label: 'REPLAY_RESULT', className: 'border-gold-500/40 bg-gold-500/10 text-gold-300' },
  NO_VERIFIED_MATCH: { label: 'NO_VERIFIED_MATCH', className: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  COMPILATION_ERROR: { label: 'COMPILATION_ERROR', className: 'border-red-500/40 bg-red-500/10 text-red-300' },
  MCP_ERROR: { label: 'MCP_ERROR', className: 'border-red-500/40 bg-red-500/10 text-red-300' },
};

export default function ResultCard({ result }: { result: BuildResult | null }) {
  if (!result) {
    return (
      <div className="rounded-xl border border-ink-700 bg-ink-850 p-4 text-sm text-[#6b6b75]">
        点击 Compile 后，这里会显示结果卡。
      </div>
    );
  }

  const badge = STATUS_STYLE[result.status] ?? {
    label: result.status,
    className: 'border-ink-600 bg-ink-800 text-[#c9c9d1]',
  };
  const best = result.verified[0];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className={`rounded-md border px-2 py-1 font-mono text-[11px] ${badge.className}`}>{badge.label}</span>
        <span
          className={`rounded-md border px-2 py-1 font-mono text-[11px] ${
            result.mode === 'live'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-gold-500/40 bg-gold-500/10 text-gold-300'
          }`}
        >
          {result.mode === 'live' ? 'LIVE · 真实 MCP' : 'REPLAY · 脱敏样例'}
        </span>
      </div>

      {result.message ? (
        <p className="rounded-lg border border-ink-700 bg-ink-850 p-3 text-sm text-[#c9c9d1]">{result.message}</p>
      ) : null}

      {result.errorCode ? (
        <p className="font-mono text-xs text-red-300">{result.errorCode}</p>
      ) : null}

      {best ? (
        <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-[#6b6b75]">官方结算价</span>
            <span className="font-mono text-2xl text-gold-300">¥{best.totalCny.toFixed(2)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between text-xs text-[#6b6b75]">
            <span>预算 ¥{result.budgetCny?.toFixed(2) ?? '-'}</span>
            <span className="text-emerald-300">剩余 ¥{best.budgetRemainingCny.toFixed(2)}</span>
          </div>

          <ul className="mt-3 flex flex-col gap-1 border-t border-ink-700 pt-3">
            {best.lines.map((line) => (
              <li key={line.productCode} className="flex items-center justify-between text-sm">
                <span>
                  {line.productName}
                  <span className="ml-2 font-mono text-[11px] text-[#6b6b75]">×{line.quantity}</span>
                </span>
                <span className="font-mono text-xs text-[#c9c9d1]">¥{line.subtotalCny.toFixed(2)}</span>
              </li>
            ))}
          </ul>

          {result.store ? (
            <p className="mt-3 border-t border-ink-700 pt-3 text-xs text-[#6b6b75]">
              门店：{result.store.storeName}
              <span className="ml-2 font-mono">{result.store.storeCode}</span>
            </p>
          ) : null}

          <p className="mt-2 text-[11px] text-[#6b6b75]">
            校验工具：{best.evidence.tool} · {new Date(best.evidence.verifiedAt).toLocaleString('zh-CN')}
            {best.evidence.simulated ? ' · 该价格来自 Replay 模拟，非实时核验' : ''}
          </p>
        </div>
      ) : null}

      {result.searchScope ? (
        <p className="rounded-lg border border-ink-700 bg-ink-900 p-3 text-[11px] leading-relaxed text-[#8a8a94]">
          搜索范围：{result.searchScope}
          {result.stats ? ` · 枚举 ${result.stats.enumerated} 个组合` : ''}
        </p>
      ) : null}
    </div>
  );
}
