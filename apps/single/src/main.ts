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

export interface KeywordDictionary {
  /** Menu category names, e.g. 小食 / 甜品冰淇淋 / 麦咖啡™. */
  categories: string[];
  /** Product names, e.g. 巨无霸 / 薯条. */
  products: string[];
  /** Merchandising tags, e.g. 爆款 / 单品 / 套餐. */
  tags: string[];
}

/**
 * Autocomplete dictionary for the in-page editor, derived from the same
 * replay fixture the build runs against — so every suggestion is guaranteed
 * to match something the optimizer can actually find.
 */
export const KEYWORDS: KeywordDictionary = (() => {
  const data = (FIXTURE.tools['query-meals']?.result ?? {}) as {
    data?: {
      categories?: Array<{ name: string; meals?: Array<{ tags?: string[] }> }>;
      meals?: Record<string, { name: string }>;
    };
  };
  const categories = (data.data?.categories ?? []).map((c) => c.name);
  const products = Object.values(data.data?.meals ?? {}).map((m) => m.name);
  const tags = [
    ...new Set((data.data?.categories ?? []).flatMap((c) => (c.meals ?? []).flatMap((m) => m.tags ?? []))),
  ];
  return { categories, products, tags };
})();

export async function run(source: string): Promise<unknown> {
  const client = new FixtureClient(FIXTURE);
  return runBuild(source, client);
}

export { compile };
