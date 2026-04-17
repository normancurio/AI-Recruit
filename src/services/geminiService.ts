import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface QAPair {
  question: string;
  answer: string;
}

export interface EvaluationResult {
  passed: boolean;
  score: number;
  overallFeedback: string;
  details: {
    question: string;
    feedback: string;
  }[];
}

export async function generateQuestion(track: string, difficulty: string, jobDescription: string, history: string[]): Promise<string> {
  const historyContext = history.length > 0 
    ? `请不要重复以下已经问过的问题：\n${history.map((q, i) => `${i + 1}. ${q}`).join('\n')}` 
    : '';

  const jdContext = jobDescription.trim() ? `\n以下是该岗位的具体招聘要求（JD）：\n${jobDescription}\n请务必根据上述岗位要求来定制面试题，重点考察候选人是否具备JD中提到的技能和经验。` : '';

  const prompt = `你是一个资深的IT技术面试官。当前正在面试一位【${difficulty}】级别的【${track}】候选人。${jdContext}
请提出一道专业的技术面试题。
要求：
1. 问题必须与${track}和${difficulty}级别高度相关${jobDescription.trim() ? '，且紧扣岗位要求' : ''}。
2. 问题应该考察候选人的实际经验、底层原理理解或解决问题的思路，而不仅仅是背诵概念。
3. 直接输出问题本身，不要包含任何问候语、前言或多余的解释。
${historyContext}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: prompt,
    });
    return response.text || "请描述一下你最近解决的一个具有挑战性的技术问题。";
  } catch (error) {
    console.error("Error generating question:", error);
    return "网络似乎有点问题，请描述一下你最熟悉的一个技术栈及其核心原理。";
  }
}

export async function evaluateInterview(track: string, difficulty: string, jobDescription: string, qaPairs: QAPair[]): Promise<EvaluationResult> {
  const interviewTranscript = qaPairs.map((pair, i) => `【问题 ${i + 1}】: ${pair.question}\n【候选人回答】: ${pair.answer}`).join('\n\n');

  const jdContext = jobDescription.trim() ? `\n该岗位的具体招聘要求（JD）如下：\n${jobDescription}\n请在评估时，特别关注候选人的回答是否体现了满足这些具体要求的能力。` : '';

  const prompt = `你是一个资深的IT技术面试官。请根据以下面试记录，对这位【${difficulty}】级别的【${track}】候选人进行严格但客观的评估。${jdContext}

面试记录：
${interviewTranscript}

请评估候选人是否达到了该级别的要求，并给出详细的反馈。`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            passed: { type: Type.BOOLEAN, description: "候选人是否通过了面试" },
            score: { type: Type.NUMBER, description: "综合评分 (0-100)" },
            overallFeedback: { type: Type.STRING, description: "对候选人整体表现的总结评价，指出核心优缺点" },
            details: {
              type: Type.ARRAY,
              description: "对每一道题的具体点评",
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING, description: "原问题" },
                  feedback: { type: Type.STRING, description: "对该回答的详细点评，指出答得好的地方以及不足之处或正确答案的方向" }
                }
              }
            }
          },
          required: ["passed", "score", "overallFeedback", "details"]
        }
      }
    });
    
    const resultText = response.text || "{}";
    return JSON.parse(resultText) as EvaluationResult;
  } catch (error) {
    console.error("Error evaluating interview:", error);
    throw new Error("评估过程中发生错误，请稍后重试。");
  }
}

export type ResumeEvalJobType = 'risk_ops' | 'engineering';

export type BuildResumeEvalPromptInput = {
  jobType: ResumeEvalJobType;
  jobJD: string;
  resumeText: string;
  extraRequirements?: string;
  techDirection?: '后端' | '前端' | '全栈' | '客户端';
};

export type ResumeEvalDecision = '建议进入面试' | '建议备选' | '不建议推进';

export interface ResumeEvalDimensionScore {
  score: number;
  weight: number;
  evidence: string[];
}

export interface ResumeEvalResult {
  schema_version: string;
  job_type: ResumeEvalJobType;
  hard_gate: {
    passed: boolean;
    items: Array<{ name: string; result: 'pass' | 'fail'; reason: string }>;
  };
  dimension_scores: Record<string, ResumeEvalDimensionScore>;
  total_score: number;
  strengths: string[];
  risks: Array<{ risk: string; interview_question: string }>;
  decision: ResumeEvalDecision;
  summary: string;
}

export interface ResumeEvalParsedForDb {
  totalScore: number;
  skillScore: number;
  experienceScore: number;
  educationScore: number;
  stabilityScore: number;
  reportSummary: string;
  evaluationJson: ResumeEvalResult;
}

function clampResumeEvalScore(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function safeArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function pickJsonBlock(raw: string): string {
  const m = raw.match(/```json\s*([\s\S]*?)\s*```/i);
  if (m?.[1]) return m[1].trim();
  return String(raw || '').trim();
}

function normalizeDecision(v: unknown): ResumeEvalDecision {
  const s = String(v || '').trim();
  if (s === '建议进入面试' || s === '建议备选' || s === '不建议推进') return s;
  return '建议备选';
}

function toDimScore(v: any): ResumeEvalDimensionScore {
  return {
    score: clampResumeEvalScore(v?.score),
    weight: Number(v?.weight) || 0,
    evidence: safeArray<string>(v?.evidence).map((x) => String(x || '').trim()).filter(Boolean),
  };
}

function fallbackResumeEval(jobType: ResumeEvalJobType): ResumeEvalResult {
  return {
    schema_version: 'v1.0',
    job_type: jobType,
    hard_gate: {
      passed: false,
      items: [{ name: '解析结果', result: 'fail', reason: '模型输出不可解析，使用兜底结果' }],
    },
    dimension_scores: {},
    total_score: 0,
    strengths: [],
    risks: [{ risk: '模型结果解析失败', interview_question: '请口述你最有代表性的项目与量化成果。' }],
    decision: '建议备选',
    summary: '模型输出解析失败，建议人工复核。',
  };
}

export function buildResumeEvalPrompt(input: BuildResumeEvalPromptInput): string {
  const { jobType, jobJD, resumeText, extraRequirements = '', techDirection = '后端' } = input;

  const commonHeader = `
你是资深招聘评估专家。请基于【岗位JD】和【候选人简历】输出结构化评估结果。
要求：证据驱动、禁止臆测、输出严格JSON（不要额外文本）。

【岗位JD】
${jobJD}

【候选人简历】
${resumeText}

【补充要求】
${extraRequirements || '无'}
`.trim();

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
- communication_business（权重10）

3. 评分约束
- 无量化成果 => impact最高70
- 无SQL/数据分析证据 => data_skill最高65
- 缺风控场景 => risk_fit最高60

4. 每个维度至少1条证据（来自简历原文）
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
    "communication_business": {"score": 0, "weight": 10, "evidence": [""]}
  },
  "total_score": 0,
  "strengths": [""],
  "risks": [{"risk": "", "interview_question": ""}],
  "decision": "建议进入面试",
  "summary": ""
}`.trim();
  }

  return `${commonHeader}

# 评估场景
岗位类型：研发岗（${techDirection}）

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
- communication_business（权重10）

3. 评分约束
- 无复杂项目/核心模块经历 => engineering_depth最高70
- 缺量化成果 => impact最高75
- 技术名词堆砌无场景 => tech_fit最高65

4. 每个维度至少1条证据（来自简历原文）
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
    "communication_business": {"score": 0, "weight": 10, "evidence": [""]}
  },
  "total_score": 0,
  "strengths": [""],
  "risks": [{"risk": "", "interview_question": ""}],
  "decision": "建议进入面试",
  "summary": ""
}`.trim();
}

export function parseResumeEvalResult(
  rawModelOutput: string,
  jobType: ResumeEvalJobType
): ResumeEvalParsedForDb {
  let parsed: ResumeEvalResult;
  try {
    const obj = JSON.parse(pickJsonBlock(rawModelOutput));
    const dimObj = obj?.dimension_scores ?? {};
    const normalizedDims: Record<string, ResumeEvalDimensionScore> = {};
    for (const k of Object.keys(dimObj)) normalizedDims[k] = toDimScore(dimObj[k]);

    parsed = {
      schema_version: String(obj?.schema_version || 'v1.0'),
      job_type: obj?.job_type === 'risk_ops' || obj?.job_type === 'engineering' ? obj.job_type : jobType,
      hard_gate: {
        passed: Boolean(obj?.hard_gate?.passed),
        items: safeArray<any>(obj?.hard_gate?.items).map((it) => ({
          name: String(it?.name || ''),
          result: String(it?.result || '').toLowerCase() === 'fail' ? 'fail' : 'pass',
          reason: String(it?.reason || ''),
        })),
      },
      dimension_scores: normalizedDims,
      total_score: clampResumeEvalScore(obj?.total_score),
      strengths: safeArray<string>(obj?.strengths).map((x) => String(x || '').trim()).filter(Boolean),
      risks: safeArray<any>(obj?.risks)
        .map((r) => ({
          risk: String(r?.risk || '').trim(),
          interview_question: String(r?.interview_question || '').trim(),
        }))
        .filter((x) => x.risk || x.interview_question),
      decision: normalizeDecision(obj?.decision),
      summary: String(obj?.summary || '').trim(),
    };
  } catch {
    parsed = fallbackResumeEval(jobType);
  }

  const ds = parsed.dimension_scores;
  const skillScore = clampResumeEvalScore(parsed.job_type === 'risk_ops' ? ds.data_skill?.score : ds.code_quality?.score);
  const experienceScore = clampResumeEvalScore(parsed.job_type === 'risk_ops' ? ds.depth?.score : ds.engineering_depth?.score);
  const educationScore = clampResumeEvalScore(ds.communication_business?.score);
  const stabilityScore = clampResumeEvalScore(ds.stability_growth?.score);
  const shortRisks = parsed.risks.slice(0, 3).map((r, i) => `${i + 1}. ${r.risk}`).join('；');
  const reportSummary = [
    parsed.summary || '暂无总结',
    parsed.strengths.length ? `优势：${parsed.strengths.slice(0, 3).join('；')}` : '',
    shortRisks ? `风险：${shortRisks}` : '',
    `结论：${parsed.decision}`,
  ]
    .filter(Boolean)
    .join(' | ');

  return {
    totalScore: clampResumeEvalScore(parsed.total_score),
    skillScore,
    experienceScore,
    educationScore,
    stabilityScore,
    reportSummary,
    evaluationJson: parsed,
  };
}
