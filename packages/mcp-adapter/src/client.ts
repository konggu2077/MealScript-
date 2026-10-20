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

const DEFAULT_TIMEOUT_MS = 20_000;

function mapError(error: unknown): { errorCode: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  if (/\b401\b/.test(raw)) return { errorCode: 'E401', message: 'MCP 鉴权失败：Token 错误或已过期' };
  if (/\b429\b/.test(raw)) return { errorCode: 'E429', message: 'MCP 请求被限流（每 Token 每分钟 600 次）' };
  // Timeouts are NOT rate limiting — reporting them as E429 sent users hunting
  // for a quota problem that did not exist. E408 is its own diagnosis.
  if (/timeout|timed out|ETIMEDOUT/i.test(raw)) return { errorCode: 'E408', message: 'MCP 请求超时' };
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
  private client!: Client;
  private transport!: StreamableHTTPClientTransport;
  private connected = false;
  private readonly url: URL;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(config: LiveClientConfig) {
    if (!config.token) {
      throw new Error('MCD_MCP_TOKEN is empty. Set it in .env (git-ignored) before using live mode.');
    }
    this.url = new URL(config.url ?? 'https://mcp.mcd.cn');
    this.token = config.token;
    this.timeoutMs = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.openTransport();
  }

  /** (Re)build the SDK client + transport pair. Used on construction and after a timeout. */
  private openTransport(): void {
    this.client = new Client({ name: 'mealscript', version: '0.1.0' });
    this.transport = new StreamableHTTPClientTransport(this.url, {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
    });
    this.connected = false;
  }

  /**
   * A timed-out request may leave the underlying stream wedged; the next call
   * would then time out too. Dropping the pair makes the following call connect
   * from scratch instead of inheriting the dead one.
   */
  private async resetTransport(): Promise<void> {
    try {
      // Bounded too: a wedged transport can make close() hang as well, and the
      // whole point of this path is to stop waiting forever.
      await this.withTimeout(this.client.close(), 1000, 'close');
    } catch {
      /* best effort — the connection is already considered dead */
    }
    this.openTransport();
  }

  /** Reject if `task` has not settled within `ms`. Never leaves a dangling timer. */
  private async withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    await this.client.connect(this.transport);
    this.connected = true;
  }

  async listTools(): Promise<unknown> {
    return this.withTimeout(
      (async () => {
        await this.ensureConnected();
        return this.client.listTools();
      })(),
      this.timeoutMs,
      'listTools',
    );
  }

  async callTool<T>(name: McdToolName, args: Record<string, unknown>): Promise<ToolResult<T>> {
    if (FORBIDDEN_TOOLS.includes(name)) throw new ForbiddenToolError(name);
    const startedAt = Date.now();
    try {
      const result = await this.withTimeout(
        (async () => {
          await this.ensureConnected();
          return this.client.callTool({ name, arguments: args });
        })(),
        this.timeoutMs,
        name,
      );
      const payload = decode(result) as { success?: boolean; code?: number; message?: string; data?: T } | T;
      const envelope = payload as { success?: boolean; data?: T; message?: string };
      if (envelope && envelope.success === false) {
        const mapped = mapError(envelope.message ?? 'tool returned success=false');
        return { ok: false, ...mapped, durationMs: Date.now() - startedAt };
      }
      return { ok: true, data: payload as T, durationMs: Date.now() - startedAt };
    } catch (error) {
      const mapped = mapError(error);
      if (mapped.errorCode === 'E408') await this.resetTransport();
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
