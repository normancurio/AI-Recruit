# miniapp-candidate

候选人微信小程序端（Taro + React）。

## 运行

1. 安装依赖
   - `npm install`
2. 启动微信小程序构建
   - `npm run dev:weapp`
3. 使用微信开发者工具导入本目录

## 业务流程（面试官邀请 → 候选人面试）

1. **面试官侧（HR）**  
   在管理端为岗位生成/展示**面试邀请码**（如 `J001`），通过微信、短信或邮件发给候选人；需要视频时，面试官在小程序「面试官」页进入同一会话并发起 VoIP。

2. **候选人首页：`pages/login/index`（导航标题：面试邀请）**  
   - 文案含义：**你已收到面试邀请**。  
   - 候选人填写：**姓名、手机号、面试邀请码**。  
   - 点击「验证邀请并进入候场」：微信登录换取 `openid` → 后端校验邀请码 → 写入本地缓存（含岗位信息）。

3. **候场页：`pages/lobby/index`（面试准备）**  
   展示已核对的岗位与邀请码，提示环境与隐私；点击「进入面试答题」进入答题/转写流程。

4. **面试页：`pages/interview/index`**  
   拉取题目、同步实时转写与问答到服务端；面试官端可看板或同屏视频。

5. **结果页：`pages/result/index`**  
   提交后展示评分与说明（具体规则由后端/业务配置）。

**页面跳转链：**  
`登录/受邀页` → `候场` → `面试` → `结果`  

**面试官入口：** 同在小程序内 `pages/login/index` 底部「我是面试官」→ `pages/interviewer/index`。

## 接口说明

- 若未配置 `TARO_APP_API_BASE`，默认走本地 mock 数据
- 配置后将调用以下接口：
  - `POST /api/wechat/login`
  - `POST /api/candidate/validate-invite`
  - `GET /api/candidate/interview-questions?jobId=xxx`
  - `POST /api/live/session/start`
  - `POST /api/live/session/bind-members`
  - `POST /api/live/session/transcript`
  - `POST /api/live/session/qa`
  - `POST /api/candidate/submit-interview`

可参考 `.env.example` 创建本地环境变量文件。

## 微信同声转写说明

- 面试页提供“开启同声转写”按钮，优先使用微信 `WechatSI` 插件识别语音并同步到面试官看板。
- 若未配置该插件，会自动降级为手动输入文本，同样会同步到看板。

## 微信原生视频通话（面试官与候选人都在小程序）

- 已在面试官页接入 `wx.startVoIPChat`，路径：`pages/interviewer/index`
- 你需要提供双方 `openid`（`members` 必须包含当前用户 openid）
- 当前已补“openid 获取链路”：小程序登录后自动调用 `/api/wechat/login` 换取 openid，并在会话中绑定角色
- 前置要求：
  - 两端均为同一小程序体系下用户
  - 小程序具备对应类目与能力权限
  - 用户已授权摄像头/麦克风

建议由后端通过登录态换取 `openid` 后下发给前端，前端不要自行“猜”openid。
