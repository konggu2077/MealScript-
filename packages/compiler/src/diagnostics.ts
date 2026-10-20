/**
 * Diagnostic model and error-code catalogue (dev brief §5.3).
 *
 * Compile-time codes live in the compiler:
 *   E001        SyntaxError
 *   E101..E105  SemanticConstraintError
 *
 * Runtime codes are produced by the MCP adapter / verifier and are re-exported
 * here so tooling has a single source of truth:
 *   E211 RequiredProductNotFound · E220 NoVerifiedCandidate · E301 UnavailableProduct
 *   E401 MCPAuthenticationFailed · E408 MCPTimeout · E429 MCPRateLimited
 *   E500 PriceVerificationFailed
 */

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  code: string;
  name: string;
  message: string;
  severity: DiagnosticSeverity;
  /** 1-based line where the problem starts. */
  line: number;
  /** 1-based column where the problem starts. */
  column: number;
  /** End position, when known (exclusive). */
  endLine?: number;
  endColumn?: number;
  /** Actionable fix suggestion — the point of "explainable failure". */
  hint?: string;
}

export interface ErrorSpec {
  code: string;
  name: string;
  /** Short description used when no richer message is available. */
  title: string;
}

export const ERROR_SPECS: Record<string, ErrorSpec> = {
  E001: { code: 'E001', name: 'SyntaxError', title: '语法无效 / 缺少分号 / 非法 Token' },
  E101: { code: 'E101', name: 'SemanticConstraintError', title: '非法预算' },
  E102: { code: 'E102', name: 'SemanticConstraintError', title: '暂不支持的取餐模式' },
  E103: { code: 'E103', name: 'SemanticConstraintError', title: '商品数量范围非法' },
  E104: { code: 'E104', name: 'SemanticConstraintError', title: '暂不支持的优化目标' },
  E105: { code: 'E105', name: 'SemanticConstraintError', title: '非 dry_run 的执行方式' },
  E211: { code: 'E211', name: 'RequiredProductNotFound', title: '无匹配所需商品（基于当前已取菜单）' },
  E220: { code: 'E220', name: 'NoVerifiedCandidate', title: '已验证候选中无满足全部约束的组合' },
  E301: { code: 'E301', name: 'UnavailableProduct', title: '商品下架或不可售' },
  E401: { code: 'E401', name: 'MCPAuthenticationFailed', title: 'Token 错误或过期' },
  E408: { code: 'E408', name: 'MCPTimeout', title: 'MCP 请求超时' },
  E429: { code: 'E429', name: 'MCPRateLimited', title: '请求被限制' },
  E500: { code: 'E500', name: 'PriceVerificationFailed', title: '官方价格计算失败或不可验证' },
};

export function specFor(code: string): ErrorSpec {
  return ERROR_SPECS[code] ?? { code, name: 'UnknownError', title: '未分类错误' };
}

export function makeDiagnostic(
  code: string,
  message: string,
  position: { line: number; column: number; endLine?: number; endColumn?: number },
  hint?: string,
): Diagnostic {
  const spec = specFor(code);
  return {
    code: spec.code,
    name: spec.name,
    message,
    severity: 'error',
    line: position.line,
    column: position.column,
    ...(position.endLine !== undefined ? { endLine: position.endLine } : {}),
    ...(position.endColumn !== undefined ? { endColumn: position.endColumn } : {}),
    ...(hint ? { hint } : {}),
  };
}

const pad = (n: number) => String(n).padStart(2, ' ');

/** `E101:3:12 SemanticConstraintError — 预算必须为正数` */
export function formatDiagnostic(d: Diagnostic): string {
  const at = d.endLine !== undefined && d.endLine === d.line ? `${d.line}:${d.column}-${d.endColumn}` : `${d.line}:${d.column}`;
  const hint = d.hint ? `\n      ↳ ${d.hint}` : '';
  return `${d.code} ${pad(d.line)}:${pad(d.column)}  ${d.name} — ${d.message}${hint}`;
}
