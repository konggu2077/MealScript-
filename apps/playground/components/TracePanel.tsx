'use client';

import type { Diagnostic } from '@mealscript/compiler';
import type { TraceEvent } from '@mealscript/trace';

const STATUS_TEXT: Record<string, string> = {
  ok: 'text-emerald-300',
  error: 'text-red-300',
  running: 'text-gold-300',
  skipped: 'text-[#6b6b75]',
};

export default function TracePanel({ events, diagnostics }: { events: TraceEvent[]; diagnostics: Diagnostic[] }) {
  return (
    <div className="flex h-full flex-col gap-3">
      {diagnostics.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[#6b6b75]">Diagnostics</h3>
          <ul className="flex flex-col gap-2">
            {diagnostics.map((d, index) => (
              <li key={`${d.code}-${index}`} className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-red-300">{d.code}</span>
                  <span className="font-mono text-xs text-[#6b6b75]">
                    {d.line}:{d.column}
                  </span>
                  <span className="text-xs text-[#8a8a94]">{d.name}</span>
                </div>
                <p className="mt-1 text-sm">{d.message}</p>
                {d.hint ? <p className="mt-1 text-xs text-gold-300">↳ {d.hint}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex min-h-0 flex-1 flex-col">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[#6b6b75]">Execution Trace</h3>
        {events.length === 0 ? (
          <p className="text-sm text-[#6b6b75]">还没有执行记录。</p>
        ) : (
          <ul className="flex flex-col gap-1 overflow-y-auto pr-1 font-mono text-[11px]">
            {events.map((event) => (
              <li key={event.seq} className="flex items-start gap-2 rounded-md bg-ink-900 px-2 py-1">
                <span className="text-[#4a4a54]">{String(event.seq).padStart(2, '0')}</span>
                <span className="w-16 shrink-0 text-[#8a8a94]">{event.phase}</span>
                <span className={`w-14 shrink-0 ${STATUS_TEXT[event.status] ?? 'text-[#8a8a94]'}`}>{event.status}</span>
                <span className="flex-1 break-all text-[#c9c9d1]">
                  {event.label}
                  {event.tool ? <span className="ml-1 text-[#6b6b75]">[{event.tool}]</span> : null}
                  {event.durationMs !== undefined ? (
                    <span className="ml-1 text-[#6b6b75]">{event.durationMs}ms</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
