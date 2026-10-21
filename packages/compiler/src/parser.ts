import { EmbeddedActionsParser, type IToken } from 'chevrotain';
import {
  Colon,
  Comma,
  Identifier,
  KwAllowRepeat,
  KwBudget,
  KwCny,
  KwExcludeKeywords,
  KwExecution,
  KwLocation,
  KwMaxItems,
  KwMeal,
  KwMinItems,
  KwMode,
  KwOptimize,
  KwRequireKeyword,
  LBrace,
  LBracket,
  LParen,
  Lt,
  Lte,
  NumberLiteral,
  RBrace,
  RBracket,
  RParen,
  Semi,
  StringLiteral,
  allTokens,
  mealLexer,
  unquote,
} from './tokens.ts';
import { makeDiagnostic, type Diagnostic } from './diagnostics.ts';
import type { Field, FieldKind, FieldValue, Program, SourceLocation } from './ast.ts';

const finite = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

/** Same guard, but keeps "absent" as `undefined` instead of coercing to a fallback. */
const positive = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

function locOf(start: IToken, end?: IToken): SourceLocation {
  const stop = end ?? start;
  return {
    startOffset: finite(start.startOffset, 0),
    startLine: finite(start.startLine, 1),
    startColumn: finite(start.startColumn, 1),
    endOffset: finite(stop.endOffset, finite(stop.startOffset, 0)),
    endLine: finite(stop.endLine, finite(stop.startLine, 1)),
    endColumn: finite(stop.endColumn, finite(stop.startColumn, 1)),
  };
}

function posOf(token: IToken | undefined): { line: number; column: number; endLine?: number; endColumn?: number } {
  if (!token) return { line: 1, column: 1 };
  return {
    line: finite(token.startLine, 1),
    column: finite(token.startColumn, 1),
    endLine: positive(token.endLine),
    endColumn: positive(token.endColumn),
  };
}

class MealParser extends EmbeddedActionsParser {
  constructor() {
    // Recovery is OFF on purpose. Chevrotain's recovery silently *inserts*
    // missing tokens (e.g. a forgotten `;`), which would hide real syntax
    // errors — and precise, explainable errors are the whole point here.
    super(allTokens, { recoveryEnabled: false, maxLookahead: 2 });
    this.performSelfAnalysis();
  }

  private field(kind: FieldKind, value: FieldValue, kw: IToken, valueStart: IToken, valueEnd: IToken, semi: IToken): Field {
    return {
      type: 'Field',
      kind,
      value,
      loc: locOf(kw, semi),
      valueLoc: locOf(valueStart, valueEnd),
    };
  }

  public program = this.RULE('program', () => {
    const mealKw = this.CONSUME(KwMeal);
    const nameTok = this.CONSUME(Identifier);
    this.CONSUME(LBrace);
    const fields: Field[] = [];
    this.MANY(() => {
      fields.push(this.SUBRULE(this.statement));
    });
    const rbrace = this.CONSUME(RBrace);
    const program: Program = {
      type: 'Program',
      name: nameTok.image,
      loc: locOf(mealKw, rbrace),
      fields,
    };
    return program;
  });

  private statement = this.RULE('statement', (): Field =>
    this.OR<Field>([
      { ALT: () => this.SUBRULE(this.locationStmt) },
      { ALT: () => this.SUBRULE(this.modeStmt) },
      { ALT: () => this.SUBRULE(this.budgetStmt) },
      { ALT: () => this.SUBRULE(this.requireKeywordStmt) },
      { ALT: () => this.SUBRULE(this.excludeKeywordsStmt) },
      { ALT: () => this.SUBRULE(this.minItemsStmt) },
      { ALT: () => this.SUBRULE(this.maxItemsStmt) },
      { ALT: () => this.SUBRULE(this.allowRepeatStmt) },
      { ALT: () => this.SUBRULE(this.optimizeStmt) },
      { ALT: () => this.SUBRULE(this.executionStmt) },
    ]),
  );

  private locationStmt = this.RULE('locationStmt', () => {
    const kw = this.CONSUME(KwLocation);
    this.CONSUME(Colon);
    const value = this.CONSUME(StringLiteral);
    const semi = this.CONSUME(Semi);
    return this.field('location', { kind: 'string', value: unquote(value.image) }, kw, value, value, semi);
  });

  private modeStmt = this.RULE('modeStmt', () => {
    const kw = this.CONSUME(KwMode);
    this.CONSUME(Colon);
    const value = this.CONSUME(Identifier);
    const semi = this.CONSUME(Semi);
    return this.field('mode', { kind: 'ident', value: value.image }, kw, value, value, semi);
  });

  private budgetStmt = this.RULE('budgetStmt', () => {
    const kw = this.CONSUME(KwBudget);
    this.CONSUME(Colon);
    const op = this.OR([{ ALT: () => this.CONSUME(Lte) }, { ALT: () => this.CONSUME(Lt) }]);
    const amount = this.CONSUME(NumberLiteral);
    const currency = this.OR2([{ ALT: () => this.CONSUME(KwCny) }, { ALT: () => this.CONSUME(Identifier) }]);
    const semi = this.CONSUME(Semi);
    const value: FieldValue = {
      kind: 'budget',
      op: op.image === '<=' ? '<=' : '<',
      amount: Number(amount.image),
      currency: currency.image,
    };
    return this.field('budget', value, kw, op, currency, semi);
  });

  /**
   * `require_keyword` accepts either shape, both meaning "every listed keyword
   * must be satisfied by at least one item in the meal":
   *
   *   require_keyword: "汉堡";                      // one keyword
   *   require_keyword: "巨无霸牛鱼肉堡, 麦旋风";      // comma-separated list
   *   require_keyword: ["巨无霸牛鱼肉堡", "麦旋风"];  // array
   */
  private requireKeywordStmt = this.RULE('requireKeywordStmt', () => {
    const kw = this.CONSUME(KwRequireKeyword);
    this.CONSUME(Colon);
    // Values are collected into outer variables rather than returned from the
    // OR alternatives: chevrotain re-walks every rule to record the grammar, and
    // during that pass an alternative's return value is not available.
    let value: FieldValue = { kind: 'array', items: [] };
    // Defaulted to the keyword token so the variable is always assigned; the OR
    // below overwrites both on every real parse.
    let first: IToken = kw;
    let last: IToken = kw;
    this.OR([
      {
        // ["A", "B"]
        ALT: () => {
          const open = this.CONSUME(LBracket);
          const items: string[] = [];
          this.MANY_SEP({
            SEP: Comma,
            DEF: () => {
              items.push(unquote(this.CONSUME(StringLiteral).image));
            },
          });
          const close = this.CONSUME(RBracket);
          value = { kind: 'array', items };
          first = open;
          last = close;
        },
      },
      {
        // "A, B" / "汉堡"
        ALT: () => {
          const literal = this.CONSUME2(StringLiteral);
          value = { kind: 'string', value: unquote(literal.image) };
          first = literal;
          last = literal;
        },
      },
    ]);
    const semi = this.CONSUME(Semi);
    return this.field('require_keyword', value, kw, first, last, semi);
  });

  private excludeKeywordsStmt = this.RULE('excludeKeywordsStmt', () => {
    const kw = this.CONSUME(KwExcludeKeywords);
    this.CONSUME(Colon);
    const open = this.CONSUME(LBracket);
    const items: string[] = [];
    this.OPTION(() => {
      items.push(unquote(this.CONSUME(StringLiteral).image));
      this.MANY(() => {
        this.CONSUME(Comma);
        items.push(unquote(this.CONSUME2(StringLiteral).image));
      });
    });
    const close = this.CONSUME(RBracket);
    const semi = this.CONSUME(Semi);
    return this.field('exclude_keywords', { kind: 'array', items }, kw, open, close, semi);
  });

  private minItemsStmt = this.RULE('minItemsStmt', () => {
    const kw = this.CONSUME(KwMinItems);
    this.CONSUME(Colon);
    const value = this.CONSUME(NumberLiteral);
    const semi = this.CONSUME(Semi);
    return this.field('min_items', { kind: 'number', value: Number(value.image) }, kw, value, value, semi);
  });

  private maxItemsStmt = this.RULE('maxItemsStmt', () => {
    const kw = this.CONSUME(KwMaxItems);
    this.CONSUME(Colon);
    const value = this.CONSUME(NumberLiteral);
    const semi = this.CONSUME(Semi);
    return this.field('max_items', { kind: 'number', value: Number(value.image) }, kw, value, value, semi);
  });

  /**
   * `allow_repeat: true;` — lets one product fill more than one slot.
   *
   * The value is a plain identifier on purpose (same rule as `mode` / `execution`):
   * `allow_repeat: yes;` still parses, then the semantic layer rejects it with a
   * precise hint instead of a generic syntax error.
   */
  private allowRepeatStmt = this.RULE('allowRepeatStmt', () => {
    const kw = this.CONSUME(KwAllowRepeat);
    this.CONSUME(Colon);
    const value = this.CONSUME(Identifier);
    const semi = this.CONSUME(Semi);
    return this.field('allow_repeat', { kind: 'ident', value: value.image }, kw, value, value, semi);
  });

  private optimizeStmt = this.RULE('optimizeStmt', () => {
    const kw = this.CONSUME(KwOptimize);
    this.CONSUME(Colon);
    const fn = this.CONSUME(Identifier);
    this.CONSUME(LParen);
    const target = this.CONSUME2(Identifier);
    const close = this.CONSUME(RParen);
    const semi = this.CONSUME(Semi);
    const value: FieldValue = { kind: 'optimize', fn: fn.image, target: target.image };
    return this.field('optimize', value, kw, fn, close, semi);
  });

  private executionStmt = this.RULE('executionStmt', () => {
    const kw = this.CONSUME(KwExecution);
    this.CONSUME(Colon);
    const value = this.CONSUME(Identifier);
    const semi = this.CONSUME(Semi);
    return this.field('execution', { kind: 'ident', value: value.image }, kw, value, value, semi);
  });
}

interface ChevyError {
  name?: string;
  message?: string;
  token?: IToken;
  previousToken?: IToken;
  resyncedTokens?: IToken[];
}

function describeParseError(error: ChevyError): { message: string; hint?: string } {
  const next = error.token?.image;
  switch (error.name) {
    case 'MismatchedTokenException':
      return {
        message: next ? `此处出现意外的符号「${next}」` : '语句不完整',
        hint: '检查是否缺少分号 `;`、引号是否成对、字段顺序是否正确',
      };
    case 'NoViableAltException':
      return {
        message: next ? `无法识别的字段或取值「${next}」` : '无法识别的语句',
        hint: 'v0.1 支持的字段：location / mode / budget / require_keyword / exclude_keywords / min_items / max_items / optimize / execution',
      };
    case 'NotAllInputParsedException':
      return { message: '代码块结束后仍有多余内容', hint: '确认 `meal` 块只有一个，且花括号 `{ }` 成对' };
    case 'EarlyExitException':
      return { message: '语句块提前结束', hint: '检查花括号 `{ }` 是否成对' };
    default:
      return { message: error.message ?? '语法无效', hint: '参照 examples/budget.meal 的语法示例' };
  }
}

export interface ParseResult {
  ast: Program | null;
  diagnostics: Diagnostic[];
}

/** Lex + parse a MealScript source string. Never throws. */
export function parseMealScript(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const lexResult = mealLexer.tokenize(source);

  for (const lexError of lexResult.errors) {
    diagnostics.push(
      makeDiagnostic(
        'E001',
        `非法 Token：${lexError.message}`,
        { line: finite(lexError.line, 1), column: finite(lexError.column, 1) },
        '检查引号是否闭合，或是否存在中文全角标点',
      ),
    );
  }
  if (lexResult.errors.length > 0) {
    return { ast: null, diagnostics };
  }

  const parser = new MealParser();
  parser.input = lexResult.tokens;
  let ast: Program | null = null;
  try {
    ast = parser.program();
  } catch {
    ast = null;
  }

  for (const raw of parser.errors as unknown as ChevyError[]) {
    const { message, hint } = describeParseError(raw);
    const token = raw.token ?? raw.previousToken;
    diagnostics.push(makeDiagnostic('E001', message, posOf(token), hint));
  }

  return { ast, diagnostics };
}
