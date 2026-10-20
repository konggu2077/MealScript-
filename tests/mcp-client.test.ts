import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LiveMcpClient } from '@mealscript/mcp-adapter';

let server: Server;
let endpoint: string;

beforeAll(async () => {
  // Accept the request and never answer: the upstream is wedged, not merely slow.
  server = createServer(() => {
    /* deliberately no response */
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('failed to bind the test server');
  endpoint = `http://127.0.0.1:${address.port}/mcp`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('live client timeout', () => {
  it('gives up and reports E408 instead of hanging forever', async () => {
    // timeoutMs used to be accepted and then silently ignored, so this call
    // would never settle and the whole pipeline would stall.
    const client = new LiveMcpClient({ token: 'test-token', url: endpoint, timeoutMs: 120 });

    const started = Date.now();
    const result = await client.callTool('query-meals', { storeCode: 'X' });
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('E408');
    expect(elapsed).toBeLessThan(2000);
  });
});
