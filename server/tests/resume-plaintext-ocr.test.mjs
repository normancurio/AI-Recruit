import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const serverSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')

test('resume upload detects low-quality plaintext and runs full OCR', () => {
  assert.match(serverSource, /function isResumePlaintextLowQuality\(/)
  assert.match(serverSource, /function resolveResumePlaintextForScreening\(/)
  assert.match(serverSource, /extractResumeByOcr\(buffer, originalname, mimetype, 'full'\)/)
  assert.match(serverSource, /正文质量偏低，尝试 OCR 转写/)
})

test('resume OCR supports multi-page PDF and image uploads', () => {
  assert.match(serverSource, /function renderPdfPagesToPngDataUris\(/)
  assert.match(serverSource, /function resumeFileToOcrImageDataUris\(/)
  assert.match(serverSource, /resumeOcrMaxPages\(\)/)
  assert.match(serverSource, /PNG\/JPG/)
})

test('resume upload deduplicates by name when phone is missing', () => {
  assert.match(serverSource, /duplicate job\+name check/)
  assert.match(serverSource, /未识别到手机号/)
})
