/**
 * Redaction helpers.
 *
 * Rule (from the dev brief §05 / §10): the trace must never contain raw
 * sensitive response bodies, tokens, or personally identifying data.
 * Every value that enters a trace event goes through `redact()` first.
 */

export const REDACTED = '[REDACTED]';

/** Key names whose *values* are always dropped, no matter what they look like. */
const SENSITIVE_KEY =
  /(token|secret|password|passwd|auth|authorization|bearer|cookie|session|phone|mobile|tel$|telephone|address|addr|nickname|realname|member|userid|user_?id|account|openid|unionid|orderid|order_?id|orderno|idcard|id_?card|latitude|longitude|\blat\b|\blng\b|email|avatar)/i;

/** Mainland-China mobile numbers. */
const PHONE_LIKE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;

/** Long opaque identifiers (trace ids, member ids, order nos). */
const OPAQUE_ID = /\b[a-f0-9]{16,}\b/gi;

/** Numeric-looking coordinates. */
const COORD_LIKE = /^\d{1,3}\.\d{4,}$/;

export interface RedactOptions {
  /** Strings longer than this are truncated. */
  maxStringLength?: number;
  /** Hard cap on how many array items survive summarisation. */
  maxArrayItems?: number;
  /** Depth beyond which nested values collapse to a shape marker. */
  maxDepth?: number;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…(+${value.length - max})`;
}

function maskInline(text: string): string {
  return text
    .replace(PHONE_LIKE, (m) => `${m.slice(0, 3)}****${m.slice(-4)}`)
    .replace(OPAQUE_ID, (m) => `${m.slice(0, 6)}…[REDACTED]`);
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/**
 * Deep-redact an arbitrary JSON-ish value. Deterministic: the same input
 * always produces the same output, so replay fixtures stay stable.
 */
export function redact(value: unknown, options: RedactOptions = {}, depth = 0): unknown {
  const { maxStringLength = 160, maxArrayItems = 6, maxDepth = 6 } = options;

  if (value === null || value === undefined) return value ?? null;

  if (depth > maxDepth) return '…';

  if (typeof value === 'string') {
    if (COORD_LIKE.test(value)) return REDACTED;
    return truncate(maskInline(value), maxStringLength);
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    const head = value.slice(0, maxArrayItems).map((item) => redact(item, options, depth + 1));
    if (value.length > maxArrayItems) {
      head.push(`…(+${value.length - maxArrayItems} more)`);
    }
    return head;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redact(val, options, depth + 1);
    }
    return out;
  }

  return String(value);
}

/**
 * Structural summary — the shape of a payload without its content.
 * Used for the "response summary" field so evidence stays verifiable
 * while the raw body stays out of the repo.
 */
export function summarize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return { type: 'array', count: value.length, sample: value.slice(0, 1).map((v) => summarize(v, depth + 1)) };
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : summarize(val, depth + 1);
    }
    return out;
  }
  return typeof value;
}
