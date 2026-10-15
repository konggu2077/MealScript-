import { describe, expect, it } from 'vitest';
import { REDACTED, isSensitiveKey, redact, summarize } from '@mealscript/trace';
import { TraceRecorder, formatTrace } from '@mealscript/trace';

describe('redaction', () => {
  it('drops the value of any sensitive key', () => {
    const out = redact({ Authorization: 'Bearer abc.def', token: 'xyz', productCode: 'MCHZ' }) as Record<string, unknown>;
    expect(out['Authorization']).toBe(REDACTED);
    expect(out['token']).toBe(REDACTED);
    expect(out['productCode']).toBe('MCHZ');
  });

  it('masks phone numbers embedded in strings', () => {
    const out = redact({ note: '联系 13812345678 领取' }) as Record<string, unknown>;
    expect(String(out['note'])).not.toContain('13812345678');
    expect(String(out['note'])).toContain('****');
  });

  it('masks long opaque identifiers', () => {
    const out = redact({ traceId: '4ddb221e242065638938810204eae9a4' }) as Record<string, unknown>;
    expect(String(out['traceId'])).toContain(REDACTED);
  });

  it('truncates overlong strings', () => {
    const out = redact({ name: 'x'.repeat(500) }, { maxStringLength: 20 }) as Record<string, unknown>;
    expect(String(out['name']).length).toBeLessThan(40);
  });

  it('caps array length', () => {
    const out = redact({ items: Array.from({ length: 50 }, (_, i) => i) }, { maxArrayItems: 3 }) as Record<string, unknown>;
    expect((out['items'] as unknown[]).length).toBe(4);
  });

  it('is deterministic for the same input', () => {
    const payload = { storeCode: '123', phone: '13900001111', nested: { memberId: 'm-1' } };
    expect(JSON.stringify(redact(payload))).toBe(JSON.stringify(redact(payload)));
  });

  it('recognises sensitive key names', () => {
    expect(isSensitiveKey('Authorization')).toBe(true);
    expect(isSensitiveKey('storeName')).toBe(false);
  });
});

describe('summarize', () => {
  it('reports shape instead of content', () => {
    const summary = summarize({ stores: [{ storeCode: 'A1', name: '五道口店' }] }) as Record<string, unknown>;
    expect(JSON.stringify(summary)).not.toContain('A1');
  });
});

describe('TraceRecorder', () => {
  it('records events in order and freezes the mode', () => {
    const recorder = new TraceRecorder({ mode: 'replay' });
    recorder.stage('parse', 'Parse', 'ok');
    recorder.toolCall({ phase: 'menu', tool: 'query-meals', status: 'ok', durationMs: 12 });
    const trace = recorder.finish();
    expect(trace.mode).toBe('replay');
    expect(trace.events).toHaveLength(2);
    expect(trace.events[0]?.seq).toBe(1);
    expect(trace.events[1]?.tool).toBe('query-meals');
  });

  it('redacts tool call payloads automatically', () => {
    const recorder = new TraceRecorder({ mode: 'live' });
    recorder.toolCall({
      phase: 'price',
      tool: 'calculate-price',
      request: { Authorization: 'Bearer secret' },
      response: { total: 3200 },
    });
    const trace = recorder.finish();
    const event = trace.events[0];
    expect(event?.request).toEqual({ Authorization: REDACTED });
    expect(event?.responseSummary).toBeDefined();
  });

  it('records diagnostics with their error code', () => {
    const recorder = new TraceRecorder({ mode: 'live' });
    recorder.diagnostic('check', 'E101', '预算必须为正数', '4:11');
    const trace = recorder.finish();
    expect(trace.events[0]?.errorCode).toBe('E101');
    expect(trace.events[0]?.label).toContain('4:11');
  });

  it('formats a trace for terminal output', () => {
    const recorder = new TraceRecorder({ mode: 'replay' });
    recorder.stage('parse', 'Parse', 'ok');
    const rendered = formatTrace(recorder.finish());
    expect(rendered).toContain('mode=REPLAY');
    expect(rendered).toContain('parse');
  });
});
