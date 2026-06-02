import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')

test('shenpu resume generation route uses collation-safe job_code join', () => {
  const routeStart = source.indexOf("app.post('/api/admin/resume-screenings/:id/shenpu-resume'")
  assert.notEqual(routeStart, -1)

  const nextRoute = source.indexOf('\napp.', routeStart + 1)
  const routeSource = source.slice(routeStart, nextRoute === -1 ? undefined : nextRoute)

  assert.match(routeSource, /resumeScreeningsJobCodeMatchSql\('j', 's'\)/)
  assert.doesNotMatch(routeSource, /LEFT JOIN jobs j ON\s+j\.job_code\s*=\s*s\.job_code/)
})

test('shenpu resume generation route loads current project template before generating', () => {
  const routeStart = source.indexOf("app.post('/api/admin/resume-screenings/:id/shenpu-resume'")
  assert.notEqual(routeStart, -1)

  const nextRoute = source.indexOf('\napp.', routeStart + 1)
  const routeSource = source.slice(routeStart, nextRoute === -1 ? undefined : nextRoute)

  assert.match(routeSource, /LEFT JOIN projects p ON \$\{resumeScreeningsProjectIdMatchSql\('p', 'j'\)\}/)
  assert.match(routeSource, /const projectTemplate = await loadProjectShenpuResumeTemplate\(row\)/)
  assert.match(routeSource, /template: projectTemplate/)
})

test('shenpu resume download refuses stale file when current project template is office format', () => {
  const routeStart = source.indexOf("app.get('/api/admin/resume-screenings/:id/shenpu-resume'")
  assert.notEqual(routeStart, -1)

  const nextRoute = source.indexOf('\napp.', routeStart + 1)
  const routeSource = source.slice(routeStart, nextRoute === -1 ? undefined : nextRoute)

  assert.match(routeSource, /const projectTemplate = await loadProjectShenpuResumeTemplate\(r\)/)
  assert.match(routeSource, /templateKindFromTemplate\(projectTemplate\)/)
  assert.match(routeSource, /templateKindFromFile\(storedName, storedMime\)/)
  assert.match(routeSource, /templateKind === 'word' \|\| templateKind === 'xlsx'/)
  assert.match(routeSource, /请重新生成申朴简历/)
})

test('project template Word resume preserves uploaded template package', () => {
  const renderStart = source.indexOf('async function renderProjectTemplateResumeDocxBuffer')
  assert.notEqual(renderStart, -1)

  const nextFunction = source.indexOf('\nfunction renderProjectTemplateResumeHtml', renderStart + 1)
  const renderSource = source.slice(renderStart, nextFunction === -1 ? undefined : nextFunction)

  assert.match(renderSource, /requireCjs\('jszip'\)/)
  assert.match(renderSource, /fs\.readFileSync\(params\.templateAbsPath\)/)
  assert.match(renderSource, /zip\.file\('word\/document\.xml', documentXml\)/)
  assert.doesNotMatch(renderSource, /new Document\(/)
  assert.doesNotMatch(renderSource, /new Table\(/)
  assert.doesNotMatch(renderSource, /Packer\.toBuffer/)
})

test('project template Word resume uses AI supplied section aliases', () => {
  assert.match(source, /templateSectionAliases/)
  assert.match(source, /任职履历明细/)
  assert.match(source, /templateSectionAliases\?:/)

  const renderStart = source.indexOf('async function renderProjectTemplateResumeDocxBuffer')
  assert.notEqual(renderStart, -1)

  const nextFunction = source.indexOf('\nfunction renderProjectTemplateResumeHtml', renderStart + 1)
  const renderSource = source.slice(renderStart, nextFunction === -1 ? undefined : nextFunction)

  assert.match(renderSource, /params\.doc\.templateSectionAliases\?\.work/)
  assert.match(renderSource, /matchesSection\(rows\[i\], 'work'\)/)
})

test('project template Word resume expands template rows instead of dropping overflow content', () => {
  const renderStart = source.indexOf('async function renderProjectTemplateResumeDocxBuffer')
  assert.notEqual(renderStart, -1)

  const nextFunction = source.indexOf('\nfunction renderProjectTemplateResumeHtml', renderStart + 1)
  const renderSource = source.slice(renderStart, nextFunction === -1 ? undefined : nextFunction)

  assert.match(renderSource, /ensureRowCapacity/)
  assert.match(renderSource, /appendProjectBlock/)
  assert.match(renderSource, /params\.doc\.projectExperiences\.slice\(baseBlockCount\)/)
  assert.match(renderSource, /rows\.join\(''\)/)
})

test('shenpu resume supports xlsx template extraction and rendering', () => {
  assert.match(source, /templateKindFromFile\(/)
  assert.match(source, /templateKindFromTemplate\(/)
  assert.match(source, /requireCjs\('exceljs'\)/)
  assert.match(source, /renderProjectTemplateResumeXlsxBuffer/)
  assert.match(source, /templateKind === 'xlsx'/)
  assert.match(source, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/)
})

test('shenpu resume extraction preserves detailed experience text for template rendering', () => {
  assert.match(source, /不要总结、不要压缩、不要改写为概要/)
  assert.match(source, /项目描述\/职责\/技术栈\/成果/)
  assert.match(source, /highlights: safeTextArray\(r\.highlights, 20\)/)
  assert.match(source, /return parsed\.length \? parsed : fallback\.projectExperiences/)

  const renderStart = source.indexOf('async function renderProjectTemplateResumeDocxBuffer')
  assert.notEqual(renderStart, -1)

  const nextFunction = source.indexOf('\nfunction renderProjectTemplateResumeHtml', renderStart + 1)
  const renderSource = source.slice(renderStart, nextFunction === -1 ? undefined : nextFunction)

  // fillProjectSection 优先尝试按"X、项目名称：xxx"分块填充，否则退化为单 cell 段落式填充
  // single-cell 分支优先使用 AI 按模板示例风格生成的段落，没有再 fallback 到 projectLines()
  assert.match(renderSource, /if \(fillProjectBlocks\(rows, bodyIndex, endIndex\)\) return/)
  assert.match(renderSource, /rows\[bodyIndex\] = replaceRowCell\(rows\[bodyIndex\], 0, ai \|\| projectLines\(\)\)/)
  // 第二次 AI"风格迁移"调用已关闭（容易让模型总结/精简，并把模板占位文字抄进输出）。
  // 函数留作备用，但不再在生成流程里自动调用。
  assert.match(source, /function aiFormatSectionsForTemplate/)
  assert.match(source, /function extractTemplateSectionSamples/)
  assert.doesNotMatch(source, /doc\.sectionFormattedText = await aiFormatSectionsForTemplate/)
  // fillProjectBlocks 用严格正则识别"X、项目名称："分块标题，避免人保财模板表头被误判
  assert.match(renderSource, /projectTitleRe = \/\^\\s\*\(\?:\[/)
  assert.match(renderSource, /项目名称\\s\*\[:：\]/)
  assert.match(renderSource, /label\.includes\('项目描述'\)/)
  // "宁缺毋滥"：候选人原文里没明确写"业绩/规模/公司名"等，模板对应单元格留空；
  // 所有 highlights 完整保留到"项目描述"单元格，不再拆分。
  assert.match(renderSource, /const descLines = spacedHighlights\(project\.highlights\)/)
  assert.match(renderSource, /label\.includes\('工作业绩'\)\) rows\[i\] = replaceRowCell\(rows\[i\], 1, \[''\]\)/)
  assert.match(renderSource, /label\.includes\('项目规模'\)\) rows\[i\] = replaceRowCell\(rows\[i\], 1, \[''\]\)/)
  assert.match(renderSource, /let wroteProjectDetail = false/)
  assert.match(renderSource, /if \(!wroteProjectDetail && project\.highlights\.length\)/)
  assert.match(renderSource, /\[projectTitleLine, \.\.\.descLines\]/)
  assert.doesNotMatch(renderSource, /\[project\.highlights\[0\] \|\| ''\]/)
  // 教育表头行（"毕业院校 | 学历/学位 | 专业" 这种连续字段标签）不应被 fillKeyValueRow 错填
  assert.match(renderSource, /if \(nextLabel && fieldValues\.has\(nextLabel\)\) continue/)
  // 兜底拆分函数应当存在，防止 AI 把多个项目挤进单一对象
  assert.match(source, /function splitMergedProjectsHeuristically/)
  assert.match(source, /sanitized\.projectExperiences = splitMergedProjectsHeuristically\(sanitized\.projectExperiences\)/)
})

test('shenpu pdf generation prefers libreoffice for editable chinese fonts', () => {
  assert.match(source, /injectShenpuPdfEditableFontCss/)
  assert.match(source, /renderHtmlToPdfViaLibreOffice/)
  assert.match(source, /SHENPU_PDF_ENGINE/)
  assert.match(source, /Noto Sans CJK SC/)
  assert.doesNotMatch(source, /PingFang SC/)
})

test('shenpu editable pdf uses libreoffice with chromium radar png embed', () => {
  assert.match(source, /replaceShenpuRadarSvgWithPng/)
  assert.match(source, /renderSvgMarkupToPngBuffer/)
  assert.match(source, /editable/)
  assert.match(source, /SHENPU_STANDARD_RESUME_PDF_CSS/)
  assert.doesNotMatch(source, /embedRadarOverlayOnLoPdf/)
})

test('shenpu resume regeneration corrects stale candidate name from resume text', () => {
  const routeStart = source.indexOf("app.post('/api/admin/resume-screenings/:id/shenpu-resume'")
  assert.notEqual(routeStart, -1)

  const nextRoute = source.indexOf('\napp.', routeStart + 1)
  const routeSource = source.slice(routeStart, nextRoute === -1 ? undefined : nextRoute)

  assert.match(routeSource, /const resumeNameGuess = guessCandidateNameFromResume\(resumeText\)/)
  assert.match(routeSource, /const fileNameGuess = guessCandidateNameFromFilename\(String\(row\.file_name \|\| ''\)\)/)
  assert.match(routeSource, /const effectiveCandidateName = chooseCandidateName\(result\.candidateName, resumeNameGuess, fileNameGuess\)/)
  assert.match(routeSource, /UPDATE resume_screenings SET candidate_name=\?, evaluation_json=\? WHERE id=\?/)
})
