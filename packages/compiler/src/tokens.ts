import { createToken, Lexer } from 'chevrotain';

/**
 * MealScript v0.1 lexer.
 *
 * Design note: only *structural* keywords get their own token. Value keywords
 * such as `pickup`, `dry_run`, `min(total_price)` are plain identifiers on
 * purpose — that way an unsupported value (e.g. `delivery`, `max(protein)`)
 * still parses and is then rejected by the semantic layer with a precise code
 * (E102 / E104) instead of a generic syntax error.
 */

export const WhiteSpace = createToken({ name: 'WhiteSpace', pattern: /\s+/, group: Lexer.SKIPPED });
export const LineComment = createToken({ name: 'LineComment', pattern: /\/\/[^\n\r]*/, group: Lexer.SKIPPED });
export const BlockComment = createToken({ name: 'BlockComment', pattern: /\/\*[\s\S]*?\*\//, group: Lexer.SKIPPED });

// --- declared before the keywords so they can be used as `longer_alt` ---
export const Identifier = createToken({ name: 'Identifier', pattern: /[a-zA-Z_][a-zA-Z0-9_]*/ });

// --- structural keywords ---
export const KwMeal = createToken({ name: 'KwMeal', pattern: /meal/, longer_alt: Identifier });
export const KwLocation = createToken({ name: 'KwLocation', pattern: /location/, longer_alt: Identifier });
export const KwMode = createToken({ name: 'KwMode', pattern: /mode/, longer_alt: Identifier });
export const KwBudget = createToken({ name: 'KwBudget', pattern: /budget/, longer_alt: Identifier });
export const KwRequireKeyword = createToken({
  name: 'KwRequireKeyword',
  pattern: /require_keyword/,
  longer_alt: Identifier,
});
export const KwExcludeKeywords = createToken({
  name: 'KwExcludeKeywords',
  pattern: /exclude_keywords/,
  longer_alt: Identifier,
});
export const KwMinItems = createToken({ name: 'KwMinItems', pattern: /min_items/, longer_alt: Identifier });
export const KwMaxItems = createToken({ name: 'KwMaxItems', pattern: /max_items/, longer_alt: Identifier });
export const KwOptimize = createToken({ name: 'KwOptimize', pattern: /optimize/, longer_alt: Identifier });
export const KwExecution = createToken({ name: 'KwExecution', pattern: /execution/, longer_alt: Identifier });
export const KwCny = createToken({ name: 'KwCny', pattern: /CNY/, longer_alt: Identifier });

// --- literals & punctuation ---
export const StringLiteral = createToken({ name: 'StringLiteral', pattern: /"(?:[^"\\\r\n]|\\.)*"/ });
export const NumberLiteral = createToken({ name: 'NumberLiteral', pattern: /-?\d+(?:\.\d+)?/ });
export const Lte = createToken({ name: 'Lte', pattern: /<=/ });
export const Lt = createToken({ name: 'Lt', pattern: /</ });
export const LBrace = createToken({ name: 'LBrace', pattern: /{/ });
export const RBrace = createToken({ name: 'RBrace', pattern: /}/ });
export const LBracket = createToken({ name: 'LBracket', pattern: /\[/ });
export const RBracket = createToken({ name: 'RBracket', pattern: /]/ });
export const LParen = createToken({ name: 'LParen', pattern: /\(/ });
export const RParen = createToken({ name: 'RParen', pattern: /\)/ });
export const Colon = createToken({ name: 'Colon', pattern: /:/ });
export const Semi = createToken({ name: 'Semi', pattern: /;/ });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });

/** Order matters: longer operators first, keywords before the identifier fallback. */
export const allTokens = [
  WhiteSpace,
  LineComment,
  BlockComment,
  KwMeal,
  KwLocation,
  KwMode,
  KwBudget,
  KwRequireKeyword,
  KwExcludeKeywords,
  KwMinItems,
  KwMaxItems,
  KwOptimize,
  KwExecution,
  KwCny,
  StringLiteral,
  NumberLiteral,
  Lte,
  Lt,
  LBrace,
  RBrace,
  LBracket,
  RBracket,
  LParen,
  RParen,
  Colon,
  Semi,
  Comma,
  Identifier,
];

export const mealLexer = new Lexer(allTokens, {
  positionTracking: 'full',
  ensureOptimizations: false,
});

/** Strip the surrounding quotes and resolve escape sequences. */
export function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\(["\\/nrt])/g, (_m, ch: string) => {
      switch (ch) {
        case 'n':
          return '\n';
        case 'r':
          return '\r';
        case 't':
          return '\t';
        default:
          return ch;
      }
    });
  }
  return raw;
}
