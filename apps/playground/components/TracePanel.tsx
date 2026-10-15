'use client';

import type { Diagnostic } from '@mealscript/compiler';
import type { TraceEvent } from '@mealscript/trace';

const STATUS_TEXT: Record<string, string> = {
  ok: 'text-ok-fg',
  error: 'text-err-fg',
  running: 'text-warn-fg',
  skipped: 'text-fg-3',
};

interface Props {
  events: TraceEvent[];
  diagnostics: Diagnostic[];
}

export default function TracePanel({ events, diagnostics }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {diagnostics.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {diagnostics.map((d, index) => (
            <li
              key={`${d.code}-${index}`}
              className="rounded-r-lg border border-err-line border-l-[3px] border-l-err-fg bg-err-bg px-3 py-2.5 text-[13px]"
            >
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="font-mono text-[13px] text-err-fg">{d.code}</span>
                <span className="font-mono text-[13px] text-fg-3">
                  {d.line}:{d.column}
                </span>
                <span className="text-xs text-fg-2">{d.name}</span>
              </div>
              <p className="mt-1">{d.message}</p>
              {d.hint ? <p className="mt-1 text-[13px] text-warn-fg">↳ {d.hint}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {diagnostics.length > 0 && events.length > 0 ? <hr className="border-ink-700" /> : null}

      {events.length === 0 ? (
        diagnostics.length === 0 ? (
          <p className="py-2 text-sm text-fg-3">还没有执行记录。</p>
        ) : null
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {['#', '阶段', '类型', '内容', '状态', '耗时'].map((h) => (
                <th
                  key={h}
                  className="border-b border-ink-700 px-2 py-1.5 text-left text-xs font-normal text-fg-3"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.seq} className="border-b border-ink-900">
                <td className="px-2 py-1.5 font-mono text-fg-2">{event.seq}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-fg-2">{event.phase}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-fg-3">
                  {event.kind === 'tool_call' ? event.tool ?? 'tool_call' : event.kind}
                </td>
                <td className="px-2 py-1.5">{event.label}</td>
                <td
                  className={`whitespace-nowrap px-2 py-1.5 ${STATUS_TEXT[event.status] ?? 'text-fg-2'}`}
                >
                  {event.status}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 font-mono text-fg-3">
                  {event.durationMs != null ? `${event.durationMs}ms` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
