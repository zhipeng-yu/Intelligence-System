# 乐读内部资料库

面向少量内部用户的单校资料与小红书公开资料工具。源码保持一个原生 `index.html`、Cloudflare Pages Functions、D1 和既有私有 R2；没有前端框架、第三方队列、新服务或新增 AI。

生产地址：<https://ledu-school-archive.pages.dev>

“小规模多用户网络资料 MVP”已部署到生产：Pages 源码提交为 `aed9c23`，远端 D1 已应用到 `0005_add_network_materials.sql`，所需 Secret 已配置。真实只读 Edge 检索已验收；新工作器计划任务已注册并完成首次自动运行，旧七日任务已禁用。

## 登录与权限

- 用户输入管理员预先加入白名单的中国大陆 11 位手机号，并通过 Turnstile 登录；没有密码、短信、自助注册或自助注销。
- D1 只保存手机号 HMAC、末四位、备注和启用状态。会话令牌只以 SHA-256 保存，浏览器使用 12 小时 `Secure`、`HttpOnly`、`SameSite=Strict`、`Path=/` Cookie，不使用 localStorage。
- 所有用户 API 从会话确定用户身份，不接受客户端 `user_id`。禁用用户立即清除其会话，但保留网络资料。
- 白名单管理同时要求有效用户会话和现有 `ADMIN_KEY`；原下载、重试、撤销和彻底删除管理操作也保持双重要求。

这是内部小规模弱认证：知道某个白名单手机号的人可以冒用该身份，产品已接受此边界。

## 学校资料

- 登录后共享原有八张学校画像卡片。
- 原第九张“其他产品资料”、历史演示、原文件和数据库记录原样保留，但不出现在学校画像、资料列表或可撤销范围中。
- 普通上传仍支持 PDF、DOCX、XLSX，单文件最大 50MB；Turnstile、同一网络散列每小时 5 份、扩展名/MIME/文件头校验和每文件一次自动整理均保留。
- 学校资料继续使用 Workers AI `toMarkdown` 与方舟 Responses API；线性撤销、私有 R2、随机对象键、强制附件下载和彻底删除规则没有放宽。
- `INGEST_KEY` 仍只能在现有 `POST /api/documents` 绕过 Turnstile，不能获得管理权限。

## 网络资料

- 每人最多保存 3 个 24 位十六进制小红书账号 ID；不接受昵称或链接。
- 每次输入 1～2 个关键词并选择近 1、3 或 7 日。标题与公开文案规范化后必须同时包含全部关键词。
- 一个全局串行工作器按账号读取主页，每账号最多检查最近 20 条图文；先按主页发布时间排除窗口外内容，再打开详情，主页和详情阶段都排除视频，不下载媒体。
- 每次最多保存 30 条，按发布时间倒序展示账号名、发布日期、标题、干净公开链接和 100～200 字确定性摘要。
- 不保存完整文案、媒体、评论、用户资料或临时 token，也不调用 AI。
- 每人每天最多 3 次，全站每天最多 20 次，每人最多一个活动任务；日期按 Asia/Shanghai 计算，检索窗口固定在任务创建时刻。
- 保留每人最近 10 个已结束任务。用户只能查看和删除自己的账号、任务及结果；删除任务级联删除结果。
- 单账号失败标记 `partial` 并保留其他结果。验证码、登录失效或安全验证会标记 `blocked`、停止后续认领并等待人工显式恢复。

## 本机工作器

`automation/network_worker.py` 复用既有 Conda 环境和锁定提交 `afa96802d3e61cdd5e7bd7b37ec59182bbe07d37` 对应的 `xiaohongshu-skill`，只启动 Windows 系统 Edge；不使用 Chrome、下载版 Chromium、stealth、指纹伪装或验证码绕过。

工作器使用独立 `NETWORK_WORKER_KEY`。已注册的任务计划程序每分钟启动一次，每次只认领一个任务，并使用 `MultipleInstances IgnoreNew`。认领采用 30 分钟租约和一次性 claim token，过期可重新认领，相同回传幂等。

新任务首次自动触发后成功处理 2 个账号的队列任务，状态为 `completed`，无账号失败或安全验证，未命中结果。旧七日任务已禁用但未删除；旧 `seen.json`、运行状态和 `held_candidates` 保持原样。

## 数据与接口

`0005_add_network_materials.sql` 只新增 `users`、`sessions`、`watched_accounts`、`network_search_jobs`、`network_search_results`。任务状态固定为 `queued`、`running`、`completed`、`partial`、`blocked`、`failed`。

新增接口仅包括认证、管理员白名单、关注账号、检索任务以及工作器认领/回传，代码位于 `functions/api/auth/`、`functions/api/admin/` 和 `functions/api/network/`。

本地运行需在 Git 忽略的环境中提供 `ADMIN_KEY`、`INGEST_KEY`、`ARK_API_KEY`、`PHONE_PEPPER`、`NETWORK_WORKER_KEY`、`TURNSTILE_SECRET` 和公开的 `TURNSTILE_SITE_KEY`；不得记录这些值。

## 验证

```powershell
node --test tests/api.test.mjs
node --test tests/profile.test.mjs
node --test tests/network.test.mjs
%LOCALAPPDATA%\LeduSchoolArchive\xhs-course-trial\conda-env\python.exe -m unittest tests/test_xhs_course_trial.py
%LOCALAPPDATA%\LeduSchoolArchive\xhs-course-trial\conda-env\python.exe -m unittest tests/test_network_worker.py
npx.cmd wrangler d1 migrations apply ledu-school-archive --local --persist-to .wrangler/state
npx.cmd wrangler pages functions build
```

测试使用模拟响应，不访问真实小红书或调用真实 AI。桌面系统 Edge、390px、键盘焦点、主流程和控制台错误已验收，截图见 `artifacts/school-archive-desktop.png`。

代码仓库：<https://github.com/zhipeng-yu/Intelligence-System>
