# 学校画像系统 2.0

面向公司内部培训老师的单校资料整理工具。老师无需注册即可查看八张学校画像卡片、一张“其他产品资料”卡片并上传资料；系统把 PDF、DOCX、XLSX 转成文本后交给 Doubao-Seed-2.0-lite，将新资料与当前画像合并，只更新资料明确涉及且实际变化的卡片。

生产地址：<https://ledu-school-archive.pages.dev>

生产环境已于 2026-08-26 应用 `0003_add_linear_undo.sql`，并于 2026-08-28 部署源码提交 `ec9a231`，当前运行碎片累积、线性撤销、符合顺序的彻底删除和最小权限机器上传。生产已用无敏感信息的合成资料完成真实 Workers AI、方舟 Responses API、单步撤销及 R2/D1 硬删除闭环验收。

## 小红书公开笔记 7 天试运行

仓库包含一个本地试运行器 `automation/xhs_course_trial.py`：它复用锁定提交的 `xiaohongshu-skill`，但只启动本机系统 Edge，不下载 Chromium，不注入 stealth、指纹伪装或验证码绕过。它只监控固定公开主页 ID `565aa55cb8ce1a32c6fdebe7`，不持久化 `xsec_token`、分享参数、全文、图片、视频、评论或用户信息。

首次系统 Edge 登录、账号身份核验和最新 20 条 ID 基线已完成。运行器只把主页顶部到第一个已见 ID 之间的笔记视为新增，并记录全部新增笔记，不再按课程产品过滤；每条只保留原文标题、发布时间、固定来源账号、无临时参数的公开链接和 100–200 字确定性摘要。历史候选保留在 `held_candidates`，不会进入自动队列。任务仍按原周期运行至 2026-09-04，不补跑或延长失败日；运行状态、Edge profile、Conda 环境和 DPAPI 凭据位于 `%LOCALAPPDATA%\LeduSchoolArchive\xhs-course-trial`，不进入 Git。

每天最多把 10 条新增笔记合并为一个 PDF 并调用一次现有生产 AI；溢出顺延，没有新增则不上传、不调用 AI。正确 `INGEST_KEY` 上传会被标记为“其他产品资料”，分析工具和服务端返回校验都只允许更新第九卡，不能污染原八张学校画像；第九卡只展示合并后的最新 12 条，全部记录仍保留在每日 PDF 中。

## 产品边界

- 首页只有学校信息概览、极简上传、最近更新三个区域。
- 卡片固定为学校概况、校历与作息、年级与班级概况、教材与当前教学进度、考试安排与范围、教学重点难点与常见失分、近期活动与通知、可用教学资源、其他产品资料九张。
- 完成度只计算有内容的卡片数，例如“已补全 5/9（56%）”；文件数不计分。
- 上传表单只有文件、可选备注和上传按钮。支持 PDF、DOCX、XLSX，单文件最大 50MB。
- 普通老师可查看画像、卡片级参考资料和上传资料；管理链接另可下载原文件、重试失败的 AI 整理、撤销最近一次有效画像更新，并彻底删除失败、未生效或已撤销资料。
- 不包含 36 字段、权重、候选、确认状态、双确认、账号体系、多校、知识图谱、向量库或任务队列。

## 数据流

```text
文件 -> 私有 R2
     -> Workers AI toMarkdown
     -> 火山方舟 Responses API
     -> 白名单校验
     -> D1 九张卡片
```

AI 为受影响卡片返回完整新版短条目：保留不冲突旧项，以新资料替换冲突项、删除过时项并去重；未提到的卡片保持原值。每卡最多 12 条、总长不超过 4000 字；完全相同的结果不写历史或来源。失败时保留原文件，只有管理员可以重试。公开上传使用 Turnstile，并按不可逆网络散列限制为每小时 5 份；不保存明文 IP。

一次实际资料更新无论影响多少卡片都只形成一个撤销步骤。管理员只能从最新一步连续向前撤销，没有重做、分支或任意版本恢复；卡片内容、更新时间和来源会一起回退。有效栈中的资料不能直接删除，失败、未生效或已撤销资料可彻底删除 R2 对象和 D1 文件身份，匿名画像历史永久保留。

请勿上传学生名单、手机号、个人成绩明细、身份证信息或公司保密资料。任何密钥、管理链接和本地环境文件都不得进入 Git、聊天或普通文档。

## 本地验证

```powershell
npx.cmd wrangler d1 migrations apply ledu-school-archive --local --persist-to .wrangler/state
node --test tests/api.test.mjs
node --test tests/profile.test.mjs
%LOCALAPPDATA%\LeduSchoolArchive\xhs-course-trial\conda-env\python.exe -m unittest tests/test_xhs_course_trial.py
npx.cmd wrangler pages functions build
npx.cmd wrangler pages dev . --persist-to .wrangler/state
```

本地运行需要在被 Git 忽略的环境中提供 `ADMIN_KEY`、`INGEST_KEY`、`ARK_API_KEY`、`TURNSTILE_SECRET` 和公开的 `TURNSTILE_SITE_KEY`；Workers AI 通过 `wrangler.toml` 的 `AI` binding 提供。测试使用模拟响应，不会调用真实方舟。

## 主要文件

- `index.html`：单页原生前端
- `functions/_shared.js`：固定卡片、上传校验、鉴权、Turnstile 与限流辅助
- `functions/api/documents/`：上传、列表、私有下载、彻底删除与 AI 整理
- `functions/api/profile/`：九卡片读取、有效来源与全局线性撤销
- `migrations/0002_create_profile_values.sql`：2.0 文档状态、原八卡片与历史表
- `migrations/0003_add_linear_undo.sql`：复用历史表补充线性撤销身份与恢复时间
- `migrations/0004_add_other_products_section.sql`：无损扩展卡片约束并增加“其他产品资料”
- `tests/api.test.mjs`、`tests/profile.test.mjs`：服务端闭环测试
- `automation/xhs_course_trial.py`：系统 Edge 单账号 7 天试运行器
- `school-profile-handoff.md`：2.0 技术交接与发布边界
- `artifacts/school-archive-desktop.png`：桌面端验收截图

代码仓库：<https://github.com/zhipeng-yu/Intelligence-System>
