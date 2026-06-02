import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Tab,
  TabStopType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  convertMillimetersToTwip
} from 'docx'

/**
 * 申朴默认模板（无上传模板）专用 Word 生成器。
 *
 * 目标：版式 1:1 还原"以前的 Chromium 整页样式"（蓝色左条小标题、浅边框卡片、技能胶囊、
 * 第二页岗位匹配画像 = 大雷达 + 画像结论 + 评分条 + 底部双栏卡片），但产出真正的 Word：
 * 文字是可编辑 run，转 PDF（LibreOffice）后字体正常嵌入、WPS 可改字；雷达以 PNG 图片嵌入不可编辑。
 */

export type ShenpuDocxDimension = { label: string; candidate: number; requirement: number }

export type ShenpuDocxInput = {
  candidateName: string
  candidatePhone?: string | null
  jobTitle: string
  department?: string | null
  doc: {
    headline: string
    professionalSummary: string
    targetMatchSummary: string
    coreSkills: string[]
    workExperiences: Array<{ company: string; title: string; period: string; highlights: string[] }>
    projectExperiences: Array<{ name: string; role: string; period: string; highlights: string[] }>
    educationExperiences: Array<{ school: string; major: string; degree: string; period: string }>
    strengths: string[]
    risks: string[]
    clientRequirements: string[]
    responsibilities: string[]
    portrait: { dimensions: ShenpuDocxDimension[]; conclusion: string }
  }
  /** Chromium 截图得到的雷达 PNG（560×290 比例）。为空则跳过雷达图。 */
  radarPng?: Buffer | null
  /** 仅预览/调试用：关闭"岗位匹配画像"前的强制分页（生产保持默认 true=分页到第二页）。 */
  pageBreakBeforePortrait?: boolean
}

// 与 Chromium 版式一致的配色
const C = {
  blue: '1D4ED8',
  blue2: '2563EB',
  slate: '334155',
  muted: '64748B',
  ink: '0F172A',
  dark: '111827',
  red: 'EF4444',
  chipBg: 'EFF6FF',
  summaryBg: 'F8FAFC',
  track: 'CBD5E1',
  cardBorder: 'DBEAFE',
  jdBorder: 'E2E8F0',
  reqFill: 'FECACA'
}

const FONT = 'Noto Sans CJK SC'

const PAGE_MARGIN_X_MM = 12
const PAGE_MARGIN_Y_MM = 10
const CONTENT_WIDTH_TWIP =
  convertMillimetersToTwip(210) - convertMillimetersToTwip(PAGE_MARGIN_X_MM) * 2

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const
const NO_TABLE_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
  insideHorizontal: NO_BORDER,
  insideVertical: NO_BORDER
}
const NO_CELL_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER }
const ZERO_MARGINS = { top: 0, bottom: 0, left: 0, right: 0 }

function cardBorders(color: string) {
  const b = { style: BorderStyle.SINGLE, size: 4, color }
  return { top: b, bottom: b, left: b, right: b }
}

function run(text: string, opts: { size?: number; bold?: boolean; color?: string } = {}): TextRun {
  return new TextRun({
    text: text || '',
    font: FONT,
    size: opts.size ?? 20,
    bold: opts.bold ?? false,
    color: opts.color ?? C.ink
  })
}

/** 小标题：深色文字 + 蓝色左竖条（还原 .section h2 { border-left:4px solid #2563eb }）。 */
function sectionHeading(text: string, pageBreakBefore = false): Paragraph {
  return new Paragraph({
    pageBreakBefore,
    spacing: { before: 200, after: 100 },
    border: { left: { style: BorderStyle.SINGLE, size: 26, color: C.blue2, space: 8 } },
    children: [run(text, { size: 22, bold: true, color: C.ink })]
  })
}

function muted(text: string, size = 19): Paragraph {
  return new Paragraph({ spacing: { after: 40 }, children: [run(text, { size, color: C.muted })] })
}

function bullet(text: string, color = C.slate, size = 19): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 20 },
    children: [run(text, { size, color })]
  })
}

/** 标题 + 右对齐时间（右制表位，等价 justify-between）。 */
function entryHead(title: string, period: string): Paragraph {
  return new Paragraph({
    spacing: { before: 80, after: 10 },
    tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH_TWIP }],
    children: [
      run(title, { size: 21, bold: true, color: C.ink }),
      new TextRun({ children: [new Tab()] }),
      run(period, { size: 19, color: C.muted })
    ]
  })
}

function experienceBlock(
  items: Array<{ title: string; subtitle: string; period: string; highlights: string[] }>,
  emptyText: string
): Paragraph[] {
  if (!items.length) return [muted(emptyText)]
  const out: Paragraph[] = []
  for (const it of items) {
    out.push(entryHead(it.title, it.period))
    if (it.subtitle.trim()) out.push(muted(it.subtitle))
    for (const h of it.highlights) out.push(bullet(h))
  }
  return out
}

/** 核心技能：浅蓝胶囊（用 run 背景色近似，方角）。 */
function chipsParagraph(skills: string[]): Paragraph {
  if (!skills.length) return muted('暂无可提炼技能')
  const children: TextRun[] = []
  skills.forEach((s) => {
    children.push(
      new TextRun({
        text: `  ${s}  `,
        font: FONT,
        size: 18,
        color: C.blue,
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.chipBg }
      })
    )
    children.push(new TextRun({ text: '  ', font: FONT, size: 18 }))
  })
  return new Paragraph({ spacing: { before: 20, after: 40, line: 300 }, children })
}

/** .card：白底 + 浅蓝细框 + 蓝色标题。 */
function infoCard(title: string, body: string): TableCell {
  return new TableCell({
    margins: { top: 110, bottom: 110, left: 150, right: 150 },
    verticalAlign: VerticalAlign.TOP,
    borders: cardBorders(C.cardBorder),
    children: [
      new Paragraph({ spacing: { after: 50 }, children: [run(title, { size: 20, bold: true, color: C.blue })] }),
      new Paragraph({ children: [run(body || '—', { size: 19, color: C.slate })] })
    ]
  })
}

/** .card 风格的列表卡（候选人优势 / 需核验风险）：浅蓝框 + 蓝标题。 */
function blueListCard(title: string, items: string[], emptyText: string): TableCell {
  const children: Paragraph[] = [
    new Paragraph({ spacing: { after: 50 }, children: [run(title, { size: 20, bold: true, color: C.blue })] })
  ]
  if (items.length) for (const it of items) children.push(bullet(it))
  else children.push(muted(emptyText))
  return new TableCell({
    margins: { top: 110, bottom: 110, left: 150, right: 150 },
    verticalAlign: VerticalAlign.TOP,
    borders: cardBorders(C.cardBorder),
    children
  })
}

/** .jd-card：白底 + 浅灰细框 + 深色标题（标题前小竖条，红=客户要求 / 蓝=职责）。 */
function jdListCard(title: string, items: string[], accent: string, emptyText: string): TableCell {
  const children: Paragraph[] = [
    new Paragraph({
      spacing: { after: 60 },
      border: { left: { style: BorderStyle.SINGLE, size: 22, color: accent, space: 6 } },
      children: [run(title, { size: 20, bold: true, color: C.ink })]
    })
  ]
  if (items.length) for (const it of items) children.push(bullet(it))
  else children.push(muted(emptyText))
  return new TableCell({
    margins: { top: 110, bottom: 110, left: 150, right: 150 },
    verticalAlign: VerticalAlign.TOP,
    borders: cardBorders(C.jdBorder),
    children
  })
}

function twoColCards(left: TableCell, right: TableCell): Table {
  const gap = 180
  const colW = Math.round((CONTENT_WIDTH_TWIP - gap) / 2)
  const gapCell = new TableCell({
    width: { size: gap, type: WidthType.DXA },
    margins: ZERO_MARGINS,
    borders: NO_CELL_BORDERS,
    children: [new Paragraph({ children: [new TextRun({ text: '' })] })]
  })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: NO_TABLE_BORDERS,
    columnWidths: [colW, gap, colW],
    rows: [new TableRow({ children: [left, gapCell, right] })]
  })
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, Math.round(Number(v) || 0)))
}
function toFive(v: number): number {
  return Math.max(0, Math.min(5, Math.round((Number(v) / 100) * 50) / 10))
}
function fmt(v: number): string {
  return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)
}

/**
 * 评分条（嵌套表格三段式，对应 .score-track 的双色轨道）：
 *  深色 = 候选人；浅红 = 岗位要求高出候选人的差额；浅灰 = 剩余轨道。
 *  trackTwip 取右栏宽度，使细条铺满评分区。
 */
function scoreBarCell(candPct: number, reqPct: number, containerTwip: number): TableCell {
  const cand = clampPct(candPct)
  const req = clampPct(reqPct)
  const trackTwip = Math.max(200, containerTwip - 120)
  const darkW = Math.round((trackTwip * cand) / 100)
  const redW = req > cand ? Math.round((trackTwip * (req - cand)) / 100) : 0
  const greyW = Math.max(0, trackTwip - darkW - redW)
  const segs: Array<{ w: number; fill: string }> = []
  if (darkW > 0) segs.push({ w: darkW, fill: C.dark })
  if (redW > 0) segs.push({ w: redW, fill: C.reqFill })
  if (greyW > 0 || segs.length === 0) segs.push({ w: greyW || 1, fill: C.track })
  const cells = segs.map(
    (s) =>
      new TableCell({
        width: { size: Math.max(1, s.w), type: WidthType.DXA },
        margins: ZERO_MARGINS,
        borders: NO_CELL_BORDERS,
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: s.fill },
        children: [new Paragraph({ children: [new TextRun({ text: '', size: 6 })] })]
      })
  )
  const innerTable = new Table({
    width: { size: trackTwip, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: segs.map((s) => Math.max(1, s.w)),
    borders: NO_TABLE_BORDERS,
    rows: [new TableRow({ children: cells, height: { value: 130, rule: HeightRule.ATLEAST } })]
  })
  return new TableCell({
    width: { size: containerTwip, type: WidthType.DXA },
    margins: { top: 30, bottom: 30, left: 50, right: 50 },
    borders: NO_CELL_BORDERS,
    verticalAlign: VerticalAlign.CENTER,
    children: [innerTable]
  })
}

/** 右栏的评分面板：name(28%) | track | score(右对齐)。 */
function scorePanelTable(dimensions: ShenpuDocxDimension[], rightColTwip: number): Table {
  const nameW = Math.round(rightColTwip * 0.26)
  const numW = Math.round(rightColTwip * 0.2)
  const barW = Math.max(400, rightColTwip - nameW - numW)
  const rows = dimensions.slice(0, 6).map(
    (d) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: nameW, type: WidthType.DXA },
            margins: { top: 30, bottom: 30, left: 0, right: 40 },
            borders: NO_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ children: [run(d.label, { size: 18, bold: true, color: C.slate })] })]
          }),
          scoreBarCell(d.candidate, d.requirement, barW),
          new TableCell({
            width: { size: numW, type: WidthType.DXA },
            margins: { top: 30, bottom: 30, left: 40, right: 0 },
            borders: NO_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  run(fmt(toFive(d.candidate)), { size: 18, bold: true, color: C.dark }),
                  run(` / ${fmt(toFive(d.requirement))}`, { size: 16, color: C.muted })
                ]
              })
            ]
          })
        ]
      })
  )
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    columnWidths: [nameW, barW, numW],
    borders: NO_TABLE_BORDERS,
    rows
  })
}

/** 画像结论灰底框（还原 .summary { background:#f8fafc }）。 */
function summaryBox(conclusion: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_TABLE_BORDERS,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            margins: { top: 110, bottom: 110, left: 140, right: 140 },
            borders: NO_CELL_BORDERS,
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.summaryBg },
            children: [
              new Paragraph({ spacing: { after: 40 }, children: [run('画像结论', { size: 19, bold: true, color: C.blue })] }),
              new Paragraph({ children: [run(conclusion || '—', { size: 18, color: C.slate })] })
            ]
          })
        ]
      })
    ]
  })
}

/** 岗位匹配画像：左大雷达图 + 右（画像结论灰框 + 评分条）。 */
function portraitTable(input: ShenpuDocxInput): Table {
  const dims = input.doc.portrait.dimensions
  const leftW = Math.round(CONTENT_WIDTH_TWIP * 0.58)
  const rightW = CONTENT_WIDTH_TWIP - leftW

  const radarChildren: Paragraph[] = []
  if (input.radarPng && input.radarPng.length) {
    radarChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({ type: 'png', data: input.radarPng, transformation: { width: 405, height: 210 } })]
      })
    )
  } else {
    radarChildren.push(muted('（雷达图渲染失败）'))
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: NO_TABLE_BORDERS,
    columnWidths: [leftW, rightW],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: leftW, type: WidthType.DXA },
            margins: { top: 40, bottom: 40, left: 0, right: 140 },
            borders: NO_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            children: radarChildren
          }),
          new TableCell({
            width: { size: rightW, type: WidthType.DXA },
            margins: { top: 40, bottom: 40, left: 0, right: 0 },
            borders: NO_CELL_BORDERS,
            verticalAlign: VerticalAlign.TOP,
            children: [summaryBox(input.doc.portrait.conclusion), new Paragraph({ spacing: { after: 60 }, children: [] }), scorePanelTable(dims, rightW)]
          })
        ]
      })
    ]
  })
}

export async function buildShenpuResumeDocx(input: ShenpuDocxInput): Promise<Buffer> {
  const doc = input.doc
  const children: (Paragraph | Table)[] = []

  // 顶部：蓝色顶边 + 品牌 + 姓名 + 一句话定位（与 .cover 一致，无 meta 行）
  children.push(
    new Paragraph({
      spacing: { after: 30 },
      border: { top: { style: BorderStyle.SINGLE, size: 30, color: C.blue, space: 1 } },
      children: [run('申朴标准简历', { size: 17, bold: true, color: C.blue })]
    })
  )
  children.push(
    new Paragraph({ spacing: { after: 20 }, children: [run(input.candidateName || '候选人', { size: 38, bold: true, color: C.ink })] })
  )
  if (doc.headline.trim()) {
    children.push(new Paragraph({ spacing: { after: 60 }, children: [run(doc.headline, { size: 22, color: C.slate })] }))
  }

  // 职业概述 / 岗位匹配摘要
  children.push(twoColCards(infoCard('职业概述', doc.professionalSummary), infoCard('岗位匹配摘要', doc.targetMatchSummary)))

  // 核心技能
  children.push(sectionHeading('核心技能'))
  children.push(chipsParagraph(doc.coreSkills))

  // 工作经历
  children.push(sectionHeading('工作经历'))
  children.push(
    ...experienceBlock(
      doc.workExperiences.map((x) => ({ title: x.company, subtitle: x.title, period: x.period, highlights: x.highlights })),
      '原始简历未提取到明确工作经历。'
    )
  )

  // 项目经历
  children.push(sectionHeading('项目经历'))
  children.push(
    ...experienceBlock(
      doc.projectExperiences.map((x) => ({ title: x.name, subtitle: x.role, period: x.period, highlights: x.highlights })),
      '原始简历未提取到明确项目经历。'
    )
  )

  // 教育经历
  children.push(sectionHeading('教育经历'))
  children.push(
    ...experienceBlock(
      doc.educationExperiences.map((x) => ({ title: x.school, subtitle: `${x.major} ${x.degree}`.trim(), period: x.period, highlights: [] })),
      '原始简历未提取到明确教育经历。'
    )
  )

  // 第二页：岗位匹配画像
  children.push(sectionHeading('岗位匹配画像', input.pageBreakBeforePortrait !== false))
  children.push(portraitTable(input))

  // 客户要求 / 岗位职责描述
  children.push(new Paragraph({ spacing: { after: 60 }, children: [] }))
  children.push(
    twoColCards(
      jdListCard('客户要求', doc.clientRequirements, C.red, '岗位 JD 中未提供明确客户要求。'),
      jdListCard('岗位职责描述', doc.responsibilities, C.blue2, '岗位 JD 中未提供明确职责描述。')
    )
  )

  // 候选人优势 / 需核验风险
  children.push(new Paragraph({ spacing: { after: 60 }, children: [] }))
  children.push(
    twoColCards(
      blueListCard('候选人优势', doc.strengths, '暂无'),
      blueListCard('需核验风险', doc.risks, '暂无明显风险')
    )
  )

  children.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 140 },
      children: [run('由申朴智能招聘系统基于岗位 JD 与候选人简历生成', { size: 15, color: C.muted })]
    })
  )

  const document = new Document({
    styles: { default: { document: { run: { font: FONT, size: 20, color: C.ink } } } },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(PAGE_MARGIN_Y_MM),
              bottom: convertMillimetersToTwip(PAGE_MARGIN_Y_MM),
              left: convertMillimetersToTwip(PAGE_MARGIN_X_MM),
              right: convertMillimetersToTwip(PAGE_MARGIN_X_MM)
            }
          }
        },
        children
      }
    ]
  })

  return (await Packer.toBuffer(document)) as Buffer
}
