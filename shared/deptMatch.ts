/**
 * 部门名比对：与前端交付经理范围一致（NFKC、空白规范化），供 server/index.ts 列表权限等与 UI 对齐。
 */
export function normalizeDeptForMatch(s: string): string {
  try {
    return String(s || '')
      .normalize('NFKC')
      .replace(/[\s\u3000]+/g, ' ')
      .trim()
      .toLowerCase()
  } catch {
    return String(s || '')
      .replace(/[\s\u3000]+/g, ' ')
      .trim()
      .toLowerCase()
  }
}

export function deptNamesMatch(userDept: string, deptName: string): boolean {
  const a = normalizeDeptForMatch(userDept)
  const b = normalizeDeptForMatch(deptName)
  if (!a || !b || a === '-' || b === '-') return false
  return a === b
}
