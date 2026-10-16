export const EXAMPLES = [
  {
    id: 'budget',
    label: '经典示例 · 35 元有汉堡不要咖啡',
    source: `meal lunch {
  location: "北京市海淀区五道口";
  mode: pickup;
  budget: <= 35 CNY;
  require_keyword: "汉堡";
  exclude_keywords: ["咖啡"];
  min_items: 1;
  max_items: 2;
  optimize: min(total_price);
  execution: dry_run;
}`,
  },
  {
    id: 'two-items',
    label: '两件套 · 汉堡 + 小食',
    source: `meal combo {
  location: "北京市海淀区五道口";
  mode: pickup;
  budget: <= 30 CNY;
  require_keyword: "汉堡";
  exclude_keywords: ["咖啡"];
  min_items: 2;
  max_items: 2;
  optimize: min(total_price);
  execution: dry_run;
}`,
  },
  {
    id: 'multi-keyword',
    label: '多关键词 · 巨无霸牛鱼肉堡 + 麦旋风（两个都要）',
    source: `meal multi {
  location: "北京市海淀区五道口";
  mode: pickup;
  budget: <= 45 CNY;
  require_keyword: "巨无霸牛鱼肉堡, 麦旋风";
  exclude_keywords: ["脆脆薯条"];
  min_items: 2;
  max_items: 3;
  optimize: min(total_price);
  execution: dry_run;
}`,
  },
  {
    id: 'syntax-error',
    label: '故意写错 · 漏掉分号（E001）',
    source: `meal lunch {
  location: "北京市海淀区五道口";
  mode: pickup;
  budget: <= 35 CNY
  require_keyword: "汉堡";
  optimize: min(total_price);
  execution: dry_run;
}`,
  },
  {
    id: 'semantic-error',
    label: '故意写错 · 负预算 + 外送（E101 / E102）',
    source: `meal lunch {
  location: "北京市海淀区五道口";
  mode: delivery;
  budget: <= -10 CNY;
  require_keyword: "汉堡";
  optimize: min(total_price);
  execution: dry_run;
}`,
  },
  {
    id: 'impossible',
    label: '预算过低 · 无可行组合（E220）',
    source: `meal tiny {
  location: "北京市海淀区五道口";
  mode: pickup;
  budget: <= 3 CNY;
  require_keyword: "汉堡";
  min_items: 1;
  max_items: 1;
  optimize: min(total_price);
  execution: dry_run;
}`,
  },
] as const;

export type ExampleId = (typeof EXAMPLES)[number]['id'];
