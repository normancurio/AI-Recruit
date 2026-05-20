# AI-Recruit 项目规则与知识摘要

项目路径：`/Users/jsonhe/shenpu-project/AI-Recruit`

## 1. 最高优先级约定

- 当用户说“客户端”“小程序”时，只指 `miniapp-candidate/`。
- 当用户说“api”“服务器”或“server”时，只指 `server/`。
- 当用户说“后台”时，只指 `src/`。
- 本项目改动只面向局域网数据库，不默认影响线上数据。
- 改完如果需要重启，主动帮用户重启，不要只给命令。
- 不要把 `DASHSCOPE_API_KEY`、数据库密码或其它密钥写进客户端、文档示例或日志说明。

## 2. 本地服务与常用命令

三个本地服务：

| 服务 | 地址 | 启动命令 |
|---|---|---|
| API / server | `http://127.0.0.1:3011` | `npm run dev:api` |
| 后台管理端 | `http://127.0.0.1:3010` | `ADMIN_UI_PORT=3010 ADMIN_API_UPSTREAM=http://127.0.0.1:3011 npm run dev` |
| 候选人 H5 | `http://127.0.0.1:10086/` | `cd miniapp-candidate && npm run dev:h5` |

根目录脚本：

- `npm run dev:api`：启动 `server/index.ts`。
- `npm run dev`：启动根级 `server.ts`，管理端入口和本地代理。
- `npm run dev:full`：同时启动后台和 API。
- `npm run build`：构建后台。
- `npm run lint`：`tsc --noEmit`。
- `npm run build:weapp --prefix miniapp-candidate`：构建小程序。

重启原则：

- 改 `src/`：通常 Vite 热更新，不一定重启。
- 改 `server/`：通常需要重启 API 或确认 watcher 已重启。
- 改 `miniapp-candidate/`：Taro dev 会自动重编，必要时重跑 H5 / weapp dev。
- 如需一键重启，优先使用 `./restart-services.sh`，它会清理端口并启动 API、后台、候选人 H5。

macOS 重启 API 时不要用 `xargs -r`，BSD `xargs` 不支持。可用：

```bash
pids=$(lsof -ti tcp:3011 || true); if [ -n "$pids" ]; then kill $pids; fi; sleep 1; npm run dev:api
```

健康检查：

- API：`curl -s http://127.0.0.1:3011/api/health`
- 正常应返回 `ok/db/redis` 都为 `true`。
- 模板等后台接口无登录令牌返回 `401` 属于正常鉴权，不是接口不存在。

## 3. 局域网依赖

- MySQL：`192.168.2.114:3306`
- Redis：`192.168.2.114:6379`
- 服务器 SSH 别名：`timbo-ssh`
- 服务器重启后 MySQL / Redis 不会自动起来，需要 daemon 启动，不要在 SSH 会话里走 `launchctl`。
- 本机 MySQL CLI 路径：`/opt/homebrew/opt/mysql-client/bin/mysql`
- `mysql -e` 模式不要在末尾用 `\G`，需要竖向输出用 `--vertical`。

## 4. 三端分工

### 客户端 / 小程序：`miniapp-candidate/`

- Taro 4 + React 18。
- 页面在 `miniapp-candidate/src/pages/`。
- API 封装在 `miniapp-candidate/src/services/`。
- 面试相关类型在 `miniapp-candidate/src/types/interview.ts`。
- 客户端只调用服务端接口，不写入大模型密钥。

### 服务端 / API：`server/`

- 主要入口是 `server/index.ts`。
- 负责候选人接口、后台接口、AI 面试题生成、评分、数据库读写、迁移兼容。
- API 契约变化时必须同步检查后台 `src/` 和小程序 `miniapp-candidate/` 调用方。

### 后台：`src/`

- 主页面集中在 `src/App.tsx`。
- 后台全局样式在 `src/index.css`。
- 通用选择器在 `src/components/pickers.tsx`。
- 表格拖拽列宽工具在 `src/components/resizableColumns.tsx`。

## 5. AI 面试题生成链路

- 小程序 AI 面试题由服务端实时调用大模型生成。
- 主要入口：`server/index.ts` 的 `GET /api/candidate/interview-questions`。
- 当前小程序主流程一次性拉取 6 道题，服务端走 `generatePersonalizedInterviewSix()`。
- `generatePersonalizedInterviewFirst()` / `generatePersonalizedInterviewRest()` 仍存在，但不是当前小程序主调用路径。
- 生成题目的 `system prompt` 走数据库里的 AI 面试官模板。
- 预设模板 `申朴面试官AI` 已落库到业务库 `ai_interview_prompt_templates`。
- 生成题目的 `user prompt` 模板写死在 `server/index.ts` 的 `buildPersonalizedInterviewUserPromptBlock()` 中，不在数据库。
- `user prompt` 填充值来自数据库：岗位从 `jobs` 读取，简历从 `resume_screenings` 读取。
- `jobId` 对应 `jobs.job_code`。
- `resumeScreeningId` 对应 `resume_screenings.id`。
- 出题时若传入 `resumeScreeningId`，先按 `resume_screenings.id` 查并校验 `job_code`；没有命中再按 `job_code + candidate_name` 兜底。
- 简历正文拼接在 `packResumeScreeningRow()`：如果 `resume_plaintext.trim().length >= 120`，只用 `resume_plaintext`；否则拼入 `report_summary`。
- 拼 prompt 前会压缩空白：`.replace(/\s+/g, ' ')`；JD 最多 12000 字符，简历最多 20000 字符。
- 生成后的面试题写入 `interview_questions`，字段包括 `session_id`、`question_no`、`question_text`、`source`。

## 6. AI 面试官模板与权限

- 后台菜单叫 `AI面试官`。
- 页面组件：`src/App.tsx` 的 `SystemInterviewPromptTemplatesView`。
- 页面交互是“列表 + 弹框”：新增、编辑、复制都在弹框中完成。
- 新建模板时只在前端追加未保存草稿，名称和 System Prompt 为空；保存后才入库。
- 复制模板时追加未保存副本，保存后才入库。
- 弹框里的“恢复”只在编辑已有模板或复制草稿时出现，含义是恢复到打开弹框那一刻。
- 预设模板 `申朴面试官AI` 不能删除；删除按钮必须禁用。
- 预设模板默认 System Prompt 固化为 6 道题，不再使用 `{{total}}`。
- 发起面试邀请时选择 AI 面试官模板，服务端把模板 ID 写入 `interview_invitations.prompt_template_id`。
- 生成面试题时按邀请绑定模板读取 System Prompt。
- `初面管理` 列表需要展示本场面试使用的 AI 面试官模板名称；历史无绑定模板默认视为 `申朴面试官AI`。
- 模板权限统一由角色管理里的菜单权限控制：拥有 `sys-interview-prompt` / `AI面试官` 菜单即可查看、发起选择、维护模板。
- 后台用户支持多角色，关系表是管理库 `user_roles`；旧字段 `users.role` 保留为主角色兼容旧逻辑。
- 登录时读取多个角色并合并 `roles.menu_keys`。
- 菜单管理支持 `目录`、`可见菜单`、`不可见菜单（数据权限）`；默认新增菜单应是可见菜单。

## 7. 邀请码、H5 登录与模板绑定

- H5 调试时客户端可传伪 code：`code: "h5-dev:<openid>"`，前提是 env `ALLOW_H5_DEV_LOGIN="1"`。
- 服务端接受候选人微信登录 code 的入口必须统一走 `resolveLoginCode(code)`，不要直接调用 `exchangeWechatJsCode(code)`。
- 邀请码格式：`<岗位码>-<HR账号>-<筛查记录id>`。
- 生成函数：`buildStructuredInviteCode`。
- 解析函数：`resolveInviteCode`。
- 登录入参解析和落库接受逻辑在 `/api/candidate/login-invite`。
- `resumeScreeningId` 决定后续出题绑定哪份简历。

模板绑定优先级：

1. `inviteCode + jobCode` 找 `interview_invitations.prompt_template_id`。
2. `sessionId -> interview_sessions.invitation_id -> interview_invitations.prompt_template_id`。
3. `jobCode + resumeScreeningId` 找最近一次有模板的邀请。
4. 找不到才用默认 `申朴面试官AI`。

H5 拉题必须传：`jobId`、`candidateName`、`resumeScreeningId`、`inviteCode`、`sessionId`。

预取缓存 key 必须包含 `inviteCode` / `sessionId`，换模板重新发邀时要避免吃到旧题。

## 8. 自定义 AI 面试官与评分

用户核心意图：生成邀请码时选择哪个 AI 面试官，候选人用这个邀请码进入后，出题和评分都必须围绕这场 AI 面试官实际问出的题。

`申朴面试官AI`：

- 保持默认技术面试流程。
- System Prompt 是资深技术面试官、固定 6 题、Q1 自我介绍、Q2/Q3 简历项目深挖、Q4-Q6 与 JD 强相关技术题。
- User Prompt 注入候选人姓名、岗位、部门、JD、简历节选。
- 输出约束为 JSON：`{"questions":[...]}`。

自定义 AI 面试官：

- `system = 用户配置的 System Prompt 原文 + 平台保护规则`。
- AI 面试官模板优先级最高；若模板与岗位 JD / 简历冲突，以模板为准。
- JD / 简历只作背景，不能改变出题领域。
- 题量从模板中解析，例如“恰好 3 道题”；没写题量才默认 6 题。
- 自定义模板不能混入默认技术面试规则，尤其不要追加“Q2/Q3 围绕简历项目、Q4-Q6 与 JD 强相关技术题”。

评分入口：`POST /api/candidate/submit-interview`。

评分必须基于本场实际问答：

```text
questionsAndAnswers = [
  { question: AI 面试官实际问的问题, answer: 候选人的回答 }
]
```

评分依据顺序：

1. 先逐题看 `question` 要求。
2. 再判断对应 `answer` 是否正面回答。
3. AI 面试官模板用于解释题目的考察意图和领域。
4. 不能因为候选人主动转移到其它岗位能力就给高分或通过。

默认模板评分维度：`communication`、`technicalDepth`、`logic`、`jobFit`、`stability`。

自定义模板评分维度：`communication`、`domainFit`、`answerCompleteness`、`logic`、`riskControl`。

## 9. 小程序面试测试助手

- 小程序面试页可启用“测试助手”，在当前题下提供 `低分 / 中等 / 高分` 自动回答按钮。
- 测试助手只用于本地开发。
- 客户端只调服务端接口，不写大模型密钥。
- 服务端接口：`server/index.ts` 的 `POST /api/candidate/interview-test-answer`。
- 前端调用：`miniapp-candidate/src/services/interviewApi.ts`。
- 双开关都开启才可用：客户端 `TARO_APP_INTERVIEW_TEST_HELPER=1`，服务端 `ENABLE_INTERVIEW_TEST_HELPER=1`。
- 生成回答应基于当前题目、岗位、候选人上下文区分低/中/高质量，不要写死模板文本。

## 10. 后台选择器与表单交互

通用选择器位于 `src/components/pickers.tsx`：

- `SearchableSelect`：长列表单选，支持搜索、自动定位当前值。
- `TreeSelect`：树形单选，支持搜索、祖先链保留、层级回填。
- `MultiSelectPanel`：长列表多选，支持搜索、固定高度。

约定：

- 动态长列表选择场景优先使用统一 Picker，不用原生 `<select>`。
- 短枚举项如状态、性别、是否、部门类型等可以保留原生下拉。
- 已明确应接入 Picker 的场景：岗位、项目、部门、负责人、角色、目标岗位、职位筛选等。
- 当前统一选择器不做内部分页；`pageSize` 可作为兼容入参保留但内部不依赖。
- 搜索前后保持内容区高度稳定，避免弹窗整体抖动。
- 树形搜索命中子节点时必须连带祖先节点，不能只剩叶子。
- 树形收起后的已选值优先展示完整路径，例如 `申朴信息 / 交付五部`。
- 树形打开时如果已有选中值，应自动滚动到该节点附近，并尽量让目标项处于可视区中部。
- 系统维护类弹窗除保存外的关闭行为都要做脏检测：右上关闭、取消、点击遮罩。
- 已按脏检测处理的维护弹窗：用户、部门、角色、菜单；后续新增同类弹窗默认复用。

## 11. 后台表格与列表交互

`岗位分配`：

- 页面组件：`src/App.tsx` 的 `JobQueryView`。
- 主要表格是“岗位列表”。
- `交付负责人`、`招聘部门` 等可能截断的单元格需要两行省略，并用原生 `title` hover 展示完整内容。
- `招聘部门` hover 文案直接展示完整招聘部门，不展示内部解释字段。
- `项目状态` 徽标例如 `进行中` 必须不换行。
- 岗位编码例如 `JMP2373WX` 是岗位码，用于筛查、邀请、报告等关联。
- 后台列表里双击岗位码应复制到剪贴板。
- 双击复制后行内显示短暂 `复制成功`；鼠标样式保持默认，不改成复制光标，不自动选中文字。
- `初面管理` 的岗位编码也支持双击复制，但目前暂未加成功提示。

表格列拖动工具：

- 工具位置：`src/components/resizableColumns.tsx`。
- 导出 `useColumnWidths` 和 `ResizableTh`。
- 列宽按 `tableId` 持久化到 `localStorage`，key 前缀 `ai-recruit:col-widths:`。
- `<th>` 右边缘 8px hit area，光标 `col-resize`。
- 双击恢复该列默认宽度。
- 表头可放“恢复列宽”按钮调用 `cols.resetAll()`。
- 表格必须用 `table-fixed`，并展开 `cols.tableStyle`。
- `<th>` 不要再写 `w-[xx]` 等固定宽度，统一由 `colgroup` 控制。
- 使用 `truncate` / `line-clamp` 时要给被截元素加 `title`。

已接入拖拽列宽的表格：

- 简历管理：`ResumeScreeningView`，key `resume-screening`
- 简历库：`ResumeLibraryView`，key `resume-library`
- 初面管理：`ApplicationManagementView`，key `application-mgmt`
- 岗位分配：`JobQueryView`，key `job-query` / `job-query-rm`
- 客户管理：`ClientManagementView`，key `clients`
- 用户管理：`SystemUserView`，key `sys-user`
- 部门管理：`SystemDeptView`，key `sys-dept`
- 角色管理：`SystemRoleView`，key `sys-role`
- 菜单管理：`SystemMenuView`，key `sys-menu`
- 标准岗位：`SystemJobRoleBasesView`，key `sys-job-role-bases`
- AI 面试官：`SystemInterviewPromptTemplatesView`，key `sys-interview-prompt`

新增列表表格默认沿用这套机制。

## 12. 部门树与排序

- 部门树不能依赖名称字典序排序。
- `交付一部 / 交付二部 / … / 交付十部` 不能按 `name ASC` 排，否则 `交付十部` 会排到 `交付二部` 前。
- 部门表需要持久化人工顺序字段 `sort_order`。
- 服务端读取部门时优先按 `level ASC, sort_order ASC, name ASC`。
- 前端树形展开也应优先使用 `sort_order`。
- 管理库旧表若缺少 `sort_order`，服务启动时会自动补列。
- 手工迁移文件：`server/migration_depts_sort_order.sql`。
- 历史没有排序值的同级部门应先按自然顺序初始化。
- 中文数字部门名称默认整理成 `一部 -> 二部 -> ... -> 十部`。
- 部门管理页提供“调整排序”模式，支持同级部门拖拽排序并立即持久化。
- 拖拽排序不应跨父级。
- 部门排序一旦确定，部门管理列表、树形选择器、项目表单等所有依赖部门树的地方都应共享同一顺序。

## 13. 后台布局与可点击状态

后台壳用户意图：左侧菜单固定、顶部栏固定，只有右侧内容区域滚动。

关键实现：

- `src/index.css`：
  - `html, body, #root { height: 100%; }`
  - `body { overflow: hidden; }`
- `src/App.tsx` 后台外壳：
  - 外层 `flex h-screen h-[100dvh] overflow-hidden bg-slate-50`
  - 左侧 `aside` 桌面端 `md:h-full`
  - 右侧 `main` 使用 `flex h-[100dvh] min-h-0 ... overflow-hidden`
  - 顶部 `header` 使用 `sticky top-0 z-40 ... bg-white/95 ... backdrop-blur`
  - 内容区使用 `min-h-0 flex-1 overflow-x-hidden overflow-y-auto`
- 不要把滚动放回 `body` 或整页容器。

响应式：

- PC `md+`：sidebar 占据 flow 空间，main 自动让位。
- 手机 `<768px`：sidebar 是 fixed overlay + 半透明遮罩。
- 断点跨过 768px 时通过 `matchMedia.addEventListener('change')` 自动展开/收起。
- 主内容区 padding：`p-2 sm:p-6 lg:p-8`。
- 后台 PC 优先，手机端不用花哨适配，但要保证 sidebar 不挡内容、表格能横向滚动、关键控件不重叠。

可点击元素：

- 后台所有可点击元素 hover 时应出现手型，尽量由全局 CSS 覆盖，不逐个组件加。
- 禁用态统一 `cursor: not-allowed`，不要把禁用按钮也显示成手型。

## 14. 简历上传异步化

用户意图：上传简历不能让用户在弹框里等待同步处理。选中文件并创建任务后，弹框应立即关闭，列表马上出现“上传中”的占位/预填记录；原始简历提取、AI 筛查入库、申朴标准简历生成都在列表行展示进度。

服务端：

- 核心文件：`server/index.ts`。
- `POST /api/admin/resume-screen` 是任务提交接口，创建任务后立即返回 `202` 和 `taskId`。
- 后台任务执行 `processResumeScreenTask()`。
- 任务状态保存在进程内 `resumeScreenTasks: Map<string, ResumeScreenTask>`，TTL 1 小时。
- 任务维护两条进度：
  - `uploadProgress / uploadStage`
  - `shenpuProgress / shenpuStage / shenpuStatus`
- 轮询接口：`GET /api/admin/resume-screen/tasks/:taskId`。
- 如果已生成 `screeningId` 且申朴简历仍在生成，会读取 `resume_screening_shenpu_resumes` 同步最新状态。

前端：

- 核心文件：`src/App.tsx`。
- `runUpload()` 上传后只拿 `taskId`，立即关闭上传弹框。
- `useEffect` 轮询任务接口。
- `displayResumes` 合成占位行和真实行。
- 依赖简历内容或文件的按钮，在上传提取期间显示进度或禁用态，不能提前可点。
- 进度条文案面向业务用户，不暴露底层模型、数据库或内部函数名。

## 15. 申朴标准简历 PDF

入口与关键函数在 `server/index.ts`：

- 雷达图 SVG：`shenpuRadarSvg()`
- 右侧匹配条：`shenpuPortraitScoreRows()`
- 整页 HTML：`renderShenpuResumeHtml()`
- HTML 转 PDF：`renderHtmlToPdfBuffer()`

评分尺度：

- 数据库/AI 输出 `portrait.dimensions[].candidate / requirement` 仍是 0-100。
- 展示层统一归一化到 0-5 满分。
- 雷达图刻度 1/2/3/4/5，图例“满分 5 分”。
- 多边形顶点直接标注分值，候选人黑色加粗，岗位要求红色小字 + 红点。

排版：

- 雷达图 SVG `viewBox` 高度压到 290，CSS `max-height: 230px`。
- `.portrait` 用 `grid-template-columns: 430px 1fr` 和 `align-items: start`。
- `.section` 间距压到 `margin-top: 8px`。

PDF 渲染必须用 new headless，并同时给：

```bash
--headless=new
--no-pdf-header-footer
--print-to-pdf-no-header
```

旧 `--headless` 上 `--no-pdf-header-footer` 不生效，会继续出现日期和 `file://` 路径。

## 16. 常见本地问题

### H5 显示 directory listing

- 现象：`http://127.0.0.1:10086/` 显示 `listing directory /`。
- 根因：Taro H5 dev server 没稳定生成 `miniapp-candidate/dist/index.html`。
- `restart-services.sh` 会自动补入口页。
- 健康检查不能只看 HTTP 200；如果响应含 `<title>listing directory /</title>`，应判为错误并补入口页。
- 补出的入口页引用 `/remoteEntry.js`、`/runtime.js`、`/app.js`。
- 浏览器仍显示旧目录页时先强刷：`Cmd + Shift + R`。

### 后台报 `net::ERR_CONNECTION_REFUSED`

- 优先判断 API 进程没在 `3011` 监听，不要先怀疑接口路由没写。
- 本机终端环境可能没有 `npm` 在 PATH 上，用户 Node 由 nvm 管理。
- 可优先使用 `/Users/jsonhe/.nvm/versions/node/v26.1.0/bin/npm`。

### 后台选择器撑宽

- 岗位/项目等 `SearchableSelect` 空状态文案要短。
- 已收短示例：
  - `暂无可用岗位，请联系管理员在系统中维护岗位信息` -> `暂无岗位`
  - `当前项目下暂无岗位，请更换项目或绑定岗位到项目` -> `当前项目无岗位`
  - `暂无分配岗位，无法按项目筛选` -> `暂无分配岗位`
  - `暂无可用项目，请先在「项目管理」中创建` -> `暂无项目`
- `SearchableSelect` 当前值区域保留 `min-w-0 flex-1 truncate`，按钮本身也要 `min-w-0`。

### 面试邀请复制反馈

- `面试邀请已生成` 弹窗里的 `复制邀请码` 不能静默复制。
- 成功后显示：`已成功复制到剪切板～`。
- 失败后显示：`复制失败，请手动复制`。
- 复制逻辑复用 `copyTextToClipboard()`，包含 `navigator.clipboard.writeText` 和 `document.execCommand('copy')` 兜底。

## 17. 项目代理建议

本项目适合按端拆分代理上下文：

- 主协调：拆需求、判断影响范围、收口。
- 客户端代理：只看 `miniapp-candidate/`。
- API 代理：只看 `server/`。
- 后台代理：只看 `src/`。
- 跨端联调审查：改完检查 API 契约、数据库字段、权限、缓存、提示词和三端一致性。

项目级 Cursor 子代理放在 `.cursor/agents/`。日常使用时用户仍只需要在主聊天框描述需求，例如：

```text
按 AI-Recruit 项目代理模式处理这个需求：xxx。先判断涉及客户端、server、后台哪些端，改完后做跨端检查，需要重启就自动重启。
```
