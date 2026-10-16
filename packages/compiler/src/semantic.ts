import { findField, type Field, type FieldKind, type Program } from './ast.ts';
import { makeDiagnostic, type Diagnostic } from './diagnostics.ts';
import { splitLocation } from './location.ts';
import type { MealIR } from './ir.ts';

/** Fields that must appear in a valid v0.1 meal block. */
const REQUIRED_FIELDS: FieldKind[] = ['location', 'budget'];

/** Item-count window enforced by v0.1 (dev brief §2.1: 整数范围 1–3). */
export const MIN_ITEMS_LIMIT = 1;
export const MAX_ITEMS_LIMIT = 3;

/** Defaults used when the field is omitted entirely. */
export const DEFAULT_MIN_ITEMS = 1;
export const DEFAULT_MAX_ITEMS = 2;

export interface SemanticResult {
  ir: MealIR | null;
  diagnostics: Diagnostic[];
}

/**
 * Semantic checks. Runs on a syntactically valid AST and produces either a
 * complete IR or a precise, located diagnostic list.
 *
 * All diagnostics carry line/column + a fix hint — that is the "explainable
 * failure" property the project is judged on. No exception is ever thrown.
 */
export function analyze(program: Program): SemanticResult {
  const diagnostics: Diagnostic[] = [];
  const errors: Diagnostic[] = [];
  const push = (d: Diagnostic) => {
    diagnostics.push(d);
    if (d.severity === 'error') errors.push(d);
  };

  // --- duplicate field detection -----------------------------------------
  const seen = new Map<FieldKind, Field>();
  for (const field of program.fields) {
    const first = seen.get(field.kind);
    if (first) {
      push(
        makeDiagnostic(
          'E001',
          `字段 ${field.kind} 重复声明，首次出现于第 ${first.loc.startLine} 行`,
          {
            line: field.loc.startLine,
            column: field.loc.startColumn,
            endLine: field.loc.endLine,
            endColumn: field.loc.endColumn,
          },
          `删除第 ${field.loc.startLine} 行的重复声明，或合并为一个字段`,
        ),
      );
    } else {
      seen.set(field.kind, field);
    }
  }

  // --- required fields ----------------------------------------------------
  for (const kind of REQUIRED_FIELDS) {
    if (!seen.has(kind)) {
      push(
        makeDiagnostic(
          'E001',
          `meal 块缺少必需字段 ${kind}`,
          {
            line: program.loc.startLine,
            column: program.loc.startColumn,
            endLine: program.loc.endLine,
            endColumn: program.loc.endColumn,
          },
          `在 meal 块内补充 ${kind} 字段，参考 examples/budget.meal`,
        ),
      );
    }
  }

  // --- location -----------------------------------------------------------
  const locationField = seen.get('location');
  let location: MealIR['location'] | null = null;
  if (locationField) {
    const value = locationField.value;
    if (value.kind !== 'string') {
      push(
        makeDiagnostic('E001', 'location 必须是字符串', pos(locationField), '例如 location: "北京市海淀区五道口";'),
      );
    } else if (value.value.trim().length === 0) {
      push(makeDiagnostic('E001', 'location 不能为空字符串', pos(locationField), '填写城市 + 位置关键词，例如 "北京市海淀区五道口"'));
    } else {
      const { city, keyword } = splitLocation(value.value);
      location = { raw: value.value, city, keyword };
    }
  }

  // --- mode (E102) --------------------------------------------------------
  const modeField = seen.get('mode');
  const modeValue = modeField?.value.kind === 'ident' ? modeField.value.value : 'pickup';
  if (modeField && modeValue !== 'pickup') {
    push(
      makeDiagnostic(
        'E102',
        `v0.1 仅支持到店自取（pickup），当前取餐模式为 ${modeValue}`,
        pos(modeField),
        '改为 mode: pickup;',
      ),
    );
  }

  // --- budget (E101) ------------------------------------------------------
  const budgetField = seen.get('budget');
  let budget: MealIR['budget'] | null = null;
  if (budgetField) {
    const value = budgetField.value;
    if (value.kind !== 'budget') {
      push(
        makeDiagnostic(
          'E101',
          'budget 必须写成 `<= 金额 CNY` 的形式',
          pos(budgetField),
          '例如 budget: <= 35 CNY;',
        ),
      );
    } else if (value.currency !== 'CNY') {
      push(
        makeDiagnostic(
          'E101',
          `v0.1 仅支持人民币（CNY），当前币种为 ${value.currency}`,
          pos(budgetField),
          '把币种改为 CNY，例如 budget: <= 35 CNY;',
        ),
      );
    } else if (!Number.isFinite(value.amount) || value.amount <= 0) {
      push(
        makeDiagnostic(
          'E101',
          `预算必须为正数，当前为 ${value.amount}`,
          pos(budgetField),
          '把预算改成正数，例如 budget: <= 35 CNY;',
        ),
      );
    } else {
      budget = { amountCny: value.amount };
    }
  }

  // --- require_keyword (E001) ---------------------------------------------
  const requireField = seen.get('require_keyword');
  let requireKeywords: string[] = [];
  if (requireField) {
    const value = requireField.value;
    if (value.kind !== 'string' && value.kind !== 'array') {
      push(
        makeDiagnostic(
          'E001',
          'require_keyword 必须是字符串或字符串数组',
          pos(requireField),
          '例如 require_keyword: "汉堡"; 或 require_keyword: ["汉堡", "可乐"];',
        ),
      );
    } else {
      // A quoted string may carry a whole list: `"巨无霸牛鱼肉堡, 麦旋风"`.
      // Both shapes normalise to one list, which keeps the IR unambiguous.
      requireKeywords = splitKeywords(value.kind === 'string' ? [value.value] : value.items);
      if (requireKeywords.length === 0) {
        push(
          makeDiagnostic(
            'E001',
            'require_keyword 不能为空',
            pos(requireField),
            '填写一个关键词，或删除该字段',
          ),
        );
      }
    }
  }

  // --- exclude_keywords ---------------------------------------------------
  const excludeField = seen.get('exclude_keywords');
  let excludeKeywords: string[] = [];
  if (excludeField) {
    const value = excludeField.value;
    if (value.kind !== 'array') {
      push(
        makeDiagnostic(
          'E001',
          'exclude_keywords 必须是字符串数组',
          pos(excludeField),
          '例如 exclude_keywords: ["咖啡"];',
        ),
      );
    } else if (value.items.some((item) => item.trim().length === 0)) {
      push(
        makeDiagnostic('E001', 'exclude_keywords 中不能包含空字符串', pos(excludeField), '移除数组中的空串元素'),
      );
    } else {
      // Same comma-list normalisation as require_keyword, so ["咖啡, 汉堡"]
      // cannot silently become one keyword that matches nothing.
      excludeKeywords = splitKeywords(value.items);
    }
  }

  // --- item range (E103) --------------------------------------------------
  const minField = seen.get('min_items');
  const maxField = seen.get('max_items');
  let minItems = DEFAULT_MIN_ITEMS;
  let maxItems = DEFAULT_MAX_ITEMS;

  const readCount = (field: Field, label: string): number | null => {
    const value = field.value;
    if (value.kind !== 'number' || !Number.isFinite(value.value)) {
      push(makeDiagnostic('E103', `${label} 必须是数字`, pos(field), `例如 ${label}: 1;`));
      return null;
    }
    if (!Number.isInteger(value.value)) {
      push(makeDiagnostic('E103', `${label} 必须是整数`, pos(field), `例如 ${label}: 1;`));
      return null;
    }
    if (value.value < MIN_ITEMS_LIMIT || value.value > MAX_ITEMS_LIMIT) {
      push(
        makeDiagnostic(
          'E103',
          `${label} 必须在 ${MIN_ITEMS_LIMIT}–${MAX_ITEMS_LIMIT} 之间，当前为 ${value.value}`,
          pos(field),
          `把 ${label} 调整为 ${MIN_ITEMS_LIMIT}–${MAX_ITEMS_LIMIT} 之间的整数`,
        ),
      );
      return null;
    }
    return value.value;
  };

  if (minField) {
    const read = readCount(minField, 'min_items');
    if (read !== null) minItems = read;
  }
  if (maxField) {
    const read = readCount(maxField, 'max_items');
    if (read !== null) maxItems = read;
  }
  if (minItems > maxItems) {
    const field = maxField ?? minField;
    if (field) {
      push(
        makeDiagnostic(
          'E103',
          `min_items(${minItems}) 不能大于 max_items(${maxItems})`,
          pos(field),
          `把 max_items 调整为 ≥ ${minItems}，或把 min_items 调整为 ≤ ${maxItems}`,
        ),
      );
    }
  }

  // Every required keyword needs its own item in the meal, so a window that tops
  // out below the keyword count is unsatisfiable — say so here, with the fix,
  // instead of letting the search fail later with a vague "no combination".
  if (requireKeywords.length > maxItems) {
    const field = maxField ?? requireField;
    if (field) {
      push(
        makeDiagnostic(
          'E103',
          `require_keyword 里有 ${requireKeywords.length} 个关键词（每个都要命中一件商品），但 max_items 只有 ${maxItems}`,
          pos(field),
          `把 max_items 调到 ≥ ${requireKeywords.length}，或减少 require_keyword 里的关键词`,
        ),
      );
    }
  }

  // --- optimize (E104) ----------------------------------------------------
  const optimizeField = seen.get('optimize');
  let optimize: MealIR['optimize'] = { fn: 'min', target: 'total_price' };
  if (optimizeField) {
    const value = optimizeField.value;
    if (value.kind !== 'optimize') {
      push(
        makeDiagnostic(
          'E104',
          'optimize 必须写成 `min(total_price)`',
          pos(optimizeField),
          '例如 optimize: min(total_price);',
        ),
      );
    } else if (value.fn !== 'min' || value.target !== 'total_price') {
      push(
        makeDiagnostic(
          'E104',
          `v0.1 仅支持 min(total_price)，当前为 ${value.fn}(${value.target})`,
          pos(optimizeField),
          '改为 optimize: min(total_price);',
        ),
      );
    } else {
      optimize = { fn: 'min', target: 'total_price' };
    }
  }

  // --- execution (E105) ---------------------------------------------------
  const executionField = seen.get('execution');
  if (executionField) {
    const value = executionField.value;
    const name = value.kind === 'ident' ? value.value : String(value);
    if (name !== 'dry_run') {
      push(
        makeDiagnostic(
          'E105',
          `v0.1 只做试算（dry_run），不会真实下单；当前 execution 为 ${name}`,
          pos(executionField),
          '改为 execution: dry_run;（本项目永不创建真实订单）',
        ),
      );
    }
  }

  if (errors.length > 0 || !location || !budget) {
    return { ir: null, diagnostics };
  }

  const ir: MealIR = {
    name: program.name,
    location,
    mode: 'pickup',
    budget,
    requireKeywords,
    excludeKeywords,
    minItems,
    maxItems,
    optimize,
    execution: 'dry_run',
  };
  return { ir, diagnostics };
}

function pos(field: Field) {
  return {
    line: field.valueLoc.startLine,
    column: field.valueLoc.startColumn,
    endLine: field.valueLoc.endLine,
    endColumn: field.valueLoc.endColumn,
  };
}

/** Half-width comma, full-width comma, and the Chinese enumeration comma. */
const KEYWORD_SEPARATOR = /[,，、]/;

/**
 * Flatten keyword input into one clean list: splits on `,` `，` `、`, trims each
 * part, drops blanks and de-duplicates.
 *
 * `["巨无霸牛鱼肉堡", "麦旋风"]` and `"巨无霸牛鱼肉堡, 麦旋风"` therefore mean the
 * same thing, which is why a user who writes a list inside one quoted string is
 * no longer silently asking for a product literally named "A, B".
 */
export function splitKeywords(values: string[]): string[] {
  const keywords: string[] = [];
  for (const value of values) {
    for (const part of value.split(KEYWORD_SEPARATOR)) {
      const keyword = part.trim();
      if (keyword.length > 0 && !keywords.includes(keyword)) keywords.push(keyword);
    }
  }
  return keywords;
}
