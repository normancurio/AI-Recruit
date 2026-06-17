export type ResumeEvalJobType = 'risk_ops' | 'engineering' | 'product' | 'professional'
export type ResumeEvalTechDirection = '后端' | '前端' | '全栈' | '客户端' | '数据'

export { detectResumeEvalJobType } from './resumeEvalJobDetect.ts'

export type BuildResumeEvalPromptInput = {
  jobType: ResumeEvalJobType
  jobJD: string
  resumeText: string
  extraRequirements?: string
  techDirection?: ResumeEvalTechDirection
}

const DATA_JOB_RE = /数据开发|数据工程|大数据|数仓|ETL|BI|数据分析|数据库开发|数据平台|数据治理|数据实施|hive|spark|kettle|doris|flink/i
const FRONTEND_RE = /前端|web前端|h5|react|vue|angular|小程序/i
const FULLSTACK_RE = /全栈|full[\s-]?stack/i
const CLIENT_RE = /客户端|android|ios|移动端|flutter|react native/i

export function detectResumeEvalTechDirection(jobTitle: string, jdText: string): ResumeEvalTechDirection {
  const blob = `${jobTitle} ${jdText}`
  if (DATA_JOB_RE.test(blob)) return '数据'
  if (FRONTEND_RE.test(blob)) return '前端'
  if (FULLSTACK_RE.test(blob)) return '全栈'
  if (CLIENT_RE.test(blob)) return '客户端'
  return '后端'
}

/** 与 geminiService / 服务端共用的完整评估 user prompt */
export function buildResumeEvalUserPrompt(input: BuildResumeEvalPromptInput): string {
  const { jobType, jobJD, resumeText, extraRequirements = '', techDirection = '后端' } = input

  const commonHeader = `
你是资深招聘评估专家。请基于【岗位JD】和【候选人简历】输出结构化评估结果。
要求：证据驱动、禁止臆测、输出严格JSON（不要额外文本）。
风险项必须可核验：禁止把简历正文已明确写出的技能/业务/项目经验写成“缺乏/未见/未体现”。

【岗位JD】
${jobJD}

【候选人简历】
${resumeText}

【补充要求】
${extraRequirements || '无'}
`.trim()

  if (jobType === 'risk_ops') {
    return `${commonHeader}

# 评估场景
岗位类型：风控运营

# 流程
1. 硬性门槛校验（Pass/Fail）
- 学历/年限硬要求
- 风控相关经验（信贷/反欺诈/交易风控/策略运营）
- 数据分析能力（SQL/Excel/BI至少一种）
- 核心场景（策略迭代、规则配置、指标监控、异常排查）

2. 六维度评分（0-100）
- risk_fit（权重25）
- depth（权重20）
- impact（权重20）
- data_skill（权重15）
- stability_growth（权重10）
- education_fit（权重10，学历/专业与岗位门槛匹配；须摘录学校、学历层次）

3. 评分约束
- 无量化成果 => impact最高70
- 无SQL/数据分析证据 => data_skill最高65
- 缺风控场景 => risk_fit最高60

4. 每个维度至少1条证据（来自简历原文），不得省略任一维度（含 stability_growth、education_fit）
证据格式：["证据点：...｜摘录：..."]

5. 输出最多5条风险，每条附面试核验问题

6. 结论仅三选一
- 建议进入面试
- 建议备选
- 不建议推进

# 输出JSON格式
{
  "schema_version": "v1.0",
  "job_type": "risk_ops",
  "hard_gate": { "passed": true, "items": [{"name": "", "result": "pass", "reason": ""}] },
  "dimension_scores": {
    "risk_fit": {"score": 0, "weight": 25, "evidence": [""]},
    "depth": {"score": 0, "weight": 20, "evidence": [""]},
    "impact": {"score": 0, "weight": 20, "evidence": [""]},
    "data_skill": {"score": 0, "weight": 15, "evidence": [""]},
    "stability_growth": {"score": 0, "weight": 10, "evidence": [""]},
    "education_fit": {"score": 0, "weight": 10, "evidence": [""]}
  },
  "total_score": 0,
  "strengths": [""],
  "risks": [{"risk": "", "interview_question": ""}],
  "decision": "建议进入面试",
  "summary": "",
  "candidate_name": "",
  "candidate_profile": {}
}`.trim()
  }

  if (jobType === 'product') {
    return `${commonHeader}

# 评估场景
岗位类型：产品经理（非研发/非写代码岗）

# 流程
1. 硬性门槛校验（Pass/Fail）
- 产品/需求分析相关经验年限
- 原型与需求文档能力（Axure/墨刀/Figma/需求说明书/PRD 等，按 JD）
- 行业或业务域匹配（如 JD 要求的金融、租赁、信贷、B 端等）
- 跨部门沟通与推动研发测试验收的能力

2. 六维度评分（0-100）
- product_fit（权重25，岗位/行业/工具栈匹配；看 Axure/墨刀、敏捷、业务域，不看编程语言）
- product_depth（权重20，需求全链路、产品模块复杂度、独立负责边界）
- impact（权重20，业务成果；上线、效率、指标优先）
- collaboration（权重15，沟通协同、推动落地、跨团队协调）
- stability_growth（权重10）
- education_fit（权重10，学历/专业与岗位门槛匹配；须摘录学校、学历层次）

3. 评分约束
- 不得因「不会写代码/缺代码质量」扣分；产品经理不评估 code_quality/tech_fit
- 无原型/PRD/需求文档证据 => product_fit 最高 65
- 仅辅助执行、无独立负责产品模块 => product_depth 最高 70
- 缺量化成果 => impact 最高 75

4. 每个维度至少1条证据（来自简历原文），不得省略任一维度
证据格式：["证据点：...｜摘录：..."]

5. 输出最多5条风险，每条附面试核验问题（业务/产品追问，非代码题）

6. 结论仅三选一
- 建议进入面试
- 建议备选
- 不建议推进

# 输出JSON格式
{
  "schema_version": "v1.0",
  "job_type": "product",
  "hard_gate": { "passed": true, "items": [{"name": "", "result": "pass", "reason": ""}] },
  "dimension_scores": {
    "product_fit": {"score": 0, "weight": 25, "evidence": [""]},
    "product_depth": {"score": 0, "weight": 20, "evidence": [""]},
    "impact": {"score": 0, "weight": 20, "evidence": [""]},
    "collaboration": {"score": 0, "weight": 15, "evidence": [""]},
    "stability_growth": {"score": 0, "weight": 10, "evidence": [""]},
    "education_fit": {"score": 0, "weight": 10, "evidence": [""]}
  },
  "total_score": 0,
  "strengths": [""],
  "risks": [{"risk": "", "interview_question": ""}],
  "decision": "建议进入面试",
  "summary": "",
  "candidate_name": "",
  "candidate_profile": {}
}`.trim()
  }

  if (jobType === 'professional') {
    return `${commonHeader}

# 评估场景
岗位类型：专业/职能/项目/设计/运营/实施岗（非研发写代码岗）

# 流程
1. 硬性门槛校验（Pass/Fail）
- 岗位相关经验年限与 JD 要求
- 核心工具/方法论/行业域匹配（如 PMP、Axure、设计工具、运营指标、实施交付等，按 JD）
- 学历/证书等硬要求（若有）

2. 六维度评分（0-100）
- role_fit（权重25，岗位/行业/工具/方法论匹配；不得用编程语言或代码质量评估）
- role_depth（权重20，专业深度、项目负责边界、复杂问题处理）
- impact（权重20，业务成果与量化指标）
- collaboration（权重15，沟通协同、跨团队推动）
- stability_growth（权重10）
- education_fit（权重10）

3. 评分约束
- 不得评估 code_quality/tech_fit/engineering_depth；非研发岗禁止因「不会写代码」扣分
- 无直接岗位相关工具/方法证据 => role_fit 最高 65
- 仅辅助执行、无独立负责 => role_depth 最高 70
- 缺量化成果 => impact 最高 75

4. 每个维度至少1条证据（来自简历原文）
证据格式：["证据点：...｜摘录：..."]

5. 输出最多5条风险，每条附面试核验问题（岗位/业务追问，非代码题）

6. 结论仅三选一
- 建议进入面试
- 建议备选
- 不建议推进

# 输出JSON格式
{
  "schema_version": "v1.0",
  "job_type": "professional",
  "hard_gate": { "passed": true, "items": [{"name": "", "result": "pass", "reason": ""}] },
  "dimension_scores": {
    "role_fit": {"score": 0, "weight": 25, "evidence": [""]},
    "role_depth": {"score": 0, "weight": 20, "evidence": [""]},
    "impact": {"score": 0, "weight": 20, "evidence": [""]},
    "collaboration": {"score": 0, "weight": 15, "evidence": [""]},
    "stability_growth": {"score": 0, "weight": 10, "evidence": [""]},
    "education_fit": {"score": 0, "weight": 10, "evidence": [""]}
  },
  "total_score": 0,
  "strengths": [""],
  "risks": [{"risk": "", "interview_question": ""}],
  "decision": "建议进入面试",
  "summary": "",
  "candidate_name": "",
  "candidate_profile": {}
}`.trim()
  }

  return `${commonHeader}

# 评估场景
岗位类型：研发岗（${techDirection}）
${techDirection === '数据' ? '\n# 数据岗侧重\ntech_fit 重点看 SQL/ETL/调度/数仓建模与 JD 工具栈匹配；code_quality 看脚本规范、SQL 优化、数据质量与治理；engineering_depth 看数据项目中的职责边界与难点。' : ''}

# 流程
1. 硬性门槛校验（Pass/Fail）
- 核心技术栈匹配
- 年限要求
- 工程实践要求（性能/稳定性/工程化/测试）

2. 六维度评分（0-100）
- tech_fit（权重25）
- engineering_depth（权重20）
- impact（权重20）
- code_quality（权重15）
- stability_growth（权重10）
- education_fit（权重10，学历/专业与岗位门槛匹配；须摘录学校、学历层次）

3. 评分约束
- 无复杂项目/核心模块经历 => engineering_depth最高70
- 缺量化成果 => impact最高75
- 技术名词堆砌无场景 => tech_fit最高65

4. 每个维度至少1条证据（来自简历原文），不得省略任一维度（含 stability_growth、education_fit）
证据格式：["证据点：...｜摘录：..."]

5. 输出最多5条风险，每条附技术追问

6. 结论仅三选一
- 建议进入面试
- 建议备选
- 不建议推进

# 输出JSON格式
{
  "schema_version": "v1.0",
  "job_type": "engineering",
  "hard_gate": { "passed": true, "items": [{"name": "", "result": "pass", "reason": ""}] },
  "dimension_scores": {
    "tech_fit": {"score": 0, "weight": 25, "evidence": [""]},
    "engineering_depth": {"score": 0, "weight": 20, "evidence": [""]},
    "impact": {"score": 0, "weight": 20, "evidence": [""]},
    "code_quality": {"score": 0, "weight": 15, "evidence": [""]},
    "stability_growth": {"score": 0, "weight": 10, "evidence": [""]},
    "education_fit": {"score": 0, "weight": 10, "evidence": [""]}
  },
  "total_score": 0,
  "strengths": [""],
  "risks": [{"risk": "", "interview_question": ""}],
  "decision": "建议进入面试",
  "summary": "",
  "candidate_name": "",
  "candidate_profile": {}
}`.trim()
}

/** 服务端 DashScope 调用的 system 补充说明 */
export function buildResumeEvalSystemPrompt(): string {
  return (
    '只输出一个 JSON 对象，无 markdown、无解释文字。' +
    'candidate_name 为简历正文中的真实候选人姓名，无法识别用 ""；禁止把文件名、模板名、项目名、岗位名当姓名。' +
    'candidate_profile 从简历抽取，无依据省略；尽量填 school,job_title,email,candidate_phone,current_company,gender,age,work_experience_years,major,education；禁止编造。' +
    'dimension_scores 每项 {"score":0-100,"evidence":["…"]}；evidence 不得为空，须摘录简历原文；无直接依据时选最接近的一句。' +
    'education_fit 须依据简历中的学校、学历层次、专业，不得编造。' +
    'risks 为 {"risk","interview_question"} 数组；每条风险必须可核验。' +
    'decision 仅：建议进入面试|建议备选|不建议推进。' +
    'hard_gate 任一项 fail 时 passed 必须为 false，decision 不得为「建议进入面试」，total_score 应低于六维加权分。'
  )
}
