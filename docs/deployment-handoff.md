# 小手机通用部署说明：给 WorkBuddy / 接手 AI

更新：2026-09-03。本文件只说明发布流程，不代表任何新功能已经上线。

## 1. 两个目录，不能搞错

- 完整开发目录：`C:\Users\Samsung\Documents\ChatGPT\爱意\参考项目\renwenaiyi`
- 独立发布仓库：`C:\Users\Samsung\Documents\ChatGPT\爱意\参考项目\renwenaiyi-git`
- GitHub：<https://github.com/Abigale-azad/renwenaiyi>，main。
- Vercel 项目：abigale-azad / renwenaiyi。
- 正式网址：<https://renwenaiyi.vercel.app/>。

完整目录没有自己的 .git 时，git 命令可能误操作祖先旧仓库。提交和推送必须显式在发布仓库执行，并核实 git rev-parse --show-toplevel 与 git remote -v。
根目录旧 index.html、旧安卓壳、Netlify 不是当前目标。不要删除或搬动这些文件。
此前人物成长提交 dd5c7be 已确认 Vercel 成功；这是历史基线，不是要求回退到该提交。每次必须核实最新远端状态。

## 2. 发布前的只读检查

```powershell
Set-Location -LiteralPath 'C:\Users\Samsung\Documents\ChatGPT\爱意\参考项目\renwenaiyi-git'
git rev-parse --show-toplevel
git remote -v
git status --short --branch
git log -3 --oneline
git sparse-checkout list
git fetch origin
git log --oneline HEAD..origin/main
```

有他人未提交内容就保留；远端领先时先确认整合方案，不能强推。工作区干净且可快进时再 git merge --ff-only origin/main；不能用 reset --hard 清理。
稀疏检出看不见文件不代表远端没有。需要文件时先 git ls-tree 核实，再按当前稀疏模式补充指定路径。部分克隆按需取文件会联网。

## 3. 同步代码与验证

先列出本次精确文件清单，逐个比较完整开发副本与发布仓库。大型聊天或工具文件可能夹带旧差异，必须只应用本次最小补丁，禁止整目录覆盖。
先审查差异再写入；如果意外引入无关内容，手动撤销自己引入的补丁，不恢复/覆盖用户原有修改。
检查源代码、测试、必要样式与文档都纳入，禁止加入 .env、Token、cookie、聊天备份、人设私卡、node_modules、.next。

在完整目录按 package.json 验证：

```powershell
Set-Location -LiteralPath 'C:\Users\Samsung\Documents\ChatGPT\爱意\参考项目\renwenaiyi'
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
npm run build
```

运行功能专项测试和手机窄屏回归。若发布副本与开发副本不完全相同，应在独立干净构建目录验证最终提交，或至少依赖 Vercel 验证实际提交并如实说明本地验证范围。
FlowUs 若需要服务端环境变量或数据库迁移，先列清名称、用途、所需权限和恢复方式，授权后实施；不要复用前端公开变量保存服务端密钥。不要改变已有登录、Supabase地址或网易云配置。

## 4. 提交与推送

在发布目录运行：

```powershell
git diff --stat
git diff --check
git diff
```

然后使用本次真实文件清单执行 git add --sparse，不使用 git add .。下列命令的路径占位必须替换，不可原样运行：

```text
git add --sparse <本次文件1> <本次文件2>
git diff --cached --stat
git diff --cached --check
git diff --cached
git commit -m "feat: integrate FlowUs workspace and tasks"
git push origin main
```

必须已获用户提交/发布授权；遇到沙箱写 .git 或联网限制，走批准流程，不规避权限。
本机曾有失效代理。只有确认该故障时可对单次命令禁用代理：

```powershell
git -c http.proxy= -c https.proxy= push origin main
```

不要改全局 Git 代理或用户网络服务。Git进程崩溃后先核实远端是否收到提交，不能盲目宣称失败或成功。

## 5. 等待真实部署结果

GitHub main 推送后由 Vercel 自动部署。必须查看本次精确SHA对应的状态，不拿上一版 Ready 冒充。
可在 Vercel 项目 Deployments 查看；或查询 GitHub 的 commit status：

```powershell
$releaseSha = git rev-parse HEAD
$releaseStatus = Invoke-RestMethod -Uri "https://api.github.com/repos/Abigale-azad/renwenaiyi/commits/$releaseSha/status"
$releaseStatus.statuses | Select-Object context,state,description,target_url | Format-List
```

pending/Building 就继续等；failure/Error 要看构建日志；success/Ready 后再验收正式域名。若API访问受限，用登录后的Vercel页面，不索要聊天里粘贴高权限Token。
不要因等待而制造无意义提交。适度等待，不高频轮询。

## 6. 正式站验收与回报

打开正式域名并刷新页面，核实新增入口、登录和关键功能。不要指导用户清除网站数据，以免删除本地聊天与配置。
FlowUs 测试写入用用户批准的测试页面，不能批量修改正式笔记。记录测试产生的记录及清理方式，未经授权不删除。
最终回报必须包含：提交SHA、部署状态、正式链接、功能具体入口、实际测过的内容和剩余限制。
仅提交/推送不是部署成功；构建成功不等于已完成手机端功能验收。遇阻如实报告卡在哪一步。

历史依据：global-three-line-lyrics-handoff.md 第7～8节。本文抽出了通用流程，不包含歌词专用的文件复制列表。
