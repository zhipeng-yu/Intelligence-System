# 学校资料库运维交接

更新日期：2026-08-31

## 当前状态

- 生产地址：<https://ledu-school-archive.pages.dev>
- Pages 项目：`ledu-school-archive`
- D1：`ledu-school-archive`（`1ba7ee18-968d-4598-aad4-8f667454563e`）
- 私有 R2 bucket：`ledu-school-archive`
- 生产部署短标识：`35577459`，源码提交 `538f8c6`
- 远端 D1 已应用到 `0004_add_other_products_section.sql`，复核无待执行迁移；生产画像为九张卡片
- Pages 已部署碎片累积、线性撤销和符合顺序的彻底删除
- 生产真实 AI、单步撤销及合成资料 R2/D1 硬删除闭环已完成；当前保留原有 1 份资料和本次小红书历史演示资料，均无悬空画像引用
- 已配置 Secret：`ADMIN_KEY`、`INGEST_KEY`、`ARK_API_KEY`、`TURNSTILE_SECRET`、`TURNSTILE_SITE_KEY`
- 本地已完成小红书固定公开账号的系统 Edge 登录、身份核验和 20 条 ID 基线；基线后全部新增笔记都会记录，旧课程过滤已删除
- 1 条旧规则产生的历史候选完整保留在 `held_candidates` 且不进入自动队列。任务 `Ledu-Xiaohongshu-Course-Trial` 为 Ready，上次 8 月 31 日 09:00 成功，下一次 9 月 1 日 09:00，仍于 9 月 4 日结束；当前已用 1/7 次 AI、0 条待上传、无活动批次且未停机

管理密钥和管理链接只保存在被 Git 忽略的本地文件或 Cloudflare Secret 中，不得写入仓库、聊天、日志、截图或普通文档。

## 2.0 运行结构

- 单个原生 `index.html`
- Cloudflare Pages Functions
- D1：文档元数据、八张学校画像卡片、一张“其他产品资料”卡片、隐藏历史
- 私有 R2：原文件，使用随机对象键
- Workers AI `AI` binding：`toMarkdown`
- 火山方舟 Responses API：`doubao-seed-2-0-lite-260215`
- Turnstile：公开上传校验

`0001_create_documents.sql` 是旧基线，不能重写；生产已依次应用 `0002_create_profile_values.sql` 和 `0003_add_linear_undo.sql`。`0004_add_other_products_section.sql` 只重建 `profile_sections` 的 key 约束、保留原八行并增加第九行，不新增表。旧文档的文件与核心元数据已迁移保留，现有画像状态已补出可连续撤销的线性起点。

## 新源码权限与安全边界

- 公开：查看画像、完成度、来源文件名、最近更新、上传资料、触发每份文件唯一一次的自动整理。
- 管理链接：下载原文件、重试失败整理、撤销最近一次有效画像更新，以及彻底删除失败、未生效或已撤销资料。
- 公开上传必须通过 Turnstile；同一网络散列每小时最多 5 份。
- 机器上传仅在 `POST /api/documents` 接受独立 `X-Ingest-Key`；正确密钥只绕过 Turnstile，仍执行来源散列限流和文件扩展名、MIME、文件头、50MB 校验，且不获得任何管理权限。机器资料被固定标记为“其他产品资料”。
- 服务端继续校验扩展名、MIME、文件头和 50MB 上限。
- 原文件不公开，下载强制附件并设置 `nosniff`；有效更新必须先按顺序撤销，彻底删除同时移除 R2 对象和 D1 文件身份，画像历史匿名保留。
- 普通资料的 AI 工具和返回解析只允许原八个 section key；小红书机器资料两层都只允许 `other_products`，不能改动原八卡。每卡仍限制为 1–12 个非空条目、去重和 4000 字；资料正文被视为不可信数据。
- 普通资料使用当前八张学校画像与新资料生成受影响卡片的完整新版；小红书资料合并第九卡并只保留最新 12 条。相同结果不写历史、来源或撤销步骤。人工编辑与锁定运行时逻辑已删除。
- 不保存明文 IP，不安装方舟 SDK，不使用知识库、向量库、队列或额外服务层。

## 发布前配置

Cloudflare 生产环境需要：

- Secret：`ADMIN_KEY`
- Secret：`INGEST_KEY`
- Secret：`ARK_API_KEY`
- Secret：`TURNSTILE_SECRET`
- Secret：`TURNSTILE_SITE_KEY`（值本身可公开，当前按 Secret 管理）
- Workers AI binding：`AI`
- 已有 D1 `DB` 与私有 R2 `BUCKET` bindings

发布前应在安全终端中配置或核对这些值，不得把值放进命令历史以外的可见输出。

## 后续发布顺序

下一次生产变更仍需逐次获得明确授权：

1. 再次只读核对本地 `main` 与 `origin/main`。
2. 安全核对 Secret/变量和 Workers AI binding。
3. 仅在迁移列表确有待执行项时应用远端 D1 迁移。
4. 部署 Pages。
5. 用无密钥与管理链接分别做生产冒烟验证；使用无敏感信息的小文件，避免真实学校资料触发首次 AI 验收。

```powershell
npx.cmd wrangler d1 migrations apply ledu-school-archive --remote
npx.cmd wrangler pages deploy . --project-name ledu-school-archive --branch main
```

禁止强推。认证失败、冲突或远端出现未知提交时立即停止。

## 已完成的验证

- `node --test tests/api.test.mjs`：8 项通过，覆盖正确/错误 `INGEST_KEY`、机器资料标记和公开 Turnstile 不回退
- `node --test tests/profile.test.mjs`：9 项通过，覆盖第九卡隔离、拒绝污染原八卡和线性撤销
- Conda Python 3.12 环境运行 `tests/test_xhs_course_trial.py`：9 项通过，覆盖全部新增笔记记录和确定性摘要
- 全新临时本地 D1 顺序应用 `0001`、`0002`、`0003`、`0004`；结果恰好 9 行
- 带模拟旧卡的临时库执行 `0004` 后，旧内容、来源、更新时间和锁定值均原样保留
- 本地已有状态回填验证：`A → B` 被正确补成两个可连续撤销步骤，并保留前一更新时间
- Pages Functions 构建
- 小红书运行器锁定已安装技能的关键源码摘要，仅调用系统 Edge；未安装 Playwright Chromium，Edge 适配不注入 stealth、指纹、User-Agent 或验证码绕过脚本
- 固定账号身份核验和最新 20 条 ID 基线通过；本地状态确认未上传、未调用 AI，且未保存分享查询参数
- 新增判定改为只取主页顶部至第一个已见 ID 的连续前缀；找不到基线锚点即停止，避免把更老笔记当新增
- Python 默认客户端的生产无文件探针复现 Cloudflare 403；加入透明 `Ledu-XHS-Course-Trial/1.0` 标识后到达现有 `INGEST_KEY` 与“请选择要上传的文件”校验，未创建文档、未调用 AI
- 上传/AI 的 HTTP 状态和受控错误会写入不含秘密的 `halt_detail`，失败任务返回非零；上传前失败恢复会把历史候选移入 `held_candidates` 并保留全部允许字段
- 生产 D1 已应用 `0004` 且无待执行迁移；源码提交 `538f8c6` 已部署为 `35577459`。公开画像返回 200 和九张卡片，完成度分母为 9
- 历史演示笔记“学而思大阅读 阅写双提升”经系统 Edge 核验后完成机器上传和 1 次生产 AI；文档为 `completed`、作用域仅“其他产品资料”，原八卡校验值未变，旧历史候选仍为 1 条
- 任务计划核对为 Ready，`StartWhenAvailable=True`、`MultipleInstances=IgnoreNew`、单次上限 1 小时，七日时间边界正确
- 模拟 D1/R2/方舟响应的上传、私有下载、碎片合并、同值跳过、多卡整体撤销、A/B/C 线性顺序、失败重试、撤销后禁止重试、硬删除与匿名历史测试
- 新源码已用系统 Edge 验收 9 卡桌面布局、390px 单列、键盘焦点和控制台错误；控制台无错误，桌面截图已更新
- 本地 Pages API 闭环返回 9 卡；错误机器密钥为 400，正确密钥为 201 且只标记“其他产品资料”
- 2026-08-26 经用户明确授权应用远端 `0003`，复核无待执行迁移；2026-08-28 从干净的 `main` 部署源码提交 `b370af8`，并由 Edge 确认生产按钮文案为“撤销”
- 生产 Edge 公开/管理冒烟通过：八张卡片、完成度 1/8、原有 1 份已完成资料、公开上传和管理操作入口均符合权限边界，控制台无错误
- 无敏感信息的合成 PDF 真实调用 Workers AI 与方舟 Responses API，完成状态成功且只生成 1 个画像撤销步骤
- 生产线性撤销恢复到原画像 1/8；随后按顺序硬删除该合成资料，Edge 显示删除成功，D1 确认目标为 0、原有资料为 1，历史变更、历史来源和当前来源均无悬空引用
- 当前 Wrangler OAuth 账户上下文的直接 `wrangler r2` 管理请求返回 R2 `10042`；生产 `BUCKET` binding 与应用内硬删除均正常。若以后必须直接操作 R2 CLI，应先核对 Cloudflare 账户上下文和 R2 启用状态

浏览器验收结果与当前发布边界见 `school-profile-handoff.md`。

## 发布边界

- 本次小红书试运行已完成 `INGEST_KEY` 配置、七日任务计划、`0004` 生产迁移、Pages 部署及一次历史演示 AI；七日内最多 7 次真实生产 AI 仍由本地配额控制，当前已用 1 次。
- 未授权生产硬删除、超出试运行的生产 AI 调用或规避平台验证；其他生产动作仍须明确授权。
