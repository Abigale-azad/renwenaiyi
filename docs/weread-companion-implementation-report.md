# 微信读书接口层 + 共读会话层 · 实施与验证报告

> 实施日期：2026-09-01
> 官方 API 依据：Tencent/WeChatReading v1.0.4（github.com/Tencent/WeChatReading）
> 未提交 Git。未改动 Supabase / 网易云 / 账号系统 / 云备份配置 / middleware。

---

## 一、官方 API 核实结论

| 项 | 官方事实（来自仓库源码） |
|---|---|
| 仓库 | github.com/Tencent/WeChatReading（腾讯官方，2026-07 v1.0.4） |
| 统一网关 | `POST https://i.weread.qq.com/api/agent/gateway` |
| 鉴权 | `Authorization: Bearer $WEREAD_API_KEY`，格式 `wrk-xxx`，从 weread.qq.com/r/weread-skills 获取 |
| 请求体 | JSON：`{api_name, skill_version:"1.0.4", 业务参数平铺}` |
| 错误约定 | `errcode` 非 0 报错；`upgrade_info` 字段提示升级 |
| 7 个所需能力 | 全部官方支持（端点见下表） |

**规格书修正**：V1.0 规格书曾写"微信读书无官方 API，需自建逆向代理"——已被官方 Agent API 推翻，架构简化为服务端环境变量存 Key，无需用户部署代理。

---

## 二、新增 / 修改文件清单

### 新增（10 个）

| 文件 | 职责 | 行数 |
|---|---|---|
| lib/weread-types.ts | 接口层共享类型（前端/服务端共用，裁剪后结构） | 108 |
| lib/server/weread-gateway.ts | 服务端网关客户端：Bearer 鉴权、15s 超时、errcode 映射、api_name 白名单 | 137 |
| lib/server/weread-projections.ts | 字段白名单裁剪：7 个接口的剥离逻辑 | 178 |
| app/api/weread/route.ts | POST 单入口 action 分发，runtime=nodejs | 119 |
| lib/weread-client.ts | 前端瘦客户端：只调本服务 /api/weread | 88 |
| lib/reading-companion-types.ts | 共读领域类型 | 110 |
| lib/reading-companion-storage.ts | KV 会话状态 + 事件常量（孪生 music-companion-storage） | 73 |
| lib/reading-companion-library.ts | Dexie 库：去重合并 + 角色档案 | 234 |
| lib/reading-companion-sync.ts | 增量同步引擎：定时/可见/退避 | 173 |

### 修改（3 处，最小化）

| 文件 | 改动 |
|---|---|
| .env.example | +5 行 WEREAD_API_KEY 说明 |
| components/desktop-shell.tsx | +1 import + start/stop 各 1 行（挂载同步服务） |
| tsconfig.json | 无（dev 期间被 next 临时改的 include 已恢复） |

---

## 三、数据结构

### 服务端 → 浏览器（裁剪后，无账号标识）

| 类型 | 来源端点 | 关键字段 |
|---|---|---|
| WereadShelfBook | /shelf/sync | bookId, title, author, cover, deepLink, readUpdateTime, finishReading |
| WereadSearchItem | /store/search | bookId, title, author, cover, intro(≤200), newRating |
| WereadBookInfo | /book/info | title, author, translator, cover, intro(≤500), category, wordCount, newRating |
| WereadChapter | /book/chapterinfo | chapterUid, chapterIdx, title, wordCount, level |
| WereadProgress | /book/getprogress | chapterUid, progress(0-100整数), updateTime, recordReadingTime |
| WereadBookmark | /book/bookmarklist | bookmarkId, chapterUid, markText(≤500), createTime |
| WereadReviewItem | /review/list/mine | reviewId, content(≤1000), abstract(≤500), chapterUid, createTime |

**剥离的字段**：vid/userVid、secret（隐私）、isbn、price/paid/payType（付费）、他人公开数据（热门划线/公开点评）。

### 客户端持久化

```
KV: ai_phone_reading_companion_v1  （会话状态，孪生 music-companion-storage）
ReadingCompanionState {
  active, sessionId, characterId,        // 角色×书×会话三隔离
  book: { bookId, title, author?, coverUrl?, deepLink? },
  startedAt, lastSyncAt,
  status: "idle"|"syncing"|"ready"|"error",
  lastSynced: { chapterUid?, chapterTitle?, progress?, updatedAt? },
  syncError?, needsReauth?, retryAt?
}

Dexie: AiPhoneReadingCompanionDB
├─ shelfBooks    "bookId, updatedAt"                 书架缓存（可再生）
├─ highlights    "id, bookId, [bookId+kind], createTime, updatedAt"
│   { id=`${bookId}:bm_/rv_${源ID}`, text≤500/1000, createTime, discussedAt? }
├─ roleProfiles  "key, characterId, bookId"          角色观点（不可再生 ★云备份边界）
│   { opinions≤50, discussionDigest≤600, focusQuestions≤30 }
└─ syncState     "bookId"  { lastSyncAt, consecutiveFailures, chapterTitles? }
```

---

## 四、存储键名总表

| Key | 类型 | 位置 | 备份 |
|---|---|---|---|
| `WEREAD_API_KEY` | env | 服务端环境变量 | 严禁（不入代码/存储/日志/回包） |
| `ai_phone_reading_companion_v1` | kv-db | IndexedDB AiPhoneKvDB | 待接入（已设计为可备份） |
| `AiPhoneReadingCompanionDB` | Dexie | IndexedDB（独立库） | roleProfiles 待接入；shelfBooks/highlights/syncState 不备份（可再生，对齐陪听先例） |

---

## 五、去重逻辑

- **稳定 ID**：`${bookId}:bm_${官方bookmarkId}` / `${bookId}:rv_${官方reviewId}`（前缀防 bookmarkId 与 reviewId 撞车，bookId 防跨书撞车）
- **比对规则**（mergeHighlights，reading-companion-library.ts:75）：
  - 本地无 → 新增（stats.added）
  - 本地有且 `createTime` 或 `text` 或 `abstract` 变化 → 更新，**保留 discussedAt**（stats.updated）
  - 本地有且全相同 → 跳过（stats.unchanged）
  - 本地有但本次回包无 → 远端已删：**已讨论过的保留**（讨论档案锚点不丢锚），未讨论的删除
- **异常防御**：单书划线超 5000 条丢最旧的未讨论条目（正常一本书远低于此）
- 服务端裁剪后原始回包永不落库

---

## 六、同步频率

| 触发 | 间隔 | 条件 |
|---|---|---|
| 启动首同步 | 30 秒后 | 错开应用启动高峰 |
| 定时 | 每 10 分钟 | active 共读存在 && !needsReauth && 超过 retryAt |
| 可见性恢复 | ≥3 分钟未同步 | visibilitychange → visible |
| 手动 | 即时 | requestReadingCompanionSync()（绕过 10min 节流，仍受 needsReauth/并发锁约束） |

后端 tick 每 60 秒检查一次（bg-timer 60s），按条件触发。**全程零模型调用**。

---

## 七、失败恢复

| 场景 | 处理 |
|---|---|
| 鉴权失效（HTTP 401/403 或 message 命中鉴权词） | state.needsReauth=true，status=error，**停止自动重试**；外部 clearReadingCompanionReauth() 后恢复 |
| 其他同步失败 | consecutiveFailures++，status=error，syncError 记录；下个周期重试 |
| 连续失败 ≥3 次 | 退避 retryAt = now + 30min（期间不重试） |
| 部分请求失败 | 整轮算失败（不合并，避免去重误删已删线） |
| 失败不清旧数据 | 保留上次成功的本地数据，UI 仍可展示 |

---

## 八、TypeScript 检查结果

```
$ npx tsc --noEmit
（无输出，退出码 0）
```

**全库 0 错误**（含本项目既有代码 + 本次 9 个新文件 + 3 处改动）。

---

## 九、接口验证结果（无 WEREAD_API_KEY 路径）

dev server 起于 localhost:3001，环境 `NEXT_PUBLIC_SELF_HOSTED_MODE=true`（middleware 放行，未碰账号系统）。

| action | 请求 | HTTP | 响应体 |
|---|---|---|---|
| shelf | POST {action:"shelf"} | **503** | `{"ok":false,"error":{"code":"weread_unconfigured","message":"服务端未配置 WEREAD_API_KEY..."}}` |
| search | POST {action:"search",keyword:"三体"} | **503** | 同上 |
| bookInfo | POST {action:"bookInfo",bookId:"x"} | **503** | 同上 |
| chapters | POST {action:"chapters",bookId:"x"} | **503** | 同上 |
| progress | POST {action:"progress",bookId:"x"} | **503** | 同上 |
| bookmarks | POST {action:"bookmarks",bookId:"x"} | **503** | 同上 |
| reviews | POST {action:"reviews",bookId:"x"} | **503** | 同上 |
| GET 方法 | GET /api/weread | **405** | Next 自动拒绝（route 仅导出 POST） |
| 非 POST 参数（前置于 key 检查的未触发） | — | — | 无 key 时 key 检查先返回，参数校验需配 key 后验证 |

### 需你配 Key 后才能验证的部分

无 Key 路径下前置检查先返回，无法验证以下（已设计但未实测）：
1. 参数校验（缺 bookId → 400 weread_bad_request）
2. 字段裁剪正确性（需官方真实回包对照）
3. 鉴权失效映射（weread_unauthorized）
4. 超时/网络/限流映射

**建议你做的事**：在 Vercel/Netlify 环境变量加 `WEREAD_API_KEY=wrk-你的key`，部署后逐个实测，对照官方字段说明验证裁剪是否漏字段或多字段。或本地起 dev 时 `WEREAD_API_KEY=wrk-xxx npm run dev` 实测。

---

## 十、安全边界复核

- ✅ WEREAD_API_KEY 只在 `lib/server/weread-gateway.ts:67` 通过 `process.env` 读取
- ✅ Authorization 头由服务端构造，不进入任何客户端代码
- ✅ 7 个 api_name 白名单（WEREAD_ALLOWED_API_NAMES），正文解密类端点天然拒绝
- ✅ 字段裁剪层剥离 vid/secret/isbn/付费/他人数据
- ✅ 错误日志只记 code + message，不记请求头与完整请求体（route.ts:112）
- ✅ 不依赖账号系统（middleware 全局拦截已足够；单机模式天然放行）

---

## 十一、未做（V1 共读层后续）

- 聊天界面（共读状态卡、书架选择页、设置页）——本批未做，按你"只实现接口层和共读会话，不做聊天界面"的要求
- 模型讨论（generateCompanionDiscussion + 防捏造 prompt + 档案更新）——本批未做
- chat-room.tsx 关键词旁路——本批未做
- modules.ts 云备份登记——本批未做（roleProfiles 类型已设计为可备份格式，待接入）

接口层 + 共读数据层 + 同步引擎已就绪，可支撑后续聊天界面与讨论层直接消费。
