import { defineConfig } from '@tarojs/cli'

export default defineConfig<'webpack5'>({
  projectName: 'miniapp-candidate',
  date: '2026-03-24',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  framework: 'react',
  compiler: 'webpack5',
  mini: {},
  h5: {},
  alias: {},
  plugins: [],
  /** 编译期替换为字符串字面量，避免小程序运行时访问 process（未配置的 TARO_APP_* 不会被打包替换） */
  defineConstants: {
    TARO_VOIP_FALLBACK_OPENID: JSON.stringify(process.env.TARO_APP_VOIP_FALLBACK_INTERVIEWER_OPENID || ''),
    TARO_FLOW_DEBUG: JSON.stringify(process.env.TARO_APP_FLOW_DEBUG === '1' ? '1' : '')
  }
})
