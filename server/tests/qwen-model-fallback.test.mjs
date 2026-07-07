import assert from 'node:assert/strict'
import {
  defaultQwenPlusModel,
  isQwenPlusModelQuotaExhausted,
  qwenPlusModelFallbackFor,
  QWEN_PLUS_MODEL_DATED,
  QWEN_PLUS_MODEL_FALLBACK
} from '../../shared/qwenModelConfig.ts'

assert.equal(defaultQwenPlusModel(), QWEN_PLUS_MODEL_FALLBACK)
assert.equal(qwenPlusModelFallbackFor(QWEN_PLUS_MODEL_DATED), QWEN_PLUS_MODEL_FALLBACK)
assert.equal(qwenPlusModelFallbackFor('qwen3.7-plus'), null)
assert.equal(qwenPlusModelFallbackFor('qwen3.5-ocr'), null)

assert.equal(isQwenPlusModelQuotaExhausted(Object.assign(new Error('Allocated quota exceeded'), { httpStatus: 400 })), true)
assert.equal(isQwenPlusModelQuotaExhausted(Object.assign(new Error('invalid api key'), { httpStatus: 401 })), false)

console.log('qwen-model-fallback tests passed')
