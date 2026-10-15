import path from 'node:path';
import { existsSync } from 'node:fs';
import { NextResponse } from 'next/server';
import { createLiveClientFromEnv, FixtureClient, loadFixture, type McdClient } from '@mealscript/mcp-adapter';
import { runBuild } from '@mealscript/verifier/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fixturesDir(): string {
  // Works whether Next is started from the repo root or from apps/playground.
  const candidates = [
    path.join(process.cwd(), 'fixtures'),
    path.join(process.cwd(), '..', '..', 'fixtures'),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0]!;
}

export async function POST(request: Request) {
  let body: { source?: string; mode?: 'live' | 'replay'; fixture?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const source = body.source ?? '';
  const mode = body.mode === 'live' ? 'live' : 'replay';

  let client: McdClient;
  if (mode === 'live') {
    const live = createLiveClientFromEnv();
    if (!live) {
      return NextResponse.json(
        {
          error: '未检测到 MCD_MCP_TOKEN。请在 .env 中配置后再使用 Live 模式；当前可先用 Replay 模式。',
        },
        { status: 400 },
      );
    }
    client = live;
  } else {
    const file = `${body.fixture ?? 'replay-success'}.json`;
    client = new FixtureClient(loadFixture(path.join(fixturesDir(), file)));
  }

  try {
    const result = await runBuild(source, client);
    if (client && 'close' in client) await client.close();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
