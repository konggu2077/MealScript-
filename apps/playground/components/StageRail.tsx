'use client';

import type { TraceEvent, TracePhase } from '@mealscript/trace';

const PHASES: { id: TracePhase; label: string; hint: string }[] = [
  { id: 'parse', label: 'Parse', hint: '词法与语法分析' },
  { id: 'check', label: 'Check', hint: '语义检查与 IR' },
  { id: 'menu', label: 'Menu', hint: '查询门店与菜单' },
  { id: 'optimize', label: 'Optimize', hint: '有界组合搜索' },
  { id: 'price', label: 'Price', hint: '官方价格校验' },
  { id: 'result', label: 'Result', hint: '生成 Build Report' },
];

function statusOf(events: TraceEvent[], phase: TracePhase): { state: string; duration?: number } {
  const stages = events.filter((e) => e.phase === phase && e.kind === 'stage');
  if (stages.length === 0) return { state: 'idle' };
  const failed = events.some(
    (e) => e.phase === phase && (e.kind === 'diagnostic' || (e.kind === 'tool_call' && e.status === 'error')),
  );
  const last = stages[stages.length - 1];
  return { state: failed ? 'error' : (last?.status ?? 'idle'), duration: last?.durationMs };
}

const CARD: Record<string, string> = {
  idle: 'border-ink-700 bg-ink-850',
  running: 'border-warn-line bg-warn-bg',
  ok: 'border-ok-line bg-ok-bg',
  error: 'border-err-line bg-err-bg',
  skipped: 'border-ink-700 bg-ink-850',
};

const DOT: Record<string, string> = {
  idle: 'bg-[#3a4250]',
  running: 'bg-gold-300 shadow-[0_0_8px_rgba(245,194,66,0.45)]',
  ok: 'bg-ok-fg shadow-[0_0_8px_rgba(74,222,128,0.45)]',
  error: 'bg-err-fg shadow-[0_0_8px_rgba(255,107,107,0.45)]',
  skipped: 'bg-[#3a4250]',
};

export default function StageRail({ events }: { events: TraceEvent[] }) {
  return (
    <ol className="flex flex-col gap-2 p-3">
      {PHASES.map((phase) => {
        const { state, duration } = statusOf(events, phase.id);
        return (
          <li
            key={phase.id}
            className={`flex items-center gap-2.5 rounded-[9px] border px-3 py-2 transition-colors ${
              CARD[state] ?? CARD.idle
            }`}
          >
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[state] ?? DOT.idle}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold leading-tight">{phase.label}</span>
              <span className="block text-[11px] leading-tight text-fg-2">{phase.hint}</span>
            </span>
            <span className="shrink-0 font-mono text-[11px] text-fg-3">
              {duration !== undefined ? `${duration}ms` : '—'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
