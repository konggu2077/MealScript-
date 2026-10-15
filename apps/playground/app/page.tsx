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
  loading: () => <div className="p-4 text-sm text-fg-3">正在加载编辑器…</div>,
});

export default function Page() {
  const [source, setSource] = useState<string>(EXAMPLES[0]!.source);
  const [exampleId, setExampleId] = useState<string>(EXAMPLES[0]!.id);
  const [mode, setMode] = useState<'replay' | 'live'>('replay');
  const [result, setResult] = useState<BuildResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runHint, setRunHint] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setRunHint('编译中…');
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
        setRunHint(null);
      } else {
        setResult(payload);
        setRunHint(`完成 · ${payload.trace.events.length} 个 trace 事件`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunHint(null);
    } finally {
      setRunning(false);
    }
  }, [source, mode]);

  const events = useMemo(() => result?.trace.events ?? [], [result]);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1300px] flex-col px-5 pb-12 pt-5">
      <header className="flex flex-wrap items-center gap-3 border-b border-ink-700 pb-4">
        <span className="font-mono text-xl font-semibold tracking-wide text-fg">
          <span className="text-gold-300">Meal</span>Script
        </span>
        <span className="text-sm text-fg-2">把「吃什么」写成一门语言，再把它编译成一份有官方价格证据的方案</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-3 py-1 font-mono text-xs ${
              result?.mode === 'live'
                ? 'border-ok-line bg-ok-bg text-ok-fg'
                : 'border-warn-line bg-warn-bg text-warn-fg'
            }`}
          >
            {result?.mode === 'live' ? 'LIVE' : 'REPLAY'}
          </span>
          <span className="rounded-full border border-ink-600 bg-ink-850 px-3 py-1 font-mono text-xs text-fg-2">
            v0.1 · dry_run
          </span>
          <span className="rounded-full border border-err-line bg-err-bg px-3 py-1 text-xs text-[#ffb4a2]">
            非麦当劳官方产品 · 独立参赛作品
          </span>
        </div>
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_190px_minmax(0,0.98fr)]">
        <section className="flex flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
          <div className="flex items-center gap-2 border-b border-ink-700 px-3.5 py-2.5 text-xs text-fg-2">
            <b className="font-semibold text-fg">源码</b>
            <span>MealScript v0.1</span>
            <span className="ml-auto text-fg-3">Ctrl + Enter 编译</span>
          </div>
          <div className="p-3.5">
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example.id}
                  type="button"
                  onClick={() => {
                    setExampleId(example.id);
                    setSource(example.source);
                    setResult(null);
                    setRunHint(null);
                  }}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    exampleId === example.id
                      ? 'border-gold-300 bg-warn-bg text-gold-300'
                      : 'border-ink-600 bg-ink-850 text-fg-2 hover:border-gold-300 hover:text-gold-300'
                  }`}
                >
                  {example.label}
                </button>
              ))}
            </div>
            <div className="mt-3 h-[330px] overflow-hidden rounded-[10px] border border-ink-700 bg-[#0e1116]">
              <MealEditor value={source} onChange={setSource} onRun={run} />
            </div>
            <div className="mt-3 flex items-center gap-2.5">
              <button
                type="button"
                onClick={run}
                disabled={running}
                className="rounded-[9px] border border-gold-300 bg-gold-300 px-[22px] py-2 text-sm font-semibold text-[#1a1300] transition-[filter] hover:brightness-110 disabled:opacity-50"
              >
                {running ? 'Compiling…' : 'Compile'}
              </button>
              <span className="text-xs text-fg-3">{runHint ?? ''}</span>
            </div>
          </div>
        </section>

        <section className="flex flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
          <div className="flex items-center gap-2 border-b border-ink-700 px-3.5 py-2.5 text-xs text-fg-2">
            <b className="font-semibold text-fg">执行阶段</b>
          </div>
          <StageRail events={events} />
        </section>

        <section className="flex flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
          <div className="flex items-center gap-2 border-b border-ink-700 px-3.5 py-2.5 text-xs text-fg-2">
            <b className="font-semibold text-fg">Build Report</b>
            <span className="ml-auto font-mono text-fg-3">
              {result?.trace.id ? result.trace.id.slice(0, 8) : ''}
            </span>
          </div>
          <div className="p-3.5">
            <ResultCard result={result} />
          </div>
        </section>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-err-line bg-err-bg px-3 py-2 text-sm text-[#ffb4a2]">{error}</p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <section className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
          <div className="flex items-center gap-2 border-b border-ink-700 px-3.5 py-2.5 text-xs text-fg-2">
            <b className="font-semibold text-fg">Diagnostics</b>
            <span className="ml-auto text-fg-3">{result?.diagnostics.length ?? 0} 条</span>
          </div>
          <div className="max-h-[280px] overflow-auto p-3.5">
            <TracePanel events={[]} diagnostics={result?.diagnostics ?? []} />
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
          <div className="flex items-center gap-2 border-b border-ink-700 px-3.5 py-2.5 text-xs text-fg-2">
            <b className="font-semibold text-fg">Trace</b>
            <span className="ml-auto text-fg-3">已脱敏 · 不含 Token 与个人信息</span>
          </div>
          <div className="max-h-[280px] overflow-auto p-3.5">
            <TracePanel events={events} diagnostics={[]} />
          </div>
          <p className="border-t border-ink-700 px-3.5 py-2.5 text-xs text-fg-3">
            每一次工具调用都留在 trace 里：调了什么、多久、返回了什么结构 —— 全部经过脱敏
          </p>
        </section>
      </div>

      <footer className="mt-6 border-t border-ink-700 pt-3.5 text-xs leading-relaxed text-fg-3">
        <p>
          本页默认跑 <b className="font-semibold text-fg-2">Replay</b>：门店与价格取自一次真实会话的
          <b className="font-semibold text-fg-2">脱敏录制样例</b>，因此状态是 <code className="font-mono text-fg-2">REPLAY_RESULT</code>，
          绝不会标成 <code className="font-mono text-fg-2">BUILD_PASSED</code>。切到 Live 需要配置
          <code className="font-mono text-fg-2">MCD_MCP_TOKEN</code>。
        </p>
        <p className="mt-1">
          全程只读，不调用下单、付款、领券等任何写操作。
        </p>
      </footer>
    </main>
  );
}
