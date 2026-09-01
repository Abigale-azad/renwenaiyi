# 微信读书共读 · 产品规格书 V1.0

> 状态：待确认（未动任何代码）
> 埍制基础：陪听模式链路 + 既有 reading 模块实测分析（2026-09-01）
> 本文档是施工规格，所有"落点"均指真实文件与行号，禁止另起一套重复架构。

---

## 0. 一句话定位

用户在微信读书 App 里读书，爱意只做三件事：**同步痕迹（零模型）、安静陪伴（零打扰）、点名才聊（单次模型）**。它是"陪听模式"的异构孪生：陪听 = 后台编排内容流；共读 = 后台同步行为流。

### 0.1 与陪听模式的同构对照

| 维度 | 陪听 | 共读 |
|---|---|---|
| 内容源 | 网易云"我喜欢的音乐" | 微信读书书架 + 划线 + 进度 |
| 用户在哪消费 | 本应用内播放器 | **微信读书 App（外部）** |
| 触发语 | 陪我听歌 | 陪我读书 / 一起读书 / 共读 |
| 旁路方式 | 正则命中 → 不调主模型 | 同左，同一处代码 |
| 后台编排 | 两阶段 LLM 选歌 | 零模型同步 + 单次讨论 |
| 实时事件 | 切歌事件（推） | 无推送，靠同步（拉） |
| 预生成反应 | plans 缓存 7 天 | 不需要（无实时事件） |
| 卡片 | music_companion_card | reading_companion_card |
| 恢复规则 | 24h 内续播 | 长期恢复（读书是持续行为） |
| 角色记忆 | roleMemories 影响下次选歌 | RoleReadingProfile 持久观点档案 |

---

## 1. 核心场景与产品原则

### 1.1 主剧本

1. 用户在微信读书 App 读《百年孤独》到第 5 章，划了 3 条线。
2. 回到爱意，在"凝凝"的聊天里说"陪我读书"。
3. 聊天里落一张共读状态卡；首次使用则先走 连接设置 → 书架选择。
4. 系统增量同步：进度、新划线入库（全程零模型、零弹窗）。
5. 用户继续去微信读书读，回来点状态卡"同步"，数字更新，无消息打扰。
6. 用户说"聊聊刚才看的"或点卡片"聊聊" → **一次**模型调用 → 角色基于划线 + 自己的人设/记忆自由联想。
7. 角色观点沉淀进档案（按 角色×书 隔离），下次讨论作为上下文注入。
8. 用户说"先不读了" → 结束本次共读，档案留存；下次说"陪我读书"直接恢复。

### 1.2 产品原则（不可妥协项）

- **P1 零成本安静**：同步、开始、恢复、划线入库全部零模型调用；无用户指令不产生任何聊天气泡。
- **P2 单次讨论**：一次"聊聊" = 一次模型调用；追问走正常对话流，靠消息历史延续，不重复注入。
- **P3 防捏造**：角色只能引用「划线原文」标注为原文；其余输出必须以联想口吻呈现；禁止编造具体引文、页码、情节。
- **P4 角色隔离**：观点档案以 (characterId, bookId) 为主键，凝凝和方承意对同一本书的观点互不可见。
- **P5 不存正文**：不落任何章节正文、不解析微信读书内容文件；只存书籍元数据、用户划线/想法、讨论摘要、角色观点。
- **P6 凭据本地化**：微信读书凭据仅存本地，不进云备份、不打印日志、不上传。
- **P7 复用优先**：所有新模块必须能在陪听链路里找到同构先例；找不到先例才允许新建。

---

## 2. 界面规格（5 个）

### 界面 1：聊天内"共读状态卡"（核心 UI）

**形态**：一条 `mediaType: "reading_companion_card"` 的 assistant 消息（对偶 music_companion_card），去边框卡片样式（复用 chat-room.tsx:263 STANDALONE_CARD_BUBBLE_STYLE）。

**结构**（自上而下）：
```
┌────────────────────────────────────┐
│ [书封48px]  百年孤独                │
│            加西亚·马尔克斯           │
│            ▓▓▓▓▓▓░░░░ 42% · 第5章  │
├────────────────────────────────────┤
│ 本次共读：同步于 5 分钟前            │
│ 新划线 3 条 · 已聊过 2 次           │
├────────────────────────────────────┤
│ [ 聊聊刚才看的 ]  [同步] [档案] [⋯]  │
├────────────────────────────────────┤
│ 状态行（仅异常时显示，如凭据过期）    │
└────────────────────────────────────┘
```

- 书封取微信读书 CDN 封面 URL，失败时用首字色块兜底。
- "聊聊"为主按钮；点击等价于发送"聊聊刚才看的"。
- "⋯"弹出：换书 / 结束共读。
- 状态行三种异常态：`凭据已过期 [重新授权]` / `同步失败 [重试]` / `接口不可达`。
- 卡片是"活"的：每次同步成功后更新对应消息的 mediaData（复用 chat-storage 的消息更新机制，同 chat-plugin 的 message.updated 事件路径）。

**卡片更新而非新发**：一次共读会话内只有一张卡，避免刷屏（与陪听不同——陪听每轮一张新卡，因为内容流每轮全新）。

### 界面 2：微信读书连接设置

**位置**：设置 → 应用/数据分区新增入口；首次触发共读且未配置时自动弹出。

**内容**：
- API 服务地址输入框（自建 weread 兼容代理的 base URL，模式与网易云 `NEXT_PUBLIC_DEFAULT_NETEASE_API_BASE` 完全一致）
- 凭据输入（粘贴 cookie / 登录凭据，密码框样式）
- 「如何获取」折叠说明：图文步骤（部署代理 → 微信读书网页版抓 cookie → 粘贴）
- 「测试连接」按钮：调一次书架接口 → 成功显示书架前 3 本书名
- 状态徽章：`未配置` / `已连接（3 天前验证）` / `已过期`
- 隐私说明文案：凭据仅存本设备，不上云、不同步、不展示

### 界面 3：书架选择页

**形态**：全屏页（移动优先），从聊天弹出。

**内容**：
- 顶部搜索框（书名/作者过滤，纯前端）
- 书架列表：封面 + 书名 + 作者 + 进度% + 最近阅读时间倒序
- 已有共读档案的书显示角色头像角标（表示"凝凝读过"）
- 每本书右侧：`开始共读` / `继续共读`（有档案时）
- 底部提示条：只读数据，共读不会向微信读书写入任何内容

**交互**：选中 → 卡片式确认（书名 + 角色 + 该角色已有档案预览一句话）→ 回聊天落状态卡。

### 界面 4：每本书的共读档案

**入口**：状态卡「档案」按钮 / 书架选择页的档案角标。

**内容**：
- 顶部书信息 + 整体进度时间线
- **角色 tab**（核心隔离展示）：每个与这本书共读过的角色一个 tab
  - 角色观点时间线：每次讨论沉淀的观点条目（摘要 + 所依据的划线引用）
  - 该角色的讨论摘要（滚动更新的 ≤600 字 digest）
- 「我的划线」区：按章节分组，显示用户划线原文 + 该角色是否评论过
- 操作：删除某条讨论记录（连带观点条目）

**V1 不做**：编辑观点、跨书聚合、导出。

### 界面 5：同步状态与错误提示

**三层提示体系**：
1. **卡片状态行**（常驻异常）：凭据过期 / 同步失败 / 接口不可达 + 对应动作按钮
2. **聊天 toast**（瞬时）：同步成功"新增 3 条划线"、已最新"没有新的阅读痕迹"
3. **设置页同步日志**：最近 10 次同步记录（时间 / 结果 / 新增划线数 / 错误码），用于排查

**错误分类与用户话术**：
| 错误 | 检测 | 话术 | 动作 |
|---|---|---|---|
| 未配置 | 无 apiBase/凭据 | "还没有连接微信读书" | 引导设置 |
| 凭据过期 | 代理返回 401/403 | "微信读书登录已过期" | 重新授权（直达设置） |
| 接口不可达 | 网络错误/超时 | "连接不上同步服务" | 重试 / 检查地址 |
| 空书架 | 书架接口返回空 | "微信读书书架是空的" | 引导去微信读书加书 |
| 无新数据 | cursor 无增量 | （静默）"没有新的阅读痕迹" | 无 |

---

## 3. 完整流程定义

### 3.1 开始流程

```
用户："凝凝陪我读书"（任意聊天会话内）
  ↓
chat-room.tsx:3824 附近新增正则分支（与陪听同函数、同模式）
  匹配 /陪我(?:一起)?读(?:书)|一起读(?:书)?|共读/ 且非否定式
  ↓
setPendingGenerate(false)  ← 主模型 0 次，同陪听
  ↓
读 ReadingCompanionState（KV）分派：
  a) 未配置连接 → push 引导卡片（mediaType 同款卡片，status: "unconfigured"）
  b) 已配置 + 无进行中共读 → 打开书架选择页（或发书架卡片）
  c) 已配置 + 本会话有进行中共读 → 更新卡片 + 后台增量同步（零模型）
  d) 已配置 + 共读在别的会话 → toast："正在和小X共读《…》，先结束那边？"
```

**角色路由规则（V1）**：在当前会话触发，角色 = 当前会话角色。消息里点名了别的角色（如"方承意陪我读书"但当前是凝凝会话）→ toast 引导切换，不自动跳会话。

### 3.2 同步流程（全程零模型）

```
触发源（三选一）：状态卡「同步」按钮 / 「聊聊」前自动 / 进入共读会话时节流触发（≥10min）
  ↓
weread-service（浏览器直连用户自建代理，同网易云模式）：
  1. GET 书架 → 更新 ShelfBook 缓存
  2. GET 当前书的进度 → 对比上次
  3. GET 划线列表（增量：按上次同步 cursor）
  ↓
Dexie 入库：新划线 → HighlightItem（markText 超 500 字截断）
  ↓
更新 ReadingCompanionState：lastSyncAt / lastSynced / pendingHighlights++
  ↓
更新状态卡消息的 mediaData → UI 刷新
  ↓
（无消息气泡、无模型、无通知）
```

**节流与降级**：同一书 10 分钟内重复触发直接读缓存；同步失败不清已有数据，仅置 error。

### 3.3 讨论流程（唯一调模型处）

```
触发："聊聊刚才看的" / "聊聊" / 卡片按钮
  ↓
关键词旁路（不走主对话流的普通装配）
  ↓
自动增量同步（先拿最新划线，零模型）
  ↓
分层注入（见 §5 token 策略）：
  书籍元数据 + 新划线摘录 + 该角色这本书的档案（观点+摘要）+ 会话历史
  ↓
🔴 单次 LLM 调用（appTags: ["reading","companion_discuss"]）
  prompt 核心约束（防捏造三道闸之一）：
  - 只能将【划线摘录】区块内的文字称为"你划过的原文"
  - 对书的任何其他感受必须以"我联想到/我觉得"开头
  - 禁止声称书中"写了什么"具体内容、页码、情节
  - 结尾附加结构化块：<reading_profile>{"opinion":"一句话观点","basedOn":[划线id]}</reading_profile>
  ↓
回复落库（正常 assistant 消息，进会话历史）
  ↓
解析结构化块（复用 parsePlannerJson 容错模式）：
  成功 → 追加 RoleReadingProfile.opinions + 滚动更新 discussionDigest
  失败 → 静默跳过（降级：档案不更新，不影响聊天）
  ↓
卡片更新：discussionCount++ / pendingHighlights 清零
```

**追问不再注入**：用户接着聊 → 走正常对话流，上下文靠已落库的讨论消息延续（与陪听"卡片消息进历史"同理）。chat-engine 级的共读状态宏注入列为 V2（陪听同样没做，见 §8）。

### 3.4 结束流程

```
用户："先不读了" / "结束共读" / 卡片「⋯」→ 结束
  ↓
（旁路，零模型）
ReadingCompanionState 清空 active → 卡片更新为终态样式（保留最后统计）
档案（RoleReadingProfile / 划线 / 摘要）全部留存
  ↓
下次"陪我读书"：
  同书同角色 → 直接恢复（无 24h 限制，读书是长期行为）
  同书换角色 → 新建该角色的档案，互不污染
```

### 3.5 重新授权流程

```
任意同步遇到 401/403
  ↓
State.needsReauth = true → 卡片状态行立即显示「凭据已过期 [重新授权]」
  ↓
点击 → 直达连接设置页（凭据输入框聚焦）
  ↓
测试连接成功 → needsReauth 清除 → 自动触发一次增量同步 → 卡片恢复
  ↓
（期间聊天功能完全不受影响，共读只是降级）
```

---

## 4. 数据结构

### 4.1 KV 存储（kv-db，key 规范对齐 `ai_phone_*_v1`）

```ts
// key: ai_phone_weread_config_v1 —— 连接配置（凭据不进云备份）
type WereadConfig = {
  apiBase: string;                  // 自建代理地址
  credential: string;               // 凭据（仅本地）
  lastVerifiedAt?: number;
  status: "unconfigured" | "ok" | "expired";
};

// key: ai_phone_reading_companion_v1 —— 会话状态（孪生 music-companion-storage）
type ReadingCompanionState = {
  active: boolean;
  sessionId: string;
  characterId: string;
  bookId: string;                   // 微信读书 bookId
  startedAt: number;
  status: "selecting" | "syncing" | "reading" | "discussing" | "error" | "unconfigured";
  lastSyncAt?: number;
  lastSynced?: { chapterTitle?: string; progress?: number };
  pendingHighlights?: number;       // 未讨论过的新划线数
  discussionCount: number;
  cardMessageId?: string;           // 状态卡消息 id（更新用）
  error?: string;
  needsReauth?: boolean;
};

// 事件常量（对偶 music-companion-storage.ts:4-6）
READING_COMPANION_REQUEST_EVENT = "reading-companion-requested"
READING_COMPANION_SYNC_EVENT    = "reading-companion-sync"
```

### 4.2 Dexie：`AiPhoneReadingCompanionDB`（孪生 music-companion-library）

```ts
// 表结构（schema 声明）
shelfBooks:   "bookId, updatedAt"                    // 书架缓存（可再生）
highlights:   "id, bookId, [bookId+chapterUid], createTime"  // 划线（可再生）
roleProfiles: "key, characterId, bookId, updatedAt"  // 角色观点档案（不可再生 ★要备份）
syncState:    "bookId"                                // 同步游标

type ShelfBook = {
  bookId: string; title: string; author?: string;
  coverUrl?: string; progress?: number; finished?: boolean;
  lastReadAt?: number; updatedAt: number;
};

type HighlightItem = {
  id: string;                 // 微信读书划线 id
  bookId: string;
  chapterUid: number; chapterTitle: string;
  markText: string;           // >500 字截断
  noteText?: string;          // 用户想法
  createTime: number;
  discussedAt?: number;       // 被讨论过的时间
};

type RoleReadingProfile = {   // ★ 不可再生，必须进云备份
  key: string;                // `${characterId}:${bookId}`
  characterId: string;
  bookId: string; bookTitle: string;
  opinions: Array<{
    summary: string;                 // ≤100 字观点
    basedOnHighlightIds: string[];   // 依据的划线
    createdAt: number;
  }>;
  discussionDigest?: string;  // 滚动摘要 ≤600 字
  updatedAt: number;
};
```

### 4.3 聊天卡片 mediaData（mediaType: `"reading_companion_card"`）

```ts
// chat-storage.ts mediaData 联合新增字段（对偶 musicCompanion*，:181-189 旁）
{
  readingCompanionBook?: {
    bookId: string; title: string; author?: string;
    coverUrl?: string; progress?: number; chapterTitle?: string;
  };
  readingCompanionStats?: {
    lastSyncAt: number; newHighlights: number; discussionCount: number;
  };
  readingCompanionStatus?: "reading" | "error" | "ended" | "unconfigured";
}
```

**渲染登记四处**（漏一处卡片就不刷新/样式错，全部对齐 music_companion_card 的先例）：
1. `chat-storage.ts` mediaType 联合类型 + `MEDIA_PREVIEW_MAP`（:294 旁，预览文案"[共读]"）
2. `message-bubble.tsx` case 分派（:114 旁）+ 局部卡片组件 + **memo 比较函数同步新增字段**（:151-153 教训）
3. `chat-room.tsx` `CHAT_VISUAL_MEDIA_TYPES`（:197）+ `CHAT_MEDIA_BUBBLE_TYPES`（:246）
4. `chat-room.tsx` 气泡样式分支（:5936 旁加 reading_companion_card 进去边框名单）

### 4.4 云备份登记

`lib/data-management/modules.ts`（单一事实源，L19-312）：

| 数据 | 归属 | 进备份 | 理由 |
|---|---|---|---|
| roleProfiles（角色档案） | apps 模块新增 Dexie source | ✅ 必须 | 模型生成，不可再生 |
| `ai_phone_reading_companion_v1` | apps 模块新增 KV key | ✅ | 会话状态轻量 |
| highlights（划线缓存） | — | ❌ | 可从微信读书重同步（同陪听曲库先例：AiPhoneMusicCompanionDB 不备份） |
| shelfBooks | — | ❌ | 可再生 |
| `ai_phone_weread_config_v1` | — | ❌ **不备份** | 凭据安全（P6）。与 netease cookie 备份先例**故意不一致**，微信读书凭据=完整账号权限，风险等级不同 |

---

## 5. Token 节省策略

### 5.1 调用矩阵（全功能一次盘点）

| 动作 | 模型调用 | 说明 |
|---|---|---|
| 配置/测试连接 | 0 | 纯 HTTP |
| 开始/恢复共读 | 0 | 卡片模板文案，不调模型（角色开场白列为 V2 可选轻量调用） |
| 书架拉取/选书 | 0 | 纯 HTTP |
| 增量同步（任意次） | 0 | 纯 HTTP + 本地入库 |
| 阅读期间 | 0 | 无事件推送，天然安静 |
| 「聊聊」（每次） | **1** | 分层注入单次调用 |
| 追问/多轮 | 0 额外 | 复用正常对话流，历史自带上下文 |
| 档案更新 | 0 | 用讨论输出内嵌的结构化块，不追加调用 |
| 结束/换书 | 0 | 纯状态操作 |

**结论：除"聊聊"外全程零模型，一次典型共读会话（开始+5 次同步+2 次讨论+结束）= 2 次模型调用。**

### 5.2 讨论时的分层注入（单次调用的输入预算）

| 层 | 内容 | 预算 |
|---|---|---|
| L1 书籍元数据 | 书名/作者/当前章节/进度 | ~100 token |
| L2 划线摘录 | 自上次讨论以来的新划线（每条截 120 字，按章分组，≤20 条；超限取最近） | ~800-1500 |
| L3 角色档案 | 该角色此书的 opinions 摘录 + discussionDigest | ~300-600 |
| L4 会话历史 | 复用 short-term-assembler 既有裁剪 | 既有机制 |
| L5 人设/记忆 | 复用 reading-engine 的 resolveReadingInput（角色卡、世界书、既有记忆全套） | 既有机制 |

- **正文永不注入**（P5，同时是防捏造闸门二：模型没见过的东西物理上引不准）。
- L2 没有新划线时降级注入 L3 + "这次没有新划线，聊聊进度/感受"。
- 讨论摘要滚动更新（新摘要 = 旧摘要 + 本次结论，超 600 字截前保后）。

### 5.3 防捏造三道闸

1. **Prompt 硬约束**（§3.3）：只有划线区块可称"原文"；其余必须联想口吻；禁具体页码/情节。
2. **物理隔离**：不注入正文，模型对未划线内容只有书名级常识。
3. **结构化落档**：观点与引文分离存储（opinions.basedOnHighlightIds 指向真实划线），档案页展示时引文永远来自本地划线库，不来自模型输出。

---

## 6. 与陪听模式的共用清单（禁止重复造）

### 6.1 直接共用（零新架构）

| 共用资产 | 位置 | 共用方式 |
|---|---|---|
| 关键词旁路骨架 | chat-room.tsx:3824-3858 | 同一 commitSendText 内新增正则块，模式照抄 |
| `setPendingGenerate(false)` 机制 | chat-room.tsx:3858 | 原样复用 |
| window 事件总线模式 | music-companion-storage.ts:5 | 新常量，同 dispatch/listen 模式 |
| KV 状态存储模式 | music-companion-storage.ts 全文（83 行） | 孪生新文件，同结构 |
| 后台服务挂载 | follow-up-service.ts:102-105（startFollowUpService） | 加 listener + stop 对称清理 |
| Dexie 孪生模式 | music-companion-library.ts | 孪生新库 |
| 卡片全链登记 | chat-storage / message-bubble / chat-room 四处 | 照抄 music_companion_card 先例 |
| 假消息指令注入 | follow-up-service.ts:147-149 plannerInstruction | 同模式（讨论时挂分层上下文） |
| JSON 容错解析 | follow-up-service.ts:139-145 parsePlannerJson | 直接 import 复用（需 export，一行改动） |
| prompt 装配 | reading-engine.ts resolveReadingInput | 复用（需 export，当前为私有） |
| LLM 调用封装 | api-helpers.ts 全套 | 直接复用 |
| 云备份清单 | data-management/modules.ts 模块 7 | 增量登记（§4.4） |
| 去边框卡片样式 | chat-room.tsx:263 | 原样复用 |

### 6.2 明确不共用（共读特有）

- plans 预生成反应机制（无实时事件，无意义）
- 24h 续播规则（换成长期恢复）
- music-control-bridge（本项目没有播放器要桥接；微信读书在外部 App）
- 两阶段 LLM 编排（共读无"选内容"环节，一阶段即终）
- 网易云 API 层（换 weread-service，但**连接配置模式完全对偶**：用户自填代理地址 + 浏览器直连，这是网易云已验证的最稳路径）

---

## 7. 新增文件清单（最小集）

| 文件 | 职责 | 孪生先例 |
|---|---|---|
| `lib/reading-companion-storage.ts` | 状态 KV + 事件常量 | music-companion-storage.ts |
| `lib/weread-service.ts` | 微信读书 API 封装（书架/进度/划线） | music-service.ts |
| `lib/reading-companion-library.ts` | Dexie：书架缓存/划线/角色档案 | music-companion-library.ts |
| `lib/reading-companion-engine.ts` | 讨论编排：分层注入 + 防捏造 prompt + 档案解析 | reading-engine.ts + follow-up-service.ts 的合体模式 |
| `components/reading/reading-companion-shelf.tsx` | 书架选择页 | music-app 控制台模式 |
| `components/settings/` 内连接设置区块 | weread 连接设置 | 网易云设置区 |
| `components/reading/reading-companion-profile.tsx` | 档案页 | — |

**改动既有文件清单（严格最小化）**：
| 文件 | 改动 | 行数预算 |
|---|---|---|
| chat-room.tsx | 正则分支 + 三处类型常量登记 + 气泡样式 + 「+」菜单项 | ~40 行 |
| message-bubble.tsx | case + 卡片组件 + memo 字段 | ~90 行 |
| chat-storage.ts | mediaType 联合 + mediaData 字段 + 预览文案 | ~10 行 |
| follow-up-service.ts | 事件监听挂载/卸载 | ~15 行 |
| reading-engine.ts | export resolveReadingInput | 1 行 |
| follow-up-service.ts | export parsePlannerJson（或挪到 utils） | 1 行 |
| data-management/modules.ts | 备份登记 | ~6 行 |

---

## 8. V1 MVP 边界

### V1 做（全部）
- 单用户、单角色、单本进行中的书
- 连接设置（自建代理 + 凭据）+ 测试 + 重授权闭环
- 书架选择（拉取/搜索/选择/继续）
- 增量同步（划线/进度/想法）+ 节流 + 同步日志
- 共读状态卡（更新式单卡）
- 「聊聊」单次模型讨论 + 分层注入 + 防捏造
- 角色×书的观点档案 + 滚动摘要 + 档案页
- 档案 + 会话状态进云备份
- 结束/恢复/换书/换角色

### V1 不做（明确出界）
- ❌ 安卓端 / OCR / 读屏
- ❌ 正文存储与解析（永远不会，P5）
- ❌ 实时进度推送（微信读书无回调，技术上只能拉）
- ❌ 多人共读 / 群聊共读
- ❌ 自动定时后台同步（V1 只有手动 + 事件触发；定时器列为 V2，可挂 follow-up-service 的 poll 循环）
- ❌ 角色主动搭话（"你昨天读到XX怎么不聊了"——依赖 V2 的 poll + 主动消息）
- ❌ chat-engine 全局共读状态宏（让普通对话知道"在共读中"；陪听也没做，先验证需求）
- ❌ 角色开场白生成（开始时零模型）
- ❌ 跨书口味推荐、书内搜索、想法回写微信读书
- ❌ 微信读书官方 API 依赖（不存在官方 API，见 §10 风险）

### V2 候选（按价值排序）
1. 共读状态宏注入 chat-engine（普通对话也能自然接梗）
2. 角色主动搭话（poll + 防抖，复用 follow-up 机制）
3. 定时后台同步
4. 角色开场白与书摘点评（轻量模型）
5. 跨书阅读口味档案（聚合所有 RoleReadingProfile）

---

## 9. 施工顺序（6 个里程碑，每个可独立验收）

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| **M1 数据地基** | weread-service + companion-storage + Dexie 库 + modules.ts 备份登记 | 手动测试函数可拉书架/划线并落库；备份文件包含新档案 |
| **M2 聊天链路** | chat-room 正则旁路 + 事件 + 卡片四处登记 + 占位卡片 | 说"陪我读书"不调主模型、落占位卡；所有既有聊天回归正常 |
| **M3 同步闭环** | follow-up-service 挂载 + 书架选择页 + 增量同步 + 卡片活更新 | 选书→同步→卡片数字变化，全程零模型、零气泡 |
| **M4 讨论** | companion-engine：分层注入 + 防捏造 prompt + 结构化档案 | 点"聊聊"→ 1 次模型 → 回复落库 → 档案生成；无新划线可降级讨论 |
| **M5 设置与档案** | 连接设置页 + 档案页 + 错误/重授权闭环 + 同步日志 | 凭据过期→卡片提示→重授权→自动恢复同步 |
| **M6 打磨** | token 统计核对、降级路径演练、备份恢复演练 | 恢复备份后档案完整；断网/过期/空书架全路径无死锁 |

**施工红线**：
- chat-room.tsx（6640 行）与 chat-storage.ts（91KB）是高危文件，改动只允许 §7 清单范围，每步跑全量回归
- 不动：账号/Supabase/网易云/云备份既有配置/部署配置（用户红线）
- 每个里程碑合入前用「陪听模式」做对照回归（同构链路，一处坏两处坏）

---

## 10. 风险点与对策

| # | 风险 | 等级 | 对策 |
|---|---|---|---|
| 1 | **微信读书无官方 API**，依赖自建逆向代理（社区 weread-api 类项目），接口随时可能改版 | 🔴 高 | 连接层做协议适配器隔离（weread-service 单文件收口）；接口变更只改一个文件；设置页给"接口版本"提示 |
| 2 | 凭据 = 完整微信读书账号权限，泄露风险高 | 🔴 高 | P6：仅本地、不备份、不日志；输入框密码态；文档明示风险 |
| 3 | cookie 有效期短（天级），重授权频繁伤害体验 | 🟠 中 | 重授权一键化（卡片直达 + 聚焦输入 + 成功自动同步）；同步成功时顺带刷新凭据时效 |
| 4 | 模型捏造"书中原文" | 🟠 中 | 三道闸（§5.3）；档案页引文只从本地划线库渲染 |
| 5 | CORS：微信读书接口不允许浏览器直连 | 🟠 中 | 已由"自建代理"架构天然解决（同网易云路径） |
| 6 | 划线量大（重度用户数千条）撑爆注入 | 🟡 低 | 只注入"上次讨论后新增"，≤20 条截断；全量只在档案页分页展示 |
| 7 | follow-up-service 继续膨胀 | 🟡 低 | 共读逻辑全部放 companion-engine，service 只加事件转发（~15 行） |
| 8 | 合规：抓取行为是否违反微信读书条款 | 🟡 低 | 只读用户自己产生的数据；不爬正文不爬他人；速率限制（同步节流）；隐私说明写明"自担风险" |

---

## 11. 待用户确认的 6 个决策点

1. **数据接入路径**：确认走"用户自建 weread 代理 + 粘贴凭据"模式？（无官方 API，这是唯一可行路径，但部署代理对普通用户有门槛）
2. **凭据不进云备份**：接受换设备需重新粘贴凭据？（换来的是安全）
3. **状态卡"更新式单卡"**：接受一次共读只有一张卡（区别于陪听每轮一张）？
4. **角色路由**：V1 不做跨会话自动跳转，点名别角色时 toast 引导，OK？
5. **"聊聊"后追问不重新注入**：接受靠消息历史延续（省 token），还是 V1 就要 chat-engine 宏注入（多改一个高危文件）？
6. **MVP 范围**：§8 的做/不做清单是否认可？特别是"角色主动搭话"押后到 V2。

---

*本文档基于 2026-09-01 对 renwenaiyi 代码库的实测分析：陪听链路（chat-room/message-bubble/follow-up-service/tool-executor）、reading 模块（reading-types/engine/storage/viewer，已有 companionCharacterId 与伴读面板）、云备份（data-management/modules.ts DATA_MODULES 清单）、后端接口（app/api 40 路由 + 环境变量盘点）。所有行号以当日代码为准。*
