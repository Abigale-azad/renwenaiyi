# 人物成长与信息边界：本地首版

已按用户要求同步至发布仓库，发布目标为 GitHub main → Vercel。实际上线状态以该提交的 Vercel 部署结果为准。不要操作根目录旧安卓壳，不要清空任何聊天或备份。

## 用户入口

人物 → 打开已保存的人物卡 → 成长与信息边界。
四页：当前成长、待你确认、成长轨迹、信息边界。
候选可查看来源、编辑、与当前文本对比、确认替换、否决。恢复版本也创建新快照，旧内容保留。

## 数据与迁移

- 新 KV：`ai_phone_character_growth_v1`，按 characterId 分区。
- 已纳入 `lib/data-management/modules.ts` 的“角色卡与素材”备份范围。
- 旧 description 为 `auto-personality-growth:<id>` 的世界书保留原数据；打开成长页或运行总结时复制成待确认候选，stable ID 防重复。
- 世界书列表隐藏旧成长簿；编辑普通世界书时保留隐藏的原始成长簿。
- 旧成长簿无论怎样绑定，都从 resolveBinding 和单聊/群聊 prompt 组装路径排除。
- 只将当前角色唯一 approved 成长附加到单聊人物描述；群聊不注入私人成长。
- 自动总结仍沿用原有记忆总结触发器，但只生成候选。未审候选达到3份时暂停新请求。
- 核心人物卡、聊天消息、既有长期记忆均不修改。

## 信息边界

tool-executor 在执行内置跨聊天组合工具前校验当前 characterId 权限，缺角色或配置异常都拒绝。
阻止联系人、会话预览、完整历史、人物简报四个内置查询。页面可明确二次确认开放持续授权，随时撤销。
此方案不是任意用户安装 JS/MCP/REST 工具的安全沙箱。恶意或主动读取全库的第三方插件仍需单独审计。
已有的串台消息/长期记忆不会被自动删除；它们可能继续影响回复，需用户核对来源后定点修复。
“另一个角色提到重置”只能提示可能的知识串台，未取得当时请求及工具日志，不能认定具体来源。

## 检验

运行 `node scripts/test-character-growth.cjs`：测试使用独立内存KV，不访问用户数据库。
运行 `node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false`。
手机UI和真实API生成尚需验收：A/B各生成候选，A采用后检查B提示词不可见；尝试未授权查聊天，应拒绝；反复打开迁移不重复；导出恢复后确认人物成长存在。

## 修改文件

- lib/character-growth-storage.ts（新）
- lib/character-privacy-policy.ts（新）
- lib/personality-growth.ts
- lib/settings-storage.ts
- lib/llm-prompt-assembler.ts
- lib/tool-executor.ts
- lib/data-management/modules.ts
- components/character/character-growth-panel.tsx（新）
- components/phone-character-app.tsx
- components/settings/worldbook-manager.tsx
- scripts/test-character-growth.cjs（新）

后续同步到 renwenaiyi-git 时需逐文件检查该副本与当前 Git HEAD 的差异，不能把完整目录无审查覆盖到稀疏检出仓库。经用户确认后再提交部署。
