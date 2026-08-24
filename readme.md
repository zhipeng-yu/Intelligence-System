# 学校画像系统 2.0

面向公司内部培训老师的单校资料整理工具。老师无需注册即可查看八张学校画像卡片和上传资料；系统把 PDF、DOCX、XLSX 转成文本后交给 Doubao-Seed-2.0-lite，只更新资料明确提到且未被人工锁定的卡片。

生产地址：<https://ledu-school-archive.pages.dev>

> 仓库已完成 2.0 实现，但生产环境仍是旧资料库版本；尚未执行远端 D1 迁移或 Pages 部署。

## 产品边界

- 首页只有学校信息概览、极简上传、最近更新三个区域。
- 画像固定为学校概况、校历与作息、年级与班级概况、教材与当前教学进度、考试安排与范围、教学重点难点与常见失分、近期活动与通知、可用教学资源八张卡片。
- 完成度只计算有内容的卡片数，例如“已补全 5/8（63%）”；文件数不计分。
- 上传表单只有文件、可选备注和上传按钮。支持 PDF、DOCX、XLSX，单文件最大 50MB。
- 普通老师可查看画像、查看来源文件名和上传资料；管理链接另可编辑/解锁卡片、下载/删除原文件、重试失败的 AI 整理。
- 不包含 36 字段、权重、候选、确认状态、双确认、账号体系、多校、知识图谱、向量库或任务队列。

## 数据流

```text
文件 -> 私有 R2
     -> Workers AI toMarkdown
     -> 火山方舟 Responses API
     -> 白名单校验
     -> D1 八张卡片
```

AI 未提到的卡片保持原值，人工编辑后自动锁定。失败时保留原文件，只有管理员可以重试。公开上传使用 Turnstile，并按不可逆网络散列限制为每小时 5 份；不保存明文 IP。

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
- `functions/api/documents/`：上传、列表、私有下载、软删除与 AI 整理
- `functions/api/profile/`：八卡片读取、人工编辑与解锁
- `migrations/0002_create_profile_values.sql`：2.0 文档状态、八卡片与历史表
- `tests/api.test.mjs`、`tests/profile.test.mjs`：服务端闭环测试
- `school-profile-handoff.md`：2.0 技术交接与发布边界
- `artifacts/school-archive-desktop.png`：桌面端验收截图

代码仓库：<https://github.com/zhipeng-yu/Intelligence-System>
