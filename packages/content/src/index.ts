/**
 * Shared presentation content for every MealScript UI.
 *
 * The single-file page (`apps/single`) and the Next.js Playground
 * (`apps/playground`) are two deliberately separate renderers — one must stay
 * dependency-free and openable by double-click, the other wants React + Monaco.
 * What they must *not* have is two independently drifting copies of the sample
 * programs, the location suggestions and the stage names. Those live here, once.
 *
 * Rules for this package:
 *  - no imports from other @mealscript packages (it is a leaf),
 *  - no DOM, no Node builtins — it is bundled into the browser page,
 *  - data only; no rendering, no business logic.
 */

export interface Example {
  /** Stable id, used as a React key and as the active-chip marker. */
  id: string;
  /** Short label for the chip bar. */
  label: string;
  /** The DSL program this example loads into the editor. */
  source: string;
}

const program = (lines: string[]): string => lines.join('\n');

/**
 * Sample programs. Ordered from "the archetypal lunch" to the deliberate
 * failures — the first entry is what both UIs open with.
 */
export const EXAMPLES: Example[] = [
  {
    id: 'budget',
    label: '经典 · 35 元要汉堡不要咖啡',
    source: program([
      'meal lunch {',
      '  location: "北京市海淀区五道口";',
      '  mode: pickup;',
      '  budget: <= 35 CNY;',
      '  require_keyword: "汉堡";',
      '  exclude_keywords: ["咖啡"];',
      '  min_items: 1;',
      '  max_items: 2;',
      '  optimize: min(total_price);',
      '  execution: dry_run;',
      '}',
    ]),
  },
  {
    id: 'two-items',
    label: '两件套 · 汉堡再配一件',
    source: program([
      'meal combo {',
      '  location: "北京市朝阳区三里屯";',
      '  mode: pickup;',
      '  budget: <= 30 CNY;',
      '  require_keyword: "汉堡";',
      '  min_items: 2;',
      '  max_items: 2;',
      '  optimize: min(total_price);',
      '  execution: dry_run;',
      '}',
    ]),
  },
  {
    id: 'repeat',
    label: '同款两份 · 两个人各一杯饮品',
    source: program([
      'meal drinks {',
      '  location: "北京市朝阳区三里屯";',
      '  mode: pickup;',
      '  budget: <= 20 CNY;',
      '  require_keyword: "饮品";',
      '  exclude_keywords: ["甜品", "小食"];',
      '  min_items: 2;',
      '  max_items: 2;',
      '  allow_repeat: true;',
      '  optimize: min(total_price);',
      '  execution: dry_run;',
      '}',
    ]),
  },
  {
    id: 'multi-keyword',
    label: '多关键词 · 汉堡 + 麦旋风（两个都要）',
    source: program([
      'meal multi {',
      '  location: "北京市海淀区五道口";',
      '  mode: pickup;',
      '  budget: <= 45 CNY;',
      '  require_keyword: "巨无霸牛鱼肉堡, 麦旋风";',
      '  exclude_keywords: ["脆脆薯条"];',
      '  min_items: 2;',
      '  max_items: 3;',
      '  optimize: min(total_price);',
      '  execution: dry_run;',
      '}',
    ]),
  },
  {
    id: 'category-dessert',
    label: '按分类点 · 甜品 ≤ 20 元',
    source: program([
      'meal dessert {',
      '  location: "北京市海淀区中关村";',
      '  mode: pickup;',
      '  budget: <= 20 CNY;',
      '  require_keyword: "甜品";',
      '  min_items: 1;',
      '  max_items: 2;',
      '  optimize: min(total_price);',
      '  execution: dry_run;',
      '}',
    ]),
  },
  {
    id: 'category-drink',
    label: '按分类点 · 饮品 ≤ 15 元',
    source: program([
      'meal drink {',
      '  location: "北京市东城区王府井";',
      '  mode: pickup;',
      '  budget: <= 15 CNY;',
      '  require_keyword: "饮品";',
      '  exclude_keywords: ["咖啡"];',
      '  min_items: 1;',
      '  max_items: 1;',
      '  optimize: min(total_price);',
      '  execution: dry_run;',
      '}',
    ]),
  },
  {
    id: 'syntax-error',
    label: '故意写错 · 漏分号 E001',
    source: program([
      'meal lunch {',
      '  location: "北京市海淀区五道口";',
      '  mode: pickup;',
      '  budget: <= 35 CNY',
      '  require_keyword: "汉堡";',
      '  optimize: min(total_price);',
      '  execution: dry_run;',
      '}',
    ]),
  },
  {
    id: 'semantic-error',
    label: '故意写错 · 负预算 + 外送 E101/E102',
    source: program([
      'meal lunch {',
      '  location: "上海市浦东新区陆家嘴";',
      '  mode: delivery;',
      '  budget: <= -10 CNY;',
      '  require_keyword: "汉堡";',
      '  optimize: min(total_price);',
      '  execution: dry_run;',
      '}',
    ]),
  },
  {
    id: 'unknown-keyword',
    label: '不存在的词 · 饮料 E211',
    source: program([
      'meal drink {',
      '  location: "深圳市南山区科技园";',
      '  mode: pickup;',
      '  budget: <= 15 CNY;',
      '  require_keyword: "饮料";',
      '  min_items: 1;',
      '  max_items: 1;',
      '  optimize: min(total_price);',
      '  execution: dry_run;',
      '}',
    ]),
  },
  {
    id: 'impossible',
    label: '预算过低 · 无可行组合 E220',
    source: program([
      'meal tiny {',
      '  location: "成都市锦江区春熙路";',
      '  mode: pickup;',
      '  budget: <= 3 CNY;',
      '  require_keyword: "汉堡";',
      '  min_items: 1;',
      '  max_items: 1;',
      '  optimize: min(total_price);',
      '  execution: dry_run;',
      '}',
    ]),
  },
];

export type ExampleId = string;

/**
 * Real locations offered while typing inside `location: "…"`.
 *
 * They are plain text the compiler splits into city / district keyword; there is
 * no geocoding call, so these must stay recognisable, real addresses.
 */
export const LOCATIONS: string[] = [
  '北京市海淀区五道口',
  '北京市海淀区中关村',
  '北京市朝阳区三里屯',
  '北京市朝阳区国贸',
  '北京市朝阳区望京',
  '北京市朝阳区大悦城',
  '北京市东城区王府井',
  '北京市西城区西单',
  '上海市浦东新区陆家嘴',
  '上海市徐汇区徐家汇',
  '深圳市南山区科技园',
  '广州市天河区体育西路',
  '成都市锦江区春熙路',
  '杭州市西湖区文三路',
];

export interface Phase {
  /** Matches `TracePhase` in @mealscript/trace. */
  id: string;
  /** Short English name, used by the Playground's stage rail. */
  label: string;
  /** Chinese description, used by both UIs. */
  hint: string;
}

/** The six pipeline stages, in execution order. */
export const PHASES: Phase[] = [
  { id: 'parse', label: 'Parse', hint: '词法与语法分析' },
  { id: 'check', label: 'Check', hint: '语义检查与 IR' },
  { id: 'menu', label: 'Menu', hint: '查询门店与菜单' },
  { id: 'optimize', label: 'Optimize', hint: '有界组合搜索' },
  { id: 'price', label: 'Price', hint: '官方价格校验' },
  { id: 'result', label: 'Result', hint: '生成 Build Report' },
];

/** Convenience: `{ parse: '词法与语法分析', … }`. */
export const PHASE_HINTS: Record<string, string> = Object.fromEntries(
  PHASES.map((phase) => [phase.id, phase.hint]),
);
