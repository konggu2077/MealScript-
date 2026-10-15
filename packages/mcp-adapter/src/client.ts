import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ForbiddenToolError, type McdClient, type McdToolName, type ToolResult } from './types.ts';
import { FORBIDDEN_TOOLS } from './types.ts';

export interface LiveClientConfig {
  /** Official remote endpoint. Defaults to https://mcp.mcd.cn */
  url?: string;
  /** Personal token, read from MCD_MCP_TOKEN. Never logged, never persisted. */
  token: string;
  /** Request timeout in ms. */
  timeoutMs?: number;
}

function mapError(error: unknown): { errorCode: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  if (/\b401\b/.test(raw)) return { errorCode: 'E401', message: 'MCP 鉴权失败：Token 错误或已过期' };
  if (/\b429\b/.test(raw)) return { errorCode: 'E429', message: 'MCP 请求被限流（每 Token 每分钟 600 次）' };
  if (/timeout|timed out|ETIMEDOUT/i.test(raw)) return { errorCode: 'E429', message: 'MCP 请求超时' };
  return { errorCode: 'E500', message: `MCP 调用失败：${raw}` };
}

/** Try to turn an MCP content block into plain JSON. */
function decode(result: unknown): unknown {
  const content = (result as { content?: Array<{ type: string; text?: string }> })?.content;
  if (Array.isArray(content)) {
    const text = content.find((c) => c.type === 'text')?.text;
    if (text) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    }
  }
  const structured = (result as { structuredContent?: unknown })?.structuredContent;
  if (structured) return structured;
  return result;
}

/**
 * Talks to the official McDonald's MCP server over Streamable HTTP.
 *
 * Safety rules enforced here:
 *  - only read-only tool names are accepted,
 *  - the token never leaves this module and is never written to a trace,
 *  - failures return a structured error code instead of a fake success.
 */
export class LiveMcpClient implements McdClient {
  readonly mode = 'live' as const;
  private readonly client: Client;
  private readonly transport: StreamableHTTPClientTransport;
  private connected = false;

  constructor(config: LiveClientConfig) {
    if (!config.token) {
      throw new Error('MCD_MCP_TOKEN is empty. Set it in .env (git-ignored) before using live mode.');
    }
    this.client = new Client({ name: 'mealscript', version: '0.1.0' });
    this.transport = new StreamableHTTPClientTransport(new URL(config.url ?? 'https://mcp.mcd.cn'), {
      requestInit: { headers: { Authorization: `Bearer ${config.token}` } },
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    await this.client.connect(this.transport);
    this.connected = true;
  }

  async listTools(): Promise<unknown> {
    await this.ensureConnected();
    return this.client.listTools();
  }

  async callTool<T>(name: McdToolName, args: Record<string, unknown>): Promise<ToolResult<T>> {
    if (FORBIDDEN_TOOLS.includes(name)) throw new ForbiddenToolError(name);
    const startedAt = Date.now();
    try {
      await this.ensureConnected();
      const result = await this.client.callTool({ name, arguments: args });
      const payload = decode(result) as { success?: boolean; code?: number; message?: string; data?: T } | T;
      const envelope = payload as { success?: boolean; data?: T; message?: string };
      if (envelope && envelope.success === false) {
        const mapped = mapError(envelope.message ?? 'tool returned success=false');
        return { ok: false, ...mapped, durationMs: Date.now() - startedAt };
      }
      return { ok: true, data: payload as T, durationMs: Date.now() - startedAt };
    } catch (error) {
      const mapped = mapError(error);
      return { ok: false, ...mapped, durationMs: Date.now() - startedAt };
    }
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.connected = false;
  }
}

/** Build a live client from environment variables. Returns null when unset. */
export function createLiveClientFromEnv(env: NodeJS.ProcessEnv = process.env): LiveMcpClient | null {
  const token = env['MCD_MCP_TOKEN'];
  if (!token) return null;
  return new LiveMcpClient({ token, url: env['MCD_MCP_URL'] ?? 'https://mcp.mcd.cn' });
}
