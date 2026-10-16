import { describe, expect, it } from 'vitest';
import { compile, splitLocation, formatDiagnostic, type Diagnostic } from '@mealscript/compiler';

const code = (...lines: string[]) => lines.join('\n');

function codes(diagnostics: Diagnostic[]): string[] {
  return diagnostics.map((d) => d.code);
}

function firstAt(diagnostics: Diagnostic[], expectedCode: string) {
  const found = diagnostics.find((d) => d.code === expectedCode);
  expect(found, `expected diagnostic ${expectedCode}, got ${JSON.stringify(codes(diagnostics))}`).toBeDefined();
  return found as Diagnostic;
}

const VALID = code(
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
);

describe('MealScript lexer & parser', () => {
  it('parses the canonical example end to end', () => {
    const result = compile(VALID);
    expect(result.ok).toBe(true);
    expect(result.ir).not.toBeNull();
    expect(result.diagnostics).toHaveLength(0);
  });

  it('keeps the meal name', () => {
    const { ir } = compile(VALID);
    expect(ir?.name).toBe('lunch');
  });

  it('collects every declared field', () => {
    const { ast } = compile(VALID);
    expect(ast?.fields.map((f) => f.kind)).toEqual([
      'location',
      'mode',
      'budget',
      'require_keyword',
      'exclude_keywords',
      'min_items',
      'max_items',
      'optimize',
      'execution',
    ]);
  });

  it('decodes budget into op / amount / currency', () => {
    const { ast } = compile(VALID);
    const budget = ast?.fields.find((f) => f.kind === 'budget');
    expect(budget?.value).toEqual({ kind: 'budget', op: '<=', amount: 35, currency: 'CNY' });
  });

  it('decodes exclude_keywords into a string array', () => {
    const { ir } = compile(VALID);
    expect(ir?.excludeKeywords).toEqual(['咖啡']);
  });

  it('ignores line and block comments', () => {
    const result = compile(code('// leading comment', '/* block', '   comment */', VALID));
    expect(result.ok).toBe(true);
  });

  it('reports E001 with a precise position when a semicolon is missing', () => {
    const result = compile(
      code('meal lunch {', '  location: "北京市海淀区五道口";', '  budget: <= 35 CNY', '  require_keyword: "汉堡";', '}'),
    );
    expect(result.ok).toBe(false);
    const diagnostic = firstAt(result.diagnostics, 'E001');
    expect(diagnostic.line).toBe(4);
    expect(diagnostic.column).toBe(3);
  });

  it('reports E001 for an unclosed meal block', () => {
    const result = compile(code('meal lunch {', '  budget: <= 35 CNY;', '  location: "北京市";'));
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain('E001');
  });

  it('reports E001 for an unknown field', () => {
    const result = compile(code('meal lunch {', '  budget: <= 35 CNY;', '  location: "北京市";', '  calorie: 500;', '}'));
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain('E001');
  });

  it('reports E001 for an unterminated string literal', () => {
    const result = compile(code('meal lunch {', '  location: "北京市;', '  budget: <= 35 CNY;', '}'));
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain('E001');
  });

  it('reports E001 for empty input', () => {
    const result = compile('');
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain('E001');
  });

  it('never throws on hostile input', () => {
    expect(() => compile('meal {{{ ]]] ??? >>>')).not.toThrow();
    const result = compile('meal {{{ ]]] ??? >>>');
    expect(result.ok).toBe(false);
  });
});

describe('MealScript semantic checks', () => {
  it('splits location into city + keyword for the real MCP schema', () => {
    const { ir } = compile(VALID);
    expect(ir?.location).toEqual({ raw: '北京市海淀区五道口', city: '北京市', keyword: '海淀区五道口' });
  });

  it('E101 — negative budget', () => {
    const result = compile(VALID.replace('<= 35 CNY', '<= -10 CNY'));
    const diagnostic = firstAt(result.diagnostics, 'E101');
    expect(diagnostic.line).toBe(4);
    expect(diagnostic.hint).toContain('CNY');
  });

  it('E101 — currency other than CNY', () => {
    const result = compile(VALID.replace('<= 35 CNY', '<= 35 USD'));
    const diagnostic = firstAt(result.diagnostics, 'E101');
    expect(diagnostic.message).toContain('USD');
  });

  it('E102 — delivery mode is not supported in v0.1', () => {
    const result = compile(VALID.replace('mode: pickup;', 'mode: delivery;'));
    const diagnostic = firstAt(result.diagnostics, 'E102');
    expect(diagnostic.line).toBe(3);
  });

  it('E103 — min_items greater than max_items', () => {
    const result = compile(VALID.replace('min_items: 1;', 'min_items: 3;').replace('max_items: 2;', 'max_items: 1;'));
    const diagnostic = firstAt(result.diagnostics, 'E103');
    expect(diagnostic.message).toContain('min_items(3)');
  });

  it('E103 — item count below the supported window', () => {
    const result = compile(VALID.replace('min_items: 1;', 'min_items: 0;'));
    const diagnostic = firstAt(result.diagnostics, 'E103');
    expect(diagnostic.message).toContain('0');
  });

  it('E103 — non integer item count', () => {
    const result = compile(VALID.replace('min_items: 1;', 'min_items: 1.5;'));
    const diagnostic = firstAt(result.diagnostics, 'E103');
    expect(diagnostic.message).toContain('整数');
  });

  it('E104 — unsupported optimize target', () => {
    const result = compile(VALID.replace('min(total_price)', 'max(protein)'));
    const diagnostic = firstAt(result.diagnostics, 'E104');
    expect(diagnostic.line).toBe(9);
    expect(diagnostic.message).toContain('max(protein)');
  });

  it('E105 — real order placement is rejected', () => {
    const result = compile(VALID.replace('execution: dry_run;', 'execution: place_order;'));
    const diagnostic = firstAt(result.diagnostics, 'E105');
    expect(diagnostic.line).toBe(10);
  });

  it('E001 — a required field is missing', () => {
    const result = compile(code('meal lunch {', '  location: "北京市海淀区五道口";', '}'));
    const diagnostic = firstAt(result.diagnostics, 'E001');
    expect(diagnostic.message).toContain('budget');
  });

  it('E001 — a field is declared twice', () => {
    const result = compile(VALID.replace('  mode: pickup;', '  mode: pickup;\n  mode: delivery;'));
    const diagnostic = firstAt(result.diagnostics, 'E001');
    expect(diagnostic.message).toContain('重复声明');
  });

  it('E001 — empty require_keyword', () => {
    const result = compile(VALID.replace('require_keyword: "汉堡";', 'require_keyword: "";'));
    const diagnostic = firstAt(result.diagnostics, 'E001');
    expect(diagnostic.message).toContain('require_keyword');
  });

  it('accepts a comma-separated keyword list inside one quoted string', () => {
    const result = compile(VALID.replace('require_keyword: "汉堡";', 'require_keyword: "巨无霸牛鱼肉堡, 麦旋风";'));
    expect(result.ok).toBe(true);
    expect(result.ir?.requireKeywords).toEqual(['巨无霸牛鱼肉堡', '麦旋风']);
  });

  it('accepts a keyword array, and both shapes normalise identically', () => {
    const array = compile(VALID.replace('require_keyword: "汉堡";', 'require_keyword: ["巨无霸牛鱼肉堡", "麦旋风"];'));
    const scalar = compile(VALID.replace('require_keyword: "汉堡";', 'require_keyword: "巨无霸牛鱼肉堡, 麦旋风";'));
    expect(array.ok).toBe(true);
    expect(array.ir?.requireKeywords).toEqual(scalar.ir?.requireKeywords);
  });

  it('splits on full-width comma and the Chinese enumeration comma too', () => {
    const result = compile(
      code(
        'meal lunch {',
        '  location: "北京市海淀区五道口";',
        '  budget: <= 45 CNY;',
        '  require_keyword: "汉堡、可乐，薯条";',
        '  max_items: 3;',
        '}',
      ),
    );
    expect(result.ir?.requireKeywords).toEqual(['汉堡', '可乐', '薯条']);
  });

  it('trims, drops blanks and de-duplicates keyword lists', () => {
    const result = compile(VALID.replace('require_keyword: "汉堡";', 'require_keyword: ["  汉堡 ", "汉堡", " ", "可乐"];'));
    expect(result.ir?.requireKeywords).toEqual(['汉堡', '可乐']);
  });

  it('E103 — more required keywords than max_items can never be satisfied', () => {
    const result = compile(
      code(
        'meal lunch {',
        '  location: "北京市海淀区五道口";',
        '  budget: <= 45 CNY;',
        '  require_keyword: "巨无霸牛鱼肉堡, 麦旋风";',
        '  min_items: 1;',
        '  max_items: 1;',
        '}',
      ),
    );
    const diagnostic = firstAt(result.diagnostics, 'E103');
    expect(diagnostic.message).toContain('max_items 只有 1');
    expect(diagnostic.hint).toContain('max_items 调到 ≥ 2');
  });

  it('a keyword count that fits the window passes', () => {
    const result = compile(
      code(
        'meal lunch {',
        '  location: "北京市海淀区五道口";',
        '  budget: <= 45 CNY;',
        '  require_keyword: "巨无霸牛鱼肉堡, 麦旋风";',
        '  min_items: 2;',
        '  max_items: 2;',
        '}',
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.ir?.requireKeywords).toHaveLength(2);
  });

  it('also splits a comma list written inside exclude_keywords', () => {
    const result = compile(VALID.replace('exclude_keywords: ["咖啡"];', 'exclude_keywords: ["咖啡, 脆脆薯条"];'));
    expect(result.ir?.excludeKeywords).toEqual(['咖啡', '脆脆薯条']);
  });

  it('applies defaults when optional fields are omitted', () => {
    const result = compile(
      code('meal lunch {', '  location: "北京市海淀区五道口";', '  budget: <= 35 CNY;', '}'),
    );
    expect(result.ok).toBe(true);
    expect(result.ir?.minItems).toBe(1);
    expect(result.ir?.maxItems).toBe(2);
    expect(result.ir?.mode).toBe('pickup');
    expect(result.ir?.execution).toBe('dry_run');
    expect(result.ir?.requireKeywords).toEqual([]);
    expect(result.ir?.excludeKeywords).toEqual([]);
  });

  it('produces no diagnostics for a fully valid program', () => {
    expect(compile(VALID).diagnostics).toHaveLength(0);
  });
});

describe('location splitting', () => {
  it('handles municipalities', () => {
    expect(splitLocation('北京市海淀区五道口')).toEqual({ city: '北京市', keyword: '海淀区五道口' });
  });

  it('handles generic cities', () => {
    expect(splitLocation('深圳市南山区科技园')).toEqual({ city: '深圳市', keyword: '南山区科技园' });
  });

  it('handles space separated input', () => {
    expect(splitLocation('北京 五道口')).toEqual({ city: '北京', keyword: '五道口' });
  });

  it('falls back to using the whole string when no city is present', () => {
    expect(splitLocation('五道口')).toEqual({ city: '五道口', keyword: '五道口' });
  });

  it('handles empty input', () => {
    expect(splitLocation('   ')).toEqual({ city: '', keyword: '' });
  });
});

describe('diagnostics formatting', () => {
  it('renders code, position, name and message', () => {
    const result = compile(VALID.replace('<= 35 CNY', '<= -10 CNY'));
    const rendered = formatDiagnostic(result.diagnostics[0] as Diagnostic);
    expect(rendered).toContain('E101');
    expect(rendered).toContain('SemanticConstraintError');
    expect(rendered).toMatch(/\d+:\d+/);
  });
});
