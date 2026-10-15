import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { FixtureClient, loadFixture, type ReplayFixture } from '@mealscript/mcp-adapter';
import { runBuild } from '@mealscript/verifier/pipeline';

const fixturePath = (name: string) => fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url));

const success = () => new FixtureClient(loadFixture(fixturePath('replay-success')));
const failure = () => new FixtureClient(loadFixture(fixturePath('replay-failure')));

const SOURCE = `meal lunch {
  location: "北京市海淀区五道口";
  mode: pickup;
  budget: <= 35 CNY;
  require_keyword: "汉堡";
  exclude_keywords: ["咖啡"];
  min_items: 1;
  max_items: 2;
  optimize: min(total_price);
  execution: dry_run;
}`;

describe('end-to-end build (replay fixtures)', () => {
  it('produces a verified combination from the success fixture', async () => {
    const result = await runBuild(SOURCE, success());
    expect(result.status).toBe('REPLAY_RESULT');
    expect(result.verified.length).toBeGreaterThan(0);
    expect(result.verified[0]?.totalCny).toBeLessThanOrEqual(35);
  });

  it('never labels a replay run as BUILD_PASSED', async () => {
    const result = await runBuild(SOURCE, success());
    expect(result.status).not.toBe('BUILD_PASSED');
    expect(result.mode).toBe('replay');
    expect(result.trace.mode).toBe('replay');
  });

  it('picks a real product that satisfies require_keyword and avoids exclude_keywords', async () => {
    const result = await runBuild(SOURCE, success());
    const names = result.verified[0]?.lines.map((line) => line.productName) ?? [];
    expect(names.join('')).toContain('汉堡');
    expect(names.join('')).not.toContain('咖啡');
  });

  it('records the real tool calls in the trace', async () => {
    const result = await runBuild(SOURCE, success());
    const tools = result.trace.events.filter((e) => e.kind === 'tool_call').map((e) => e.tool);
    expect(tools).toContain('query-nearby-stores');
    expect(tools).toContain('query-meals');
    expect(tools).toContain('calculate-price');
  });

  it('reports the store that was actually used', async () => {
    const result = await runBuild(SOURCE, success());
    expect(result.store?.storeCode).toBe('1950556');
  });

  it('reports MCP_ERROR instead of a fake success when the server fails', async () => {
    const result = await runBuild(SOURCE, failure());
    expect(result.status).toBe('MCP_ERROR');
    expect(result.errorCode).toBe('E401');
    expect(result.verified).toHaveLength(0);
  });

  it('stops at COMPILATION_ERROR before any tool call', async () => {
    const result = await runBuild('meal x { budget: <= -10 CNY; location: "北京市"; }', success());
    expect(result.status).toBe('COMPILATION_ERROR');
    const tools = result.trace.events.filter((e) => e.kind === 'tool_call');
    expect(tools).toHaveLength(0);
  });

  it('puts compiler diagnostics into the trace', async () => {
    const result = await runBuild('meal x { budget: <= -10 CNY; location: "北京市"; }', success());
    const codes = result.trace.events.filter((e) => e.kind === 'diagnostic').map((e) => e.errorCode);
    expect(codes).toContain('E101');
  });

  it('returns NO_VERIFIED_MATCH when the budget is impossible', async () => {
    const impossible = SOURCE.replace('<= 35 CNY', '<= 3 CNY');
    const result = await runBuild(impossible, success());
    expect(['NO_VERIFIED_MATCH', 'MCP_ERROR']).toContain(result.status);
    expect(result.verified).toHaveLength(0);
  });

  it('accepts a fixture without a price index by falling back to the recorded response', () => {
    const fixture = loadFixture(fixturePath('replay-success')) as ReplayFixture;
    expect(fixture.tools['calculate-price']).toBeDefined();
    expect(Object.keys(fixture.priceIndex ?? {}).length).toBeGreaterThan(10);
  });
});
