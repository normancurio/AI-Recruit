import Taro from '@tarojs/taro'

import { flowLog } from './flowLog'

export type RequirePluginFn = (name: string) => any

/**
 * 使用微信同声传译插件将题目转为语音，播完后执行 onDone（通常再开转写）。
 * 文档：WechatSI.textToSpeech，content 约 1000 字节内。
 */
function setInnerAudioObeyMuteSwitch(ctx: Taro.InnerAudioContext) {
  try {
    const c = ctx as unknown as { obeyMuteSwitch?: boolean }
    if ('obeyMuteSwitch' in c) c.obeyMuteSwitch = false
  } catch {
    /* ignore */
  }
}

type TtsPlayOpts = {
  requirePlugin: RequirePluginFn
  audioRef: { current: Taro.InnerAudioContext | null }
  onStatus?: (line: string) => void
  onPlayStart?: () => void
}

/** 后台拉取读题音频本地路径；首题在用户点击里同步 play 时需先有 filename */
export function prefetchInterviewQuestionTtsPath(
  rawText: string,
  requirePlugin: RequirePluginFn,
  onResult: (filename: string | null) => void
): void {
  const text = String(rawText || '').trim()
  if (!text) {
    onResult(null)
    return
  }
  const safe = text.slice(0, 450)
  const runOnce = (isRetry: boolean) => {
    try {
      const plugin = requirePlugin('WechatSI')
      if (typeof plugin?.textToSpeech !== 'function') {
        flowLog('面试读题 TTS 预拉', false, 'textToSpeech 不可用')
        onResult(null)
        return
      }
      plugin.textToSpeech({
        lang: 'zh_CN',
        content: safe,
        success: (res: { filename?: string }) => {
          const fn = res?.filename
          if (fn) {
            onResult(fn)
            return
          }
          if (!isRetry) {
            setTimeout(() => runOnce(true), 420)
            return
          }
          onResult(null)
        },
        fail: () => {
          if (!isRetry) {
            setTimeout(() => runOnce(true), 500)
            return
          }
          onResult(null)
        }
      })
    } catch {
      if (!isRetry) {
        setTimeout(() => runOnce(true), 400)
        return
      }
      onResult(null)
    }
  }
  runOnce(false)
}

function playInnerAudioFromTtsFile(
  filename: string,
  opts: TtsPlayOpts,
  onDone: () => void,
  isRetry: boolean,
  /** 预生成文件 play 失败时改走完整 textToSpeech（仍可能受异步限制） */
  fallbackTextToSpeech: () => void
): void {
  const fn = String(filename || '').trim()
  if (!fn) {
    fallbackTextToSpeech()
    return
  }
  let ctx = opts.audioRef.current
  if (!ctx) {
    ctx = Taro.createInnerAudioContext()
    opts.audioRef.current = ctx
  }
  setInnerAudioObeyMuteSwitch(ctx)
  try {
    ctx.stop()
  } catch {
    /* ignore */
  }
  ctx.src = fn
  let settled = false
  let hasPlayed = false
  let playErrorRetryTimer: ReturnType<typeof setTimeout> | null = null
  const finish = (statusLine: string) => {
    if (settled) return
    settled = true
    if (playErrorRetryTimer) {
      clearTimeout(playErrorRetryTimer)
      playErrorRetryTimer = null
    }
    ctx?.offEnded(onEnd)
    ctx?.offError(onErr)
    ctx?.offPlay(onPlay)
    opts.onStatus?.(statusLine)
    onDone()
  }
  const onPlay = () => {
    hasPlayed = true
    if (playErrorRetryTimer) {
      clearTimeout(playErrorRetryTimer)
      playErrorRetryTimer = null
    }
    try {
      opts.onPlayStart?.()
    } catch {
      /* ignore */
    }
  }
  const onEnd = () => {
    finish('请口述您的回答')
  }
  const onErr = () => {
    if (playErrorRetryTimer) {
      clearTimeout(playErrorRetryTimer)
      playErrorRetryTimer = null
    }
    if (!hasPlayed && !isRetry) {
      flowLog('面试读题 TTS', false, '预生成文件 play 失败，回退 textToSpeech')
      settled = true
      ctx?.offEnded(onEnd)
      ctx?.offError(onErr)
      ctx?.offPlay(onPlay)
      fallbackTextToSpeech()
      return
    }
    finish('请口述您的回答')
  }
  ctx.offEnded()
  ctx.offError()
  ctx.offPlay()
  ctx.onPlay(onPlay)
  ctx.onEnded(onEnd)
  ctx.onError(onErr)
  playErrorRetryTimer = setTimeout(() => {
    playErrorRetryTimer = null
    if (!hasPlayed && !settled) {
      flowLog('面试读题 TTS', false, 'play 未在时限内开始，重试')
      settled = true
      ctx?.offEnded(onEnd)
      ctx?.offError(onErr)
      ctx?.offPlay(onPlay)
      if (!isRetry) {
        setTimeout(() => playInnerAudioFromTtsFile(filename, opts, onDone, true, fallbackTextToSpeech), 120)
      } else {
        opts.onStatus?.('请口述您的回答')
        onDone()
      }
    }
  }, 2200)
  try {
    ctx.play()
  } catch (playEx) {
    flowLog('面试读题 TTS', false, playEx instanceof Error ? playEx.message : 'ctx.play exception')
    if (playErrorRetryTimer) {
      clearTimeout(playErrorRetryTimer)
      playErrorRetryTimer = null
    }
    ctx?.offEnded(onEnd)
    ctx?.offError(onErr)
    ctx?.offPlay(onPlay)
    if (!isRetry) {
      setTimeout(() => playInnerAudioFromTtsFile(filename, opts, onDone, true, fallbackTextToSpeech), 380)
    } else {
      fallbackTextToSpeech()
    }
  }
}

export function playInterviewQuestionTts(
  rawText: string,
  opts: TtsPlayOpts & {
    /**
     * 已在后台 textToSpeech 得到的本地路径；与「用户点击」同栈调用 play 时传入，避免微信丢弃异步回调里的 play。
     */
    prebuiltFilename?: string
  },
  onDone: () => void
): void {
  const text = String(rawText || '').trim()
  if (!text) {
    onDone()
    return
  }
  opts.onStatus?.('AI 面试官读题中…')

  const runTextToSpeech = (isRetry: boolean) => {
    try {
      const plugin = opts.requirePlugin('WechatSI')
      if (typeof plugin?.textToSpeech !== 'function') {
        opts.onStatus?.('当前环境不支持语音读题，请阅读文字')
        flowLog('面试读题 TTS', false, 'textToSpeech 不可用')
        onDone()
        return
      }
      const safe = text.slice(0, 450)
      plugin.textToSpeech({
        lang: 'zh_CN',
        content: safe,
        success: (res: { filename?: string }) => {
          const fn = res?.filename
          if (!fn) {
            if (!isRetry) {
              flowLog('面试读题 TTS', false, 'filename 空，重试一次')
              setTimeout(() => runTextToSpeech(true), 420)
              return
            }
            opts.onStatus?.('读题音频生成失败，请阅读文字')
            onDone()
            return
          }
          playInnerAudioFromTtsFile(
            fn,
            opts,
            onDone,
            false,
            () => void runTextToSpeech(false)
          )
        },
        fail: (err: unknown) => {
          flowLog('面试读题 TTS', false, `fail ${String(err)}`.slice(0, 120))
          if (!isRetry) {
            setTimeout(() => runTextToSpeech(true), 500)
            return
          }
          opts.onStatus?.('请口述您的回答')
          onDone()
        }
      })
    } catch (e) {
      flowLog('面试读题 TTS', false, e instanceof Error ? e.message.slice(0, 120) : 'exception')
      if (!isRetry) {
        setTimeout(() => runTextToSpeech(true), 400)
        return
      }
      opts.onStatus?.('请口述您的回答')
      onDone()
    }
  }

  const pre = String(opts.prebuiltFilename || '').trim()
  if (pre) {
    playInnerAudioFromTtsFile(pre, opts, onDone, false, () => void runTextToSpeech(false))
    return
  }

  runTextToSpeech(false)
}
