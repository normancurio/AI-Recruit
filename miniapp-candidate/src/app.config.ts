export default defineAppConfig({
  pages: [
    'pages/entry/index',
    'pages/login/index',
    'pages/lobby/index',
    'pages/invite/index',
    'pages/interview/index',
    'pages/interviewer/index',
    'pages/result/index'
  ],
  window: {
    navigationBarTitleText: 'AI 面试',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f8fafc',
    backgroundTextStyle: 'light'
  },
  permission: {
    'scope.camera': {
      desc: '用于 AI 面试采集画面（腾讯云 TRTC 推流或本机预览，以实际能力为准）'
    },
    'scope.record': {
      desc: '用于语音答题转写为文字'
    }
  },
  plugins: {
        WechatSI: {
          version: '0.3.6', // 建议使用较新版本，如 0.3.6 或 0.0.7
          provider: 'wx069ba97219f66d99',
        },
  }
})
