import Taro from '@tarojs/taro'

import { flowLog } from './flowLog'

export type RequirePluginFn = (name: string) => any

/**
 * 使用微信同声传译插件将题目转为语音，播完后执行 onDone（通常再开转写）。
 * 文档：WechatSI.textToSpeech，content 约 1000 字节内。
 */
export function playInterviewQuestionTts(
  rawText: string,
  opts: {
    requirePlugin: RequirePluginFn
    audioRef: { current: Taro.InnerAudioContext | null }
    onStatus?: (line: string) => void
  },
  onDone: () => void
): void {
  const text = String(rawText || '').trim()
  if (!text) {
    onDone()
    return
  }
  opts.onStatus?.('AI 面试官读题中…')
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
          opts.onStatus?.('读题音频生成失败，请阅读文字')
          onDone()
          return
        }
        let ctx = opts.audioRef.current
        if (!ctx) {
          ctx = Taro.createInnerAudioContext()
          opts.audioRef.current = ctx
        }
        try {
          ctx.stop()
        } catch {
          /* ignore */
        }
        ctx.src = fn
        let settled = false
        let hasPlayed = false
        const finish = (statusLine: string) => {
          if (settled) return
          settled = true
          ctx?.offEnded(onEnd)
          ctx?.offError(onErr)
          ctx?.offPlay(onPlay)
          opts.onStatus?.(statusLine)
          onDone()
        }
        const onPlay = () => {
          hasPlayed = true
        }
        const onEnd = () => {
          finish('请口述您的回答')
        }
        const onErr = () => {
          // 不展示失败文案，统一回到可作答状态；用户仍可看题面文字作答。
          finish('请口述您的回答')
        }
        ctx.offEnded()
        ctx.offError()
        ctx.offPlay()
        ctx.onPlay(onPlay)
        ctx.onEnded(onEnd)
        ctx.onError(onErr)
        ctx.play()
      },
      fail: (err: unknown) => {
        flowLog('面试读题 TTS', false, `fail ${String(err)}`.slice(0, 120))
        opts.onStatus?.('请口述您的回答')
        onDone()
      }
    })
  } catch (e) {
    flowLog('面试读题 TTS', false, e instanceof Error ? e.message.slice(0, 120) : 'exception')
    opts.onStatus?.('请口述您的回答')
    onDone()
  }
}
