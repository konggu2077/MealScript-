/**
 * Browser bundle entry for the single-file HTML build (`dist/mealscript.html`).
 *
 * It wires the real compiler to the *replay* fixture client only. There is no
 * token, no network call and no write-capable tool in this bundle — the page is
 * safe to open offline and safe to publish.
 */
import { compile } from '@mealscript/compiler';
import { runBuild } from '@mealscript/verifier/pipeline';
import { FixtureClient, type ReplayFixture } from '../../../packages/mcp-adapter/src/browser.ts';
// @ts-ignore -- resolved by the bundler, not by tsc
import successFixture from '../../../fixtures/replay-success.json';

export const FIXTURE = successFixture as unknown as ReplayFixture;

export async function run(source: string): Promise<unknown> {
  const client = new FixtureClient(FIXTURE);
  return runBuild(source, client);
}

export { compile };
