'use client';

import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import StageRail from '@/components/StageRail';
import ResultCard from '@/components/ResultCard';
import TracePanel from '@/components/TracePanel';
import { EXAMPLES } from '@/lib/examples';
import type { BuildResult } from '@mealscript/verifier/pipeline';

const MealEditor = dynamic(() => import('@/components/MealEditor'), {
  ssr: false,
  loading: () => <div className="p-4 text-sm text-[#6b6b75]">正在加载编辑器…</div>,
});

export default function Page() {
  const [source, setSource] = useState<string>(EXAMPLES[0]!.source);
  const [exampleId, setExampleId] = useState<string>(EXAMPLES[0]!.id);
  const [mode, setMode] = useState<'replay' | 'live'>('replay');
  const [result, setResult] = useState<BuildResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch('/api/build', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source, mode }),
      });
      const payload = (await response.json()) as BuildResult & { error?: string };
      if (!response.ok || payload.error) {
        setError(payload.error ?? '构建失败');
        setResult(null);
      } else {
        setResult(payload);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [source, mode]);

  const events = useMemo(() => result?.trace.events ?? [], [result]);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1400px] flex-col gap-4 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-700 pb-4">
        <div>
          <h1 className="font-mono text-lg text-gold-300">MealScript</h1>
          <p className="text-xs text-[#6b6b75]">
            麦门编译器 · Code Your Meal. Compile Your Hunger.
          </p>
          <p className="mt-1 text-[11px] text-[#8a8a94]">
            非麦当劳官方产品 / 独立参赛作品 · 只读查询，永不创建真实订单
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-ink-700">
            {(['replay', 'live'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`px-3 py-1.5 text-xs transition-colors ${
                  mode === value ? 'bg-gold-500/15 text-gold-300' : 'text-[#6b6b75] hover:text-[#c9c9d1]'
                }`}
              >
                {value === 'replay' ? 'Replay' : 'Live'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="rounded-lg bg-gold-500 px-4 py-1.5 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {running ? 'Compiling…' : 'Compile'}
          </button>
        </div>
      </header>

      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      ) : null}

      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.55fr)_minmax(0,0.95fr)]">
        <section className="flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
          <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
            <span className="text-xs text-[#6b6b75]">编辑器 · .meal</span>
            <select
              value={exampleId}
              onChange={(e) => {
                const next = EXAMPLES.find((x) => x.id === e.target.value);
                if (next) {
                  setExampleId(next.id);
                  setSource(next.source);
                  setResult(null);
                }
              }}
              className="max-w-[60%] rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-[#c9c9d1] outline-none"
            >
              {EXAMPLES.map((example) => (
                <option key={example.id} value={example.id}>
                  {example.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <MealEditor value={source} onChange={setSource} onRun={run} />
          </div>
          <p className="border-t border-ink-700 px-3 py-2 text-[11px] text-[#6b6b75]">Ctrl / ⌘ + Enter 运行</p>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-ink-700 bg-ink-900 p-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-[#6b6b75]">执行阶段</h2>
          <StageRail events={events} />
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-ink-700 bg-ink-900 p-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-[#6b6b75]">结果卡</h2>
          <ResultCard result={result} />
        </section>
      </div>

      <section className="min-h-[220px] rounded-xl border border-ink-700 bg-ink-900 p-3">
        <TracePanel events={events} diagnostics={result?.diagnostics ?? []} />
      </section>
    </main>
  );
}
