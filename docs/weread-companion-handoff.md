# 微信读书共读 · 交接文档

> 用途：把这份文档完整发给一个没有上下文的 GPT。仅凭本文，它就能理解产品目标、当前实现、技术架构、数据边界、风险和下一步，不需要先扫描整个项目；若要实际修改代码，仍须获得本文列出的项目文件。
> 状态：接口层 + 共读数据层 + 同步引擎 + 聊天闭环 + 讨论引擎已实现，tsc 全绿，未提交 Git，未部署。
> 项目根：`C:\Users\Samsung\Documents\ChatGPT\爱意\参考项目\renwenaiyi`（Next.js 15 + React + Dexie + Supabase，自部署个人 AI 角色扮演聊天应用）

---

## 0. 一句话定位

用户在微信读书 App 里读书，本应用只做三件事：**同步阅读痕迹（零模型）、安静陪伴（零打扰）、点名才聊（单次模型）**。它是本项目现有"网易云陪听模式"的异构孪生：陪听 = 后台编排音乐流；共读 = 后台同步行为流。

## 1. 官方 API 核实（推翻旧规格书前提）

**腾讯官方 Agent API 真实存在**：`github.com/Tencent/WeChatReading`（腾讯官方，2026-07 v1.0.4）。

| 项 | 官方事实 |
|---|---|
| 统一网关 | `POST https://i.weread.qq.com/api/agent/gateway` |
| 鉴权 | `Authorization: Bearer $WEREAD_API_KEY`，key 格式 `wrk-xxx`，从 https://weread.qq.com/r/weread-skills 获取 |
| 请求体 | JSON：`{api_name, skill_version:"1.0.4", 业务参数平铺}`（禁止包在 params 对象里） |
| 错误约定 | `errcode` 非 0 报错；`upgrade_info` 字段提示版本升级 |
| 7 个所需端点 | `/shelf/sync` `/store/search` `/book/info` `/book/chapterinfo` `/book/getprogress` `/book/bookmarklist` `/review/list/mine` |

⚠️ **重要修正**：本项目 `docs/weread-companion-spec.md`（V1.0 规格书）是基于"微信读书无官方 API、需自建逆向代理"的判断写的。**该判断已被官方 API 推翻**。规格书里关于"用户自建代理 + 凭据存前端 KV"的设计**不再适用**——实际架构是 key 走服务端环境变量，更简单更安全。读规格书时请以此修正为准。

## 2. 架构总览（陪听孪生）

三层架构，每层都有陪听模式的同构先例：

```
浏览器（只见裁剪后数据，无 Key 无 vid）
   ↕ 只调本服务 /api/weread/*
Next API 路由（字段裁剪 · 错误映射 · 登录态校验）
   ↕ Authorization: Bearer $WEREAD_API_KEY（仅服务端环境变量）
微信读书官方网关 i.weread.qq.com
```

与陪听模式的同构对照：

| 维度 | 陪听 | 共读 |
|---|---|---|
| 内容源 | 网易云"我喜欢的音乐" | 微信读书书架 + 划线 + 进度 |
| 用户在哪消费 | 本应用内播放器 | **微信读书 App（外部）** |
| 触发语 | 陪我听歌 | 陪我读书 / 一起读书 / 共读 |
| 旁路方式 | 正则命中 → 不调主模型 | 同左，同一处代码（chat-room.tsx:3824 附近） |
| 后台编排 | 两阶段 LLM 选歌 | 零模型同步 + 单次讨论 |
| 实时事件 | 切歌事件（推） | 无推送，靠同步（拉） |
| 预生成反应 | plans 缓存 7 天 | 不需要（无实时事件） |
| 卡片 mediaType | music_companion_card | reading_companion_card |
| 恢复规则 | 24h 内续播 | 长期恢复（读书是持续行为） |

## 3. 完整文件清单

### 新增 12 个

**接口层（5）**
- `lib/weread-types.ts` — 共享类型（裁剪后结构，前端/服务端共用）
- `lib/server/weread-gateway.ts` — 服务端网关客户端：Bearer 鉴权、15s 超时、errcode 映射、api_name 白名单、日志不打 key
- `lib/server/weread-projections.ts` — 7 个接口的字段白名单裁剪（剥离 vid/secret/isbn/付费/他人数据）
- `app/api/weread/route.ts` — POST 单入口 action 分发，runtime=nodejs
- `lib/weread-client.ts` — 前端瘦客户端：只调本服务 /api/weread

**共读数据层（4）**
- `lib/reading-companion-types.ts` — 领域类型
- `lib/reading-companion-storage.ts` — KV 会话状态 + 事件常量（孪生 music-companion-storage）
- `lib/reading-companion-library.ts` — Dexie 库：去重合并 + 角色档案 + 异常防御
- `lib/reading-companion-sync.ts` — 增量同步引擎：定时/可见/退避，零模型

**讨论 + 聊天层（2）**
- `lib/reading-companion-engine.ts` — 讨论编排：分层注入 + 防捏造 prompt + 结构化档案动作解析
- `lib/reading-companion-chat-handler.ts` — 开始/讨论/结束意图检测 + 副作用收敛（保持 chat-room 改动最小）

**文档（2）**
- `docs/weread-companion-spec.md` — V1.0 规格书（⚠️ 部分过时，见 §1 修正）
- `docs/weread-companion-implementation-report.md` — 接口层验证报告

### 修改既有 6 个（最小化）

| 文件 | 改动 |
|---|---|
| `.env.example` | +5 行 WEREAD_API_KEY 说明 |
| `components/desktop-shell.tsx` | +1 import + start/stop 各 1 行（挂载同步服务） |
| `lib/chat-storage.ts` | mediaType 联合 + reading_companion_card；mediaData + readingCompanionBook/Stats/Status 三字段；MEDIA_PREVIEW_MAP + "[共读]" |
| `components/chat/message-bubble.tsx` | case 分派 + ReadingCompanionCardBubble 组件 + memo 三字段同步 |
| `components/chat/chat-room.tsx` | 三处卡片登记（CHAT_VISUAL_MEDIA_TYPES/CHAT_MEDIA_BUBBLE_TYPES/气泡样式 5936/5937）+ import 2 行 + 旁路分支 |
| `lib/reading-engine.ts` | export resolveReadingInput 和 callReadingLLM（零行为改动，供 companion-engine 复用） |

## 4. 数据流（完整闭环）

```
1. 开始
   用户："陪我读书 三体"
   → chat-room.tsx 旁路 detectReadingCompanionIntent → setPendingGenerate(false) 不调主模型
   → handleReadingCompanionIntent("start")
   → searchWeread("三体") 取首本 → startReadingCompanion → 落共读卡 → requestSync

2. 同步（零模型）
   syncNow: fetchWereadProgress + fetchWereadBookmarks + fetchWereadReviews（首次加 fetchWereadChapters）
   → mergeHighlights 去重合并入 Dexie → 更新 state → 派发 SYNC 事件
   触发源：启动30s后 / 每10min / visibilitychange≥3min / 手动

3. 讨论（1 次模型）
   用户："聊聊刚才看的"
   → 旁路 → handleReadingCompanionIntent("discuss")
   → 先补同步 → 取未讨论划线 ≤20 条 → loadRoleProfile
   → generateCompanionDiscussion（分层注入 + 防捏造 prompt）
   → 回复落库 → 解析 <reading_profile> 块 → appendRoleOpinion + markHighlightsDiscussed

4. 结束
   用户："先不读了"
   → stopReadingCompanion → 档案留存 → 下次"陪我读书 [书名]"恢复
```

## 5. 数据结构

### 服务端 → 浏览器（裁剪后，无账号标识）

7 个接口的裁剪类型见 `lib/weread-types.ts`。剥离字段：vid/userVid、secret（隐私）、isbn、price/paid/payType（付费）、他人公开数据。

### 客户端持久化

```
KV (kv-db / IndexedDB AiPhoneKvDB): ai_phone_reading_companion_v1
ReadingCompanionState {
  active, sessionId, characterId,        // 角色×书×会话三隔离
  book: { bookId, title, author?, coverUrl?, deepLink? },
  startedAt, lastSyncAt,
  status: "idle"|"syncing"|"ready"|"error",
  lastSynced: { chapterUid?, chapterTitle?, progress?, updatedAt? },
  syncError?, needsReauth?, retryAt?
}

Dexie: AiPhoneReadingCompanionDB
├─ shelfBooks    "bookId, updatedAt"                 书架缓存（可再生，不备份）
├─ highlights    "id, bookId, [bookId+kind], createTime, updatedAt"
│   id = `${bookId}:bm_${官方bookmarkId}` / `${bookId}:rv_${官方reviewId}`
│   { text≤500/1000, createTime, discussedAt? }
├─ roleProfiles  "key, characterId, bookId"          角色观点（不可再生 ★待接入云备份）
│   key = `${characterId}:${bookId}`
│   { opinions≤50, discussionDigest≤600, focusQuestions≤30 }
└─ syncState     "bookId"  { lastSyncAt, consecutiveFailures, chapterTitles? }
```

## 6. 安全设计（三条铁律）

1. **WEREAD_API_KEY 只在服务端** `process.env` 读取（`lib/server/weread-gateway.ts:67`）。严禁入前端代码、浏览器存储、日志、回包。错误日志只记 code + message，不记请求头。
2. **响应字段白名单裁剪**（`lib/server/weread-projections.ts`）：剥离 vid/secret/isbn/付费/他人数据。原始回包永不落库。
3. **api_name 白名单**（`WEREAD_ALLOWED_API_NAMES`）：只 7 个只读端点；正文解密类接口天然拒绝。

## 7. 防捏造三道闸（讨论层核心）

1. **物理隔离**：模型只见划线，不见正文。`resolveReadingInput` 的 chapterContent 字段被拼成划线摘要（不是章节原文）。
2. **Prompt 硬约束**：在装配好的消息末尾追加 system 消息（`ANTI_FABRICATION_INSTRUCTION`）：
   - 只有 `[HL:...]` 标注是对方真实划过的原文，引用时原样保留
   - 其余感受必须以"我联想到/我觉得"口吻
   - 严禁声称"书里写了/作者在第X页说"等具体情节页码
   - 没看到正文不要编造未出现在划线里的原文
3. **结构化落档**：回复末尾必须附 `<reading_profile>{"opinion":"≤80字","basedOn":["HL:id"]}</reading_profile>`。解析后观点与引文分离存储，档案页引文只从本地划线库渲染。回复中剥离该块不显示。

## 8. 同步引擎（reading-companion-sync.ts）

- **频率**：启动 30s 后首同步 → 每 10min 定时 → visibilitychange 可见且 ≥3min 补一次 → 手动 `requestReadingCompanionSync()`
- **去重**：稳定 ID `${bookId}:bm_/rv_${源ID}`；createTime+text 比对；已讨论过的远端删除线**保留**（防档案失锚）；单书超 5000 条丢最旧未讨论
- **失败恢复**：401 → needsReauth=true 停止自动重试；其他失败 consecutiveFailures++；连续 ≥3 次退避 30min；失败不清旧数据
- **零模型**：全流程只有 /api/weread HTTP 请求与本地 Dexie 合并

## 9. 讨论引擎（reading-companion-engine.ts）

- **分层注入**（单次调用预算 ~2-4k token）：
  - L1 书元数据（书名/作者/章节/进度，~100）
  - L2 划线摘录（自上次讨论后新增 ≤20 条，每条截 120 字，~800-1500）
  - L3 角色档案（该角色此书的 opinions + discussionDigest，~300-600）
  - L4 会话历史 + L5 人设/记忆/世界书（复用 resolveReadingInput 全套装配）
- **正文永不注入**（同时是防捏造闸门二）
- **复用**：`resolveReadingInput`（全套 character/apiConfig/preset/worldBooks/memory/short-term 装配）+ `callReadingLLM` + `assemblePromptPayload`，零重复造轮子
- **追问**：靠消息历史延续，不重复注入（省 token）；chat-engine 全局共读状态宏注入列为 V2

## 10. 验证状态

- ✅ `tsc --noEmit` 全库 0 错误
- ✅ 无 Key 路径：dev server 实测 7 个 action 全部返回 `503 weread_unconfigured`，GET 返回 405
- ⏳ 有 Key 真实链路：**未验证**。需要配置 `WEREAD_API_KEY` 后实测字段裁剪对照、鉴权失效映射、参数校验、超时/限流
- ⏳ 真实讨论回复：未验证（依赖有 Key）

## 11. 部署与配置

**API Key 配置**（用户决定走平台环境变量，不走网页配置）：
- Vercel/Netlify 后台 → Settings → Environment Variables → 加 `WEREAD_API_KEY=wrk-xxx`
- 修改后需为对应环境触发一次新部署；Vercel 环境变量只会进入修改后创建的 Deployment，不应假设旧部署自动获得新值
- key 不入 git、不入代码、不入浏览器

**本地真跑**：项目根建 `.env.local`（gitignore 已忽略）加 `WEREAD_API_KEY=wrk-xxx`，`npm run dev`，curl `/api/weread`。

## 12. 待办（按优先级）

1. **配 Key 真跑验证**：字段裁剪对照、鉴权映射、参数校验、真实讨论回复
2. **书架选择页 UI**（界面3）：当前用文字"陪我读书 [书名]"选书，无可视化书架
3. **连接设置页**（界面2）：当前 key 走平台 env，无网页内配置入口（按用户决定不做网页配 key）
4. **档案页**（界面4）：查看 roleProfile 时间线 + 划线列表
5. **卡片按钮交互**：当前共读卡纯展示，无"聊聊/同步/结束"按钮（用户用文字触发）
6. **云备份登记**：`lib/data-management/modules.ts` 模块 7 加 roleProfiles（不可再生数据）+ KV 状态；shelfBooks/highlights/syncState 不备份（可再生，对齐陪听先例）
7. **chat-engine 共读状态宏注入**（V2）：让普通对话也能自然接梗
8. **角色主动搭话**（V2）：poll + 防抖，复用 follow-up 机制

## 13. 可直接发给新 GPT 的接手指令

将本文全文作为附件或上下文，并附上下面这段话即可：

> 你正在接手“微信读书共读”功能。本文是当前唯一可信的交接基线。先根据本文复述：产品体验、已经实现的模块、尚未验证的部分、安全红线、下一步最小任务；不要把“已写代码”误报为“已上线可用”。在没有项目文件时，可以直接完成方案审查、测试设计、部署清单、故障分析和后续任务拆分；需要修改代码时，再请求本文“完整文件清单”中与当前任务直接相关的最少文件。禁止要求重新扫描整个仓库，禁止重构无关功能，禁止改动账号、Supabase、网易云、既有云备份与部署配置。

### 无项目文件时也必须知道的当前结论

- 功能代码已存在于完整开发目录，但**未提交 Git、未部署、未用真实 WEREAD_API_KEY 跑通**。
- `tsc --noEmit` 通过只证明静态类型正确，不代表官方 API 字段、鉴权和真实讨论已经验收。
- 第一优先级不是继续加界面，而是配置 Key 后完成只读真实链路验证。
- 正式上线前必须确认密钥只存在于服务端环境变量，并触发新部署。
- 用户真实阅读发生在微信读书 App；本项目不造阅读器、不逐页 OCR、不读取整本正文。
- 定时同步不调用模型；只有用户主动讨论时才调用一次模型。

### 获得项目文件后的最小阅读顺序

**怎么读代码**：
1. 先读 `lib/weread-types.ts` 看裁剪后数据结构
2. 再读 `lib/server/weread-gateway.ts`（服务端网关）+ `lib/server/weread-projections.ts`（裁剪）
3. `app/api/weread/route.ts` 看分发
4. `lib/reading-companion-storage.ts` + `lib/reading-companion-library.ts` 看状态与去重
5. `lib/reading-companion-sync.ts` 看同步引擎
6. `lib/reading-companion-engine.ts` 看讨论编排（防捏造核心）
7. `lib/reading-companion-chat-handler.ts` 看聊天触发
8. `components/chat/message-bubble.tsx` 搜 `ReadingCompanionCardBubble` 看卡片
9. `components/chat/chat-room.tsx:3824` 附近看旁路

**参考的孪生先例**（陪听模式，读它就懂共读的模式）：
- `lib/music-companion-storage.ts`（83 行，KV 状态孪生模板）
- `lib/music-companion-library.ts`（Dexie 孪生模板）
- `lib/follow-up-service.ts`（后台服务挂载模式）
- `components/chat/message-bubble.tsx` 的 `MusicCompanionCardBubble`（卡片渲染孪生）

**红线**（不可碰）：
- 不改 Supabase 配置 / 网易云 / 账号系统 / 云备份既有配置 / 部署配置 / middleware
- API Key 永远只在服务端环境变量
- 不代理正文解密类端点
- 不存整本正文

**已知坑**：
- 官方 `/review/list/mine` 参数是小写 `bookid`，其他接口是 `bookId`（已在 route 区分）
- 官方 progress 是 0-100 整数，1=1% 不是 100%（已按文档处理）
- 官方有 `upgrade_info` 升级提示字段（已透传）
- `next dev` 会临时改 tsconfig 的 include，测完要恢复
- chat-room.tsx 6640 行是高危文件，改动严格最小化

---

*本文档基于 2026-09-01 实施状态。所有行号以当日代码为准。官方 API 信息来自 github.com/Tencent/WeChatReading v1.0.4 官方文档（README + SKILL.md + shelf.md + book.md + notes.md + search.md 实读）。*
