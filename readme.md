# 学校画像系统 2.0

面向公司内部培训老师的单校资料整理工具。老师无需注册即可查看八张学校画像卡片和上传资料；系统把 PDF、DOCX、XLSX 转成文本后交给 Doubao-Seed-2.0-lite，将新资料与当前画像合并，只更新资料明确涉及且实际变化的卡片。

生产地址：<https://ledu-school-archive.pages.dev>

生产环境已于 2026-08-25 完成学校画像 2.0 与真实方舟整理链路验收，目前仍停留在 `0002` 和旧页面。仓库源码已实现碎片累积、线性撤销和彻底删除，远端 `0003` 迁移与新版本部署尚未获授权。

## 产品边界

- 首页只有学校信息概览、极简上传、最近更新三个区域。
- 画像固定为学校概况、校历与作息、年级与班级概况、教材与当前教学进度、考试安排与范围、教学重点难点与常见失分、近期活动与通知、可用教学资源八张卡片。
- 完成度只计算有内容的卡片数，例如“已补全 5/8（63%）”；文件数不计分。
- 上传表单只有文件、可选备注和上传按钮。支持 PDF、DOCX、XLSX，单文件最大 50MB。
- 普通老师可查看画像、卡片级参考资料和上传资料；管理链接另可下载原文件、重试失败的 AI 整理、撤销最近一次有效画像更新，并彻底删除失败、未生效或已撤销资料。
- 不包含 36 字段、权重、候选、确认状态、双确认、账号体系、多校、知识图谱、向量库或任务队列。

## 数据流

```text
文件 -> 私有 R2
     -> Workers AI toMarkdown
     -> 火山方舟 Responses API
     -> 白名单校验
     -> D1 八张卡片
```

AI 为受影响卡片返回完整新版短条目：保留不冲突旧项，以新资料替换冲突项、删除过时项并去重；未提到的卡片保持原值。每卡最多 12 条、总长不超过 4000 字；完全相同的结果不写历史或来源。失败时保留原文件，只有管理员可以重试。公开上传使用 Turnstile，并按不可逆网络散列限制为每小时 5 份；不保存明文 IP。

一次实际资料更新无论影响多少卡片都只形成一个撤销步骤。管理员只能从最新一步连续向前撤销，没有重做、分支或任意版本恢复；卡片内容、更新时间和来源会一起回退。有效栈中的资料不能直接删除，失败、未生效或已撤销资料可彻底删除 R2 对象和 D1 文件身份，匿名画像历史永久保留。

请勿上传学生名单、手机号、个人成绩明细、身份证信息或公司保密资料。任何密钥、管理链接和本地环境文件都不得进入 Git、聊天或普通文档。

## 本地验证

```powershell
npx.cmd wrangler d1 migrations apply ledu-school-archive --local --persist-to .wrangler/state
node --test tests/api.test.mjs
node --test tests/profile.test.mjs
npx.cmd wrangler pages functions build
npx.cmd wrangler pages dev . --persist-to .wrangler/state
```

本地运行需要在被 Git 忽略的环境中提供 `ADMIN_KEY`、`ARK_API_KEY`、`TURNSTILE_SECRET` 和公开的 `TURNSTILE_SITE_KEY`；Workers AI 通过 `wrangler.toml` 的 `AI` binding 提供。测试使用模拟响应，不会调用真实方舟。

## 主要文件

- `index.html`：单页原生前端
- `functions/_shared.js`：固定卡片、上传校验、鉴权、Turnstile 与限流辅助
- `functions/api/documents/`：上传、列表、私有下载、彻底删除与 AI 整理
- `functions/api/profile/`：八卡片读取、有效来源与全局线性撤销
- `migrations/0002_create_profile_values.sql`：2.0 文档状态、八卡片与历史表
- `migrations/0003_add_linear_undo.sql`：复用历史表补充线性撤销身份与恢复时间
- `tests/api.test.mjs`、`tests/profile.test.mjs`：服务端闭环测试
- `school-profile-handoff.md`：2.0 技术交接与发布边界
- `artifacts/school-archive-desktop.png`：桌面端验收截图

代码仓库：<https://github.com/zhipeng-yu/Intelligence-System>
