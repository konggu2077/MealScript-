import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

/**
 * The single-file HTML page ships the compiler as a browser IIFE bundle.
 * These tests build that exact bundle and execute it in a VM, so "the page
 * works" is verified by running the shipped code — not by trusting it.
 */
async function bundle(): Promise<string> {
  const result = await build({
    entryPoints: [join(root, 'apps/single/src/main.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'MealScript',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    write: false,
    legalComments: 'none',
    alias: { '@mealscript/mcp-adapter': join(root, 'packages/mcp-adapter/src/browser.ts') },
    logLevel: 'silent',
  });
  const file = result.outputFiles?.[0];
  if (!file) throw new Error('esbuild produced no output for the single-file UI');
  return file.text;
}

async function loadApi() {
  const code = await bundle();
  const context = { console, setTimeout, clearTimeout, Date, Math, JSON, crypto: globalThis.crypto };
  vm.createContext(context);
  vm.runInContext(code + '\n;this.MealScript = MealScript;', context);
  return (context as unknown as { MealScript: any }).MealScript;
}

describe('browser bundle (single-file HTML payload)', () => {
  it('bundles without pulling in node builtins or the MCP SDK', async () => {
    const code = await bundle();
    expect(code).not.toMatch(/require\(["']node:/);
    expect(code).not.toMatch(/@modelcontextprotocol/);
    expect(code).not.toMatch(/process\.env/);
  });

  it('exposes compile + run and produces a real build result', async () => {
    const api = await loadApi();
    expect(typeof api.run).toBe('function');
    expect(typeof api.compile).toBe('function');

    const result = await api.run(SOURCE);
    expect(result.status).toBe('REPLAY_RESULT');
    expect(result.mode).toBe('replay');
    expect(result.verified.length).toBeGreaterThan(0);
    expect(result.verified[0].totalCny).toBeLessThanOrEqual(35);
    expect(result.trace.events.length).toBeGreaterThan(3);
  });

  it('reports compilation errors with line and column', async () => {
    const api = await loadApi();
    const result = await api.run('meal lunch {\n  mode: delivery;\n  budget: <= -10 CNY;\n}');
    expect(result.status).toBe('COMPILATION_ERROR');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    const codes = result.diagnostics.map((d: any) => d.code);
    expect(codes).toContain('E101');
    expect(result.diagnostics[0].line).toBeGreaterThan(0);
  });

  it('never allows a write-capable tool through the bundled client', async () => {
    const api = await loadApi();
    const fixture = api.FIXTURE;
    expect(fixture.mode).toBe('replay');
    expect(fixture.redacted).toBe(true);
    const tools = Object.keys(fixture.tools ?? {});
    for (const forbidden of ['create-order', 'cancel-order', 'auto-bind-coupons']) {
      expect(tools).not.toContain(forbidden);
    }
  });
});

describe('single-file HTML output', () => {
  it('has no external resource references and no credential values', () => {
    const html = readFileSync(join(root, 'dist/mealscript.html'), 'utf8');
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:\/\//i);
    expect(html).not.toMatch(/MCD_MCP_TOKEN\s*[:=]\s*["'][^"']+["']/);
    expect(html).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{8,}/);
    expect(html).toContain('MealScript');
  });

  /**
   * Caret alignment: the caret is painted by the <textarea> while the glyphs come
   * from the <pre><code> layer. If those two resolve to different fonts the glyph
   * run drifts away from the caret (up to ~5px over a 40-char line, worst on CJK).
   * <code> picks up the UA stylesheet's `font-family: monospace` unless an author
   * rule overrides it, so this must be asserted explicitly.
   */
  it('renders the highlight layer in the same font as the textarea', () => {
    const html = readFileSync(join(root, 'dist/mealscript.html'), 'utf8');
    expect(html).toMatch(/\.editor pre code\s*\{[^}]*font\s*:\s*inherit/);
    // the two layers must also share one font declaration and one scrollbar policy,
    // otherwise their content boxes differ by the scrollbar width
    expect(html).toMatch(/\.editor pre\s*,\s*\.editor textarea\s*\{[^}]*font-family/);
    expect(html.match(/scrollbar-gutter\s*:\s*stable/g) ?? []).toHaveLength(2);
  });
});

/**
 * The page's UI glue (second <script> block) is plain DOM code. This executes
 * it against a minimal DOM stub and lets it drive a real build, so wiring
 * mistakes (missing ids, wrong field names, broken renderers) fail here.
 */
describe('single-file UI glue (DOM stub)', () => {
  /**
   * The page's autocomplete dictionary is derived from the fixture, so tests
   * derive their expectations the same way instead of naming specific products —
   * a refreshed capture then can't turn into a false failure.
   */
  function sandboxKeywords(): { categories: string[]; products: string[]; tags: string[] } {
    const fixture = JSON.parse(readFileSync(join(root, 'fixtures/replay-success.json'), 'utf8')) as {
      tools: Record<string, { result: { data: { categories: Array<{ name: string; meals?: Array<{ tags?: string[] }> }>; meals: Record<string, { name: string }> } } }>;
    };
    const data = fixture.tools['query-meals']!.result.data;
    return {
      categories: data.categories.map((c) => c.name),
      products: Object.values(data.meals).map((m) => m.name),
      tags: [...new Set(data.categories.flatMap((c) => (c.meals ?? []).flatMap((m) => m.tags ?? [])))],
    };
  }

  function makeEl(tag: string): any {
    const o: any = {
      tag,
      children: [] as any[],
      textContent: '',
      className: '',
      value: '',
      style: {},
      disabled: false,
      parentNode: { scrollTop: 0, scrollLeft: 0 },
      scrollTop: 0,
      scrollLeft: 0,
      selectionStart: 0,
      selectionEnd: 0,
    };
    // innerHTML = '...' replaces all children in a real DOM; mirror that or
    // stale nodes linger and assertions pass against the wrong subtree.
    let html = '';
    Object.defineProperty(o, 'innerHTML', {
      get: () => html,
      set: (v: string) => {
        html = v;
        o.children.length = 0;
      },
    });
    o.appendChild = (c: any) => {
      o.children.push(c);
      c.parentNode = o;
      return c;
    };
    // The glue registers listeners (input/keydown/...); keep them so tests
    // can fire synthetic events.
    o.listeners = {} as Record<string, Array<(e: any) => void>>;
    o.addEventListener = (type: string, fn: (e: any) => void) => {
      (o.listeners[type] ||= []).push(fn);
    };
    o.setAttribute = () => {};
    o.focus = () => {};
    return o;
  }

  function fire(el: any, type: string, event: any = {}) {
    for (const fn of el.listeners?.[type] ?? []) fn(event);
  }

  async function loadPage() {
    const html = readFileSync(join(root, 'dist/mealscript.html'), 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    const ids: Record<string, any> = {};
    const documentStub: any = {
      getElementById: (id: string) => {
        if (!ids[id]) {
          ids[id] = makeEl('div#' + id);
          // The glue mounts the autocomplete popup on ta.parentNode.
          ids[id].parentNode = makeEl('parent-of-' + id);
        }
        return ids[id];
      },
      createElement: (t: string) => makeEl(t),
      body: makeEl('body'),
    };
    const sandbox: any = {
      document: documentStub,
      console,
      setTimeout,
      clearTimeout,
      Promise,
      Array,
      Object,
      String,
      Number,
      Date,
      JSON,
      Math,
      crypto: globalThis.crypto,
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    new vm.Script(scripts[0]!, { filename: 'bundle.js' }).runInContext(sandbox);
    expect(typeof sandbox.MealScript?.run).toBe('function');
    new vm.Script(scripts[1]!, { filename: 'ui.js' }).runInContext(sandbox);
    await new Promise((r) => setTimeout(r, 400)); // auto-build on load
    return { ids, sandbox };
  }

  it('renders all six stages, the result card and the trace on load', async () => {
    const { ids } = await loadPage();
    expect(ids['stages'].children.length).toBe(6);
    expect(ids['modeBadge'].textContent).toBe('REPLAY');
    expect(ids['runHint'].textContent).toMatch(/^完成 · \d+ 个 trace 事件/);
    expect(ids['result'].children.length).toBeGreaterThan(0);
    expect(ids['trace'].children.length).toBeGreaterThan(0);
  });

  it('shows diagnostics in the UI when the source has a semantic error', async () => {
    const { ids } = await loadPage();
    ids['src'].value = 'meal lunch {\n  location: "北京市海淀区五道口";\n  budget: <= -10 CNY;\n}\n';
    ids['run'].onclick();
    await new Promise((r) => setTimeout(r, 400));
    expect(ids['diags'].children.length).toBeGreaterThan(0);
    const first = ids['diags'].children[0];
    expect(first.children[0].children[0].textContent).toBe('E101');
  });

  it('suggests menu categories, products and tags while typing a keyword', async () => {
    const { ids } = await loadPage();
    const src = ids['src'];
    const editorBox = src.parentNode;
    const acEl = () => editorBox.children.find((c: any) => c.className === 'ac');

    // Expectations come from the fixture, so refreshing the capture
    // (`npm run fixture:record`) keeps this test honest.
    const keywords = sandboxKeywords();
    const firstCategory = keywords.categories[0]!;
    const sampleProduct = keywords.products.find((p) => p.length >= 3) ?? keywords.products[0]!;
    const partial = sampleProduct.slice(0, 2);

    // Caret inside the quotes of require_keyword, empty partial → full pool.
    src.value = 'meal x {\n  require_keyword: "';
    src.selectionStart = src.selectionEnd = src.value.length;
    fire(src, 'input');
    expect(acEl().style.display).toBe('block');
    const all = acEl().children.map((c: any) => c.children[0].textContent);
    expect(all).toContain(firstCategory);
    expect(all.length).toBeLessThanOrEqual(8);

    // Typing a partial filters the pool to matching products.
    src.value = `meal x {\n  require_keyword: "${partial}`;
    src.selectionStart = src.selectionEnd = src.value.length;
    fire(src, 'input');
    const filtered = acEl().children.map((c: any) => c.children[0].textContent);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((t: string) => t.includes(partial))).toBe(true);
  });

  it('completes the second keyword of a comma list and drops the first one', async () => {
    const { ids } = await loadPage();
    const src = ids['src'];
    const acEl = () => src.parentNode.children.find((c: any) => c.className === 'ac');

    const products = sandboxKeywords().products.filter((p) => p.length >= 3);
    const first = products[0]!;
    const second = products.find((p) => p !== first && !p.includes(first[0]!)) ?? products[1]!;

    // After "A, " the pool must be filtered by what comes after the comma, and
    // must no longer offer A itself.
    src.value = `meal x {\n  require_keyword: "${first}, ${second.slice(0, 2)}`;
    src.selectionStart = src.selectionEnd = src.value.length;
    fire(src, 'input');

    expect(acEl().style.display).toBe('block');
    const items = acEl().children.map((c: any) => c.children[0].textContent);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((t: string) => t.includes(second.slice(0, 2)))).toBe(true);
    expect(items).not.toContain(first);

    // Accepting replaces only the segment after the comma, keeping the first keyword.
    const accepted = items[0] as string;
    const ctx = src.value;
    void ctx;
    fire(src, 'keydown', { key: 'Enter', preventDefault() {} });
    // The fixture input has no closing quote, so the completed value must not
    // invent one either — completion only replaces the segment being typed.
    expect(src.value).toBe(`meal x {\n  require_keyword: "${first}, ${accepted}`);
  });

  it('suggests real locations while typing inside location quotes', async () => {
    const { ids } = await loadPage();
    const src = ids['src'];
    const acEl = () => src.parentNode.children.find((c: any) => c.className === 'ac');

    src.value = 'meal x {\n  location: "北京市朝';
    src.selectionStart = src.selectionEnd = src.value.length;
    fire(src, 'input');
    expect(acEl().style.display).toBe('block');
    const places = acEl().children.map((c: any) => c.children[0].textContent);
    expect(places.length).toBeGreaterThan(0);
    expect(places.every((t: string) => t.includes('北京市朝'))).toBe(true);
  });

  it('suggests enum values after mode: / execution: and field names otherwise', async () => {
    const { ids } = await loadPage();
    const src = ids['src'];
    const acEl = () => src.parentNode.children.find((c: any) => c.className === 'ac');

    src.value = 'meal x {\n  mode: p';
    src.selectionStart = src.selectionEnd = src.value.length;
    fire(src, 'input');
    const vals = acEl().children.map((c: any) => c.children[0].textContent);
    expect(vals).toEqual(['pickup']);

    src.value = 'meal x {\n  ex';
    src.selectionStart = src.selectionEnd = src.value.length;
    fire(src, 'input');
    const fields = acEl().children.map((c: any) => c.children[0].textContent);
    expect(fields).toContain('execution');
    expect(fields).toContain('exclude_keywords');
  });

  it('a category keyword produces a verified result end to end', async () => {
    const { ids } = await loadPage();
    const category = sandboxKeywords().categories[0]!;
    ids['src'].value =
      'meal snack {\n  location: "北京市海淀区五道口";\n  mode: pickup;\n  budget: <= 100 CNY;\n' +
      `  require_keyword: "${category}";\n  min_items: 1;\n  max_items: 2;\n  optimize: min(total_price);\n  execution: dry_run;\n}`;
    ids['run'].onclick();
    await new Promise((r) => setTimeout(r, 400));
    const resultText = ids['result'].children
      .flatMap((c: any) => c.children ?? [])
      .map((c: any) => c.textContent ?? '')
      .join(' ');
    expect(resultText).toContain('¥');
    expect(ids['runHint'].textContent).toMatch(/^完成 · /);
  });
});
