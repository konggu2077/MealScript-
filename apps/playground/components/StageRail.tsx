'use client';

import type { TraceEvent, TracePhase } from '@mealscript/trace';

const PHASES: { id: TracePhase; label: string; hint: string }[] = [
  { id: 'parse', label: 'Parse', hint: '词法与语法分析' },
  { id: 'check', label: 'Check', hint: '语义检查与 IR' },
  { id: 'menu', label: 'Menu', hint: '门店与可售商品' },
  { id: 'optimize', label: 'Optimize', hint: '有界组合搜索' },
  { id: 'price', label: 'Price', hint: '官方价格校验' },
  { id: 'result', label: 'Result', hint: '生成 Build Report' },
];

function statusOf(events: TraceEvent[], phase: TracePhase): { state: string; duration?: number; label?: string } {
  const stages = events.filter((e) => e.phase === phase && e.kind === 'stage');
  if (stages.length === 0) return { state: 'idle' };
  const last = stages[stages.length - 1];
  return { state: last?.status ?? 'idle', duration: last?.durationMs, label: last?.message };
}

const DOT: Record<string, string> = {
  idle: 'bg-ink-600',
  running: 'bg-gold-400 animate-pulse',
  ok: 'bg-emerald-400',
  error: 'bg-red-500',
  skipped: 'bg-ink-600',
};

export default function StageRail({ events }: { events: TraceEvent[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {PHASES.map((phase, index) => {
        const { state, duration, label } = statusOf(events, phase.id);
        return (
          <li
            key={phase.id}
            className={`rounded-lg border px-3 py-2 transition-colors ${
              state === 'ok'
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : state === 'error'
                  ? 'border-red-500/40 bg-red-500/5'
                  : state === 'running'
                    ? 'border-gold-500/40 bg-gold-500/5'
                    : 'border-ink-700 bg-ink-850'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[state] ?? DOT.idle}`} />
              <span className="font-mono text-xs text-[#8a8a94]">{String(index + 1).padStart(2, '0')}</span>
              <span className="flex-1 text-sm font-medium">{phase.label}</span>
              {duration !== undefined ? <span className="font-mono text-xs text-[#6b6b75]">{duration}ms</span> : null}
            </div>
            <p className="mt-1 pl-6 text-xs text-[#6b6b75]">{label ?? phase.hint}</p>
          </li>
        );
      })}
    </ol>
  );
}
