# web-candidate

候选人 **PC / H5 浏览器版** AI 面试（Vite + React），与 `miniapp-candidate` 微信小程序独立，共用同一套后端 API。

## 运行

```bash
cd web-candidate
npm install
cp .env.example .env.local   # 可选，默认代理到 127.0.0.1:3011
npm run dev
```

浏览器打开 http://localhost:5174 。需同时启动本地 API：`npm run dev:api`（项目根目录）。

## 流程

登录（姓名 + 手机号 + 邀请码）→ 候场 → AI 面试（摄像头 + 语音转写/手动输入）→ 提交结果

## 主要接口

- `POST /api/candidate/login-invite-h5` — H5 登录（无需微信 code）
- `GET /api/candidate/interview-questions`
- `POST /api/live/session/start`、`/transcript`、`/qa`
- `GET /api/live/session/follow-up`
- `POST /api/candidate/submit-interview`

## 生产构建

```bash
npm run build
```

产物在 `dist/`。部署时需配置 `VITE_API_BASE` 指向线上 API（如 `https://mind.cisetech.com`），或由 Nginx 将 `/api` 反代到 API 服务。

## 说明

- 语音读题：浏览器 `speechSynthesis`（读题期间不显示/不写入转写）
- 语音作答：
  - **优先** Chrome/Edge `SpeechRecognition` 实时转写
  - **降级** 每 25s 分段录音上传 `POST /api/candidate/ai-interview/asr`（百炼 ASR）
  - **再降级** 手动输入
- 转写上报：`/api/live/session/transcript` 600ms 防抖（与小程序一致）
- 切题：先停识别 → 读题 TTS → 开门控 → 再开识别；含读题回声过滤
- **视频（M2）**：优先 `trtc-sdk-v5` 进房推流（仅视频，麦克风留给 ASR）；未配置 TRTC 时回退本机预览
- 字幕同步：`/api/live/session/transcript` + `/api/live/session/trtc-signal`（及 TRTC 自定义消息双写）
