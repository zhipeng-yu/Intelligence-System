# 乐读内部资料库

面向少量内部用户的单校资料与小红书公开资料工具。源码保持一个原生 `index.html`、Cloudflare Pages Functions、D1 和既有私有 R2；没有前端框架、第三方队列、新服务或新增 AI。

生产地址：<https://ledu-school-archive.pages.dev>

“小规模多用户网络资料 MVP”与访问预算优化均已部署到生产：Pages 部署 `1693b189` 使用源码提交 `4ea51be`，远端 D1 已应用到 `0006_add_network_budget_metrics.sql`，所需 Secret 已配置。真实只读 Edge 检索已验收；新工作器为每分钟 `IgnoreNew` 且状态 `Ready`，旧七日任务保持禁用。

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
- 一个全局串行工作器先汇总每账号最多 20 条主页候选，排除视频、窗口外内容、无效 ID 和缺少当前会话临时参数的候选，再跨账号去重并按标题关键词命中数、发布时间安排详情顺序。标题未命中只后移，不直接排除。
- 每次最多保存 30 条，按发布时间倒序展示账号名、发布日期、标题、干净公开链接和 100～200 字确定性摘要。
- 不保存完整文案、媒体、评论、用户资料或临时 token，也不调用 AI。
- 每人每天最多 3 次，全站每天最多 20 次，每人最多一个活动任务；日期按 Asia/Shanghai 计算，检索窗口固定在任务创建时刻。工作器按实际认领日共享 `180` 次详情预算，认领前按账号数 × 20 原子预留，结束后收敛为实际打开数。
- 保留每人最近 10 个已结束任务。用户只能查看和删除自己的账号、任务及结果；删除任务级联删除结果。
- 单账号失败标记 `partial` 并保留其他结果。验证码、登录失效或安全验证会标记 `blocked`、停止后续认领并等待人工显式恢复。

## 本机工作器

`automation/network_worker.py` 复用既有 Conda 环境和锁定提交 `afa96802d3e61cdd5e7bd7b37ec59182bbe07d37` 对应的 `xiaohongshu-skill`，只启动 Windows 系统 Edge；不使用 Chrome、下载版 Chromium、stealth、指纹伪装或验证码绕过。

工作器使用独立 `NETWORK_WORKER_KEY`。服务端保证全局最多一个运行任务；认领采用 50 分钟租约和一次性 claim token，工作器在 40 分钟后不再开始新的详情访问。过期任务直接结束为 `lease_expired`，不再自动从头重跑；相同回传仍幂等。

新任务首次自动触发后成功处理 2 个账号的队列任务，状态为 `completed`，无账号失败或安全验证，未命中结果。访问预算优化上线后，工作器首次空闲轮询返回 0，本地与 D1 均未停机。旧七日任务已禁用但未删除；旧 `seen.json`、运行状态和 `held_candidates` 保持原样。

验证码、登录失效或安全验证会同时写入 D1 全局停机状态和本地停机状态；只有人工 `repair-login` 成功后才显式恢复。页面显示每个结束任务的主页候选、初筛剩余、详情打开、关键词检查、命中和停止原因，并显示今日实际、预留与剩余额度；统计不完整的过期任务保留完整预留且明确标注。为避免删除任务抹掉当天预算，已占用当日预算的任务次日才允许删除。

## 数据与接口

`0005_add_network_materials.sql` 新增 `users`、`sessions`、`watched_accounts`、`network_search_jobs`、`network_search_results`。`0006_add_network_budget_metrics.sql` 为任务表增加预算日、预留额度、漏斗计数、停止原因和计数完整性，并增加单行全局停机控制表；不保存正文、媒体、评论、用户资料或临时 token。任务状态仍固定为 `queued`、`running`、`completed`、`partial`、`blocked`、`failed`。

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

测试使用模拟响应，不访问真实小红书或调用真实 AI。GPT 内置浏览器已完成登录后主流程、1280px 桌面、390px、键盘焦点、主导航和控制台验收；生产登录页也已在 1280px 与 390px 验收，无水平溢出且控制台无错误。截图见 `artifacts/school-archive-desktop.png`。

代码仓库：<https://github.com/zhipeng-yu/Intelligence-System>
