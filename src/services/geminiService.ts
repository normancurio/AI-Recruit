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
