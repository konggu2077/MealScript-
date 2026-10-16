/**
 * Refresh `fixtures/replay-success.json` from the **live** McDonald's MCP server.
 *
 *   npm run fixture:record                 # 用 .env 里的城市/关键词
 *   npm run fixture:record -- --store=1950556
 *   npm run fixture:record -- --city=上海市 --keyword=浦东新区陆家嘴
 *
 * Why a script instead of hand-editing:
 *  - the fixture must be a *real* capture (真实性规则), so it is produced by the
 *    same read-only adapter the pipeline uses — no write tool can sneak in;
 *  - redaction is mechanical and reportable: every dropped key is printed, so a
 *    reviewer can see exactly what left the capture;
 *  - `priceIndex` only records non-discounted items, where the official
 *    `calculate-price` equals the menu price sum. Discounted items are left out
 *    instead of being guessed.
 *
 * Nothing here is committed automatically — review `git diff fixtures/` first.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LiveMcpClient } from '../packages/mcp-adapter/src/client.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = join(root, 'fixtures/replay-success.json');

/** Keys that must never reach the repository (address / geo / brand assets / ids). */
const DROP_KEYS = [
  'address', 'storeAddress', 'storeAddr', 'addr', 'fullAddress', 'detailAddress',
  'latitude', 'lat', 'lng', 'longitude', 'lon', 'coordinate', 'coordinates', 'geo',
  'distance', 'distanceText', 'distanceMeters',
  'image', 'images', 'imageUrl', 'imgUrl', 'picture', 'pictureUrl', 'cover', 'coverImage',
  'thumbnail', 'icon', 'logo', 'banner',
  'traceId', 'requestId', 'deviceId', 'openId', 'unionId', 'memberId', 'userId',
  'phone', 'mobile', 'telephone', 'contact', 'email',
];

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  const file = join(root, '.env');
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m?.[1] && m[2] !== undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

/** Recursively drop sensitive keys; report every key that was removed. */
function redact(value: unknown, dropped = new Map<string, number>()): unknown {
  if (Array.isArray(value)) return value.map((v) => redact(v, dropped));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (DROP_KEYS.includes(key)) {
        dropped.set(key, (dropped.get(key) ?? 0) + 1);
        continue;
      }
      out[key] = redact(val, dropped);
    }
    return out;
  }
  return value;
}

interface Envelope<T> {
  success?: boolean;
  code?: number;
  message?: string;
  data?: T;
}

const env = loadEnv();
const token = env['MCD_MCP_TOKEN'];
if (!token) {
  console.error('缺少 MCD_MCP_TOKEN。请在 https://open.mcd.cn/mcp 获取后写入 .env（该文件已被 git 忽略）。');
  process.exit(1);
}

const client = new LiveMcpClient({ token, url: env['MCD_MCP_URL'] ?? 'https://mcp.mcd.cn' });
const city = arg('city') ?? env['MCD_DEFAULT_CITY'] ?? '北京市';
const keyword = arg('keyword') ?? env['MCD_DEFAULT_KEYWORD'] ?? '海淀区五道口';
const wantedStore = arg('store');

console.log(`连接 ${env['MCD_MCP_URL'] ?? 'https://mcp.mcd.cn'} … 位置：${city} / ${keyword}`);

const storesCall = await client.callTool<Envelope<Array<{ storeCode: string; storeName: string }>>>(
  'query-nearby-stores',
  { city, keyword, beType: 1, searchType: 2 },
);
if (!storesCall.ok) {
  console.error(`query-nearby-stores 失败：${storesCall.errorCode} ${storesCall.message}`);
  process.exit(1);
}

const stores = (storesCall.data as Envelope<Array<{ storeCode: string; storeName: string }>>).data ?? [];
const store = wantedStore ? stores.find((s) => s.storeCode === wantedStore) : stores[0];
if (!store) {
  console.error(`没有找到门店（共 ${stores.length} 家）。可用：${stores.map((s) => s.storeCode).join(', ')}`);
  process.exit(1);
}
console.log(`门店：${store.storeName}（${store.storeCode}）`);

const menuCall = await client.callTool<Envelope<{ categories: unknown[]; meals: Record<string, unknown> }>>(
  'query-meals',
  { storeCode: store.storeCode, orderType: 1, beType: 1 },
);
if (!menuCall.ok) {
  console.error(`query-meals 失败：${menuCall.errorCode} ${menuCall.message}`);
  process.exit(1);
}

const menu = (menuCall.data as Envelope<{ categories: Array<{ meals?: Array<{ code: string }> }>; meals: Record<string, { name: string; currentPrice: string | number }> }>).data;
if (!menu) {
  console.error('query-meals 返回结构里没有 data —— 官方 schema 可能变了，先别写 fixture。');
  process.exit(1);
}

const codes = Object.keys(menu.meals ?? {});
console.log(`菜单：${codes.length} 件商品 / ${menu.categories?.length ?? 0} 个分类。开始逐件核对官方结算价…`);

// Only keep items where the official price equals the menu price (no discount),
// so replay stays a faithful stand-in for the non-discounted case. Anything else
// is skipped rather than guessed.
const priceIndex: Record<string, number> = {};
let skipped = 0;
let sampledPrice: unknown = null;

for (const code of codes) {
  const call = await client.callTool<Envelope<{ price: number; productPrice?: number; productList?: unknown[] }>>(
    'calculate-price',
    { storeCode: store.storeCode, orderType: 1, beType: 1, items: [{ productCode: code, quantity: 1 }] },
  );
  if (!call.ok) {
    skipped += 1;
    continue;
  }
  const envelope = call.data as Envelope<{ price: number; productPrice?: number }>;
  const price = envelope.data?.price;
  if (typeof price !== 'number' || !envelope.success) {
    skipped += 1;
    continue;
  }
  if (envelope.data?.productPrice !== undefined && envelope.data.productPrice !== price) {
    skipped += 1; // 有优惠，模拟会失真 → 不记
    continue;
  }
  priceIndex[code] = price;
  sampledPrice ??= envelope;
}
console.log(`价格索引：记录 ${Object.keys(priceIndex).length} 件，跳过 ${skipped} 件（优惠价或查询失败）。`);

const detailCode = codes[0];
const detailCall = detailCode
  ? await client.callTool('query-meal-detail', { storeCode: store.storeCode, orderType: 1, beType: 1, code: detailCode })
  : null;
await client.close();

const dropped = new Map<string, number>();
const tools: Record<string, { result?: unknown }> = {};
for (const [name, result] of [
  ['query-nearby-stores', storesCall.data],
  ['query-meals', menuCall.data],
  ['query-meal-detail', detailCall?.ok ? detailCall.data : undefined],
  ['calculate-price', sampledPrice ?? undefined],
] as const) {
  if (result !== undefined) tools[name] = { result: redact(result, dropped) };
}

const previous = existsSync(FIXTURE_PATH)
  ? (JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
      tools: Record<string, { result?: Envelope<{ meals?: Record<string, { name: string }> }> }>;
      priceIndex?: Record<string, number>;
    })
  : null;

const fixture = {
  id: 'replay-success-wudaokou',
  mode: 'replay' as const,
  capturedAt: new Date(Date.now() + 8 * 3600_000).toISOString().replace('Z', '+08:00').replace(/\.\d{3}/, ''),
  redacted: true,
  note:
    'Real session captured from https://mcp.mcd.cn with an authenticated read-only token. ' +
    'Redacted before committing: store address / distance / coordinates removed, traceId removed, ' +
    'product images removed (brand assets are not redistributed), personal data removed. ' +
    'Menu codes, names and prices are real. — This fixture is REPLAY and must never be presented as a live query.',
  source: env['MCD_MCP_URL'] ?? 'https://mcp.mcd.cn',
  tools,
  priceIndex,
};

writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

console.log(`\n已写入 ${FIXTURE_PATH}`);
if (dropped.size) {
  console.log('脱敏删除的字段：');
  for (const [key, count] of [...dropped.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${key} × ${count}`);
  }
}

const before = previous?.tools['query-meals']?.result as Envelope<{ meals?: Record<string, { name: string }> }> | undefined;
const beforeNames = before?.data?.meals ?? {};
const added = Object.keys(menu.meals).filter((c) => !(c in beforeNames));
const removed = Object.keys(beforeNames).filter((c) => !(c in menu.meals));
const beforePrices = previous?.priceIndex ?? {};
const changed = Object.keys(priceIndex).filter((c) => beforePrices[c] !== undefined && beforePrices[c] !== priceIndex[c]);

console.log('\n与上一版的差异：');
console.log(`  商品数：${Object.keys(beforeNames).length} → ${Object.keys(menu.meals).length}`);
console.log(`  新增：${added.length ? added.map((c) => `${menu.meals[c]?.name}(${c})`).join('、') : '无'}`);
console.log(`  下架：${removed.length ? removed.map((c) => `${beforeNames[c]?.name}(${c})`).join('、') : '无'}`);
console.log(
  `  价格变动：${
    changed.length
      ? changed.map((c) => `${menu.meals[c]?.name} ¥${(beforePrices[c] ?? 0) / 100} → ¥${(priceIndex[c] ?? 0) / 100}`).join('、')
      : '无'
  }`,
);
console.log('\n下一步：git diff fixtures/ 复核，然后 npm test。');
