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
  }
})
