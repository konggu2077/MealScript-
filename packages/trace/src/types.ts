/** Unified trace event model (dev brief §03 module "trace"). */

/** The six stages rendered by the Playground: Parse → Check → Menu → Optimize → Price → Result. */
export type TracePhase = 'parse' | 'check' | 'menu' | 'optimize' | 'price' | 'result';

export const TRACE_PHASES: TracePhase[] = ['parse', 'check', 'menu', 'optimize', 'price', 'result'];

/** Labels shown in the UI for each phase. */
export const PHASE_LABELS: Record<TracePhase, string> = {
  parse: 'Parse',
  check: 'Check',
  menu: 'Menu',
  optimize: 'Optimize',
  price: 'Price',
  result: 'Result',
};

/**
 * `live`   — the data came from the real McDonald's MCP server.
 * `replay` — the data came from a redacted fixture. Must never be presented as live.
 */
export type TraceMode = 'live' | 'replay';

export type TraceEventKind = 'stage' | 'tool_call' | 'diagnostic' | 'note';

export type TraceStatus = 'ok' | 'error' | 'skipped' | 'running';

export interface TraceEvent {
  /** Monotonic sequence number, 1-based. */
  seq: number;
  /** ISO-8601 timestamp. */
  ts: string;
  phase: TracePhase;
  kind: TraceEventKind;
  /** Human-readable one-liner. */
  label: string;
  status: TraceStatus;
  /** Wall-clock duration in milliseconds, when measurable. */
  durationMs?: number;
  /** MCP tool name, for `tool_call` events. */
  tool?: string;
  /** Redacted request payload (never the raw body). */
  request?: unknown;
  /** Redacted response payload. */
  response?: unknown;
  /** Structural summary of the response shape. */
  responseSummary?: unknown;
  /** Error code such as E401 / E429 / E500 when status is `error`. */
  errorCode?: string;
  /** Extra free-form detail. */
  message?: string;
}

export interface Trace {
  /** Unique id for this build. */
  id: string;
  mode: TraceMode;
  startedAt: string;
  finishedAt?: string;
  events: TraceEvent[];
}
