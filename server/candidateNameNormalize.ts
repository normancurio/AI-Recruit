/** 去掉中文姓名末尾误带的性别/民族/「性别」字段词（如 宋亚双男汉 → 宋亚双，许胜性别 → 许胜） */
export function stripChinesePersonNameSuffix(raw: string): string {
  let s = String(raw || '').trim()
  if (!s) return s

  if (/^[\u4e00-\u9fa5]{2,4}性别$/.test(s)) {
    s = s.slice(0, -2)
  }

  const genderEthnic = s.match(/^([\u4e00-\u9fa5]{2,4})(?:男|女)(?:汉|族|汉族)?$/)
  if (genderEthnic?.[1]) return genderEthnic[1]

  if (/^[\u4e00-\u9fa5]{2,4}[男女]$/.test(s)) {
    return s.slice(0, -1)
  }

  return s
}
