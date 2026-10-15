import { redact, summarize, type RedactOptions } from './redact.ts';
import type { Trace, TraceEvent, TraceMode, TracePhase, TraceStatus } from './types.ts';

/**
 * Environment-agnostic id. Uses the Web Crypto API when available (browser and
 * modern Node) so this module stays bundleable — importing `node:crypto` would
 * make the single-file HTML build fail.
 */
function newId(): string {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface RecorderOptions {
  mode: TraceMode;
  /** Automatically redact every request/response payload. Default true. */
  autoRedact?: boolean;
  redactOptions?: RedactOptions;
  /** Injectable clock, for deterministic tests. */
  now?: () => string;
}

/**
 * Collects the execution trace for one build.
 *
 * Two guarantees that the contest rules depend on:
 *  1. The mode (`live` vs `replay`) is fixed at construction time and is part
 *     of every emitted trace — a replay run can never silently become live.
 *  2. Every payload written to the trace is passed through `redact()` first.
 */
export class TraceRecorder {
  readonly mode: TraceMode;
  readonly id: string;
  readonly startedAt: string;

  private readonly events: TraceEvent[] = [];
  private readonly autoRedact: boolean;
  private readonly redactOptions: RedactOptions;
  private readonly now: () => string;
  private seq = 0;
  private finishedAt?: string;

  constructor(options: RecorderOptions) {
    this.mode = options.mode;
    this.id = newId();
    this.startedAt = (options.now ?? (() => new Date().toISOString()))();
    this.autoRedact = options.autoRedact ?? true;
    this.redactOptions = options.redactOptions ?? {};
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private push(event: Omit<TraceEvent, 'seq' | 'ts'>): TraceEvent {
    this.seq += 1;
    const full: TraceEvent = { seq: this.seq, ts: this.now(), ...event };
    this.events.push(full);
    return full;
  }

  private safe(value: unknown): unknown {
    return this.autoRedact ? redact(value, this.redactOptions) : value;
  }

  /** Mark a stage as started and return a finisher callback. */
  start(phase: TracePhase, label: string): (status?: TraceStatus, message?: string) => TraceEvent {
    const startedAt = Date.now();
    this.push({ phase, kind: 'stage', label, status: 'running' });
    return (status: TraceStatus = 'ok', message?: string) =>
      this.push({
        phase,
        kind: 'stage',
        label,
        status,
        durationMs: Date.now() - startedAt,
        ...(message ? { message } : {}),
      });
  }

  /** Record a completed stage in one shot. */
  stage(phase: TracePhase, label: string, status: TraceStatus = 'ok', message?: string): TraceEvent {
    return this.push({
      phase,
      kind: 'stage',
      label,
      status,
      ...(message ? { message } : {}),
    });
  }

  /** Record an MCP tool call with redacted payloads. */
  toolCall(input: {
    phase: TracePhase;
    tool: string;
    label?: string;
    request?: unknown;
    response?: unknown;
    /**
     * Structural summary of the response shape. When a caller only wants the
     * shape recorded (e.g. a 120-item menu), it can pass this instead of the
     * full payload. Derived from `response` when omitted.
     */
    responseSummary?: unknown;
    durationMs?: number;
    status?: TraceStatus;
    errorCode?: string;
    message?: string;
  }): TraceEvent {
    const summary =
      input.responseSummary !== undefined
        ? input.responseSummary
        : input.response !== undefined
          ? summarize(input.response)
          : undefined;
    return this.push({
      phase: input.phase,
      kind: 'tool_call',
      label: input.label ?? `call ${input.tool}`,
      tool: input.tool,
      status: input.status ?? 'ok',
      ...(input.request !== undefined ? { request: this.safe(input.request) } : {}),
      ...(input.response !== undefined ? { response: this.safe(input.response) } : {}),
      ...(summary !== undefined ? { responseSummary: summary } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.message ? { message: input.message } : {}),
    });
  }

  /** Record a compiler diagnostic (error code + location). */
  diagnostic(phase: TracePhase, code: string, message: string, location?: string): TraceEvent {
    return this.push({
      phase,
      kind: 'diagnostic',
      label: location ? `${code} @ ${location}` : code,
      status: 'error',
      errorCode: code,
      message,
    });
  }

  note(phase: TracePhase, label: string, message?: string): TraceEvent {
    return this.push({ phase, kind: 'note', label, status: 'ok', ...(message ? { message } : {}) });
  }

  finish(): Trace {
    this.finishedAt = this.now();
    return this.toTrace();
  }

  toTrace(): Trace {
    return {
      id: this.id,
      mode: this.mode,
      startedAt: this.startedAt,
      ...(this.finishedAt ? { finishedAt: this.finishedAt } : {}),
      events: [...this.events],
    };
  }
}

/** Plain-text rendering used by the CLI and by `workbuddy.md` evidence dumps. */
export function formatTrace(trace: Trace): string {
  const lines: string[] = [];
  lines.push(`trace ${trace.id}  mode=${trace.mode.toUpperCase()}  started=${trace.startedAt}`);
  for (const e of trace.events) {
    const dur = e.durationMs !== undefined ? ` ${e.durationMs}ms` : '';
    const tool = e.tool ? ` [${e.tool}]` : '';
    const err = e.errorCode ? ` <${e.errorCode}>` : '';
    lines.push(`  ${String(e.seq).padStart(2, '0')}. ${e.phase.padEnd(8)} ${e.status.padEnd(7)} ${e.label}${tool}${dur}${err}`);
    if (e.message) lines.push(`      ${e.message}`);
  }
  return lines.join('\n');
}
