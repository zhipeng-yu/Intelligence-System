# 学校资料库运维交接

更新日期：2026-08-25

## 当前状态

- 生产地址：<https://ledu-school-archive.pages.dev>
- Pages 项目：`ledu-school-archive`
- D1：`ledu-school-archive`（`1ba7ee18-968d-4598-aad4-8f667454563e`）
- 私有 R2 bucket：`ledu-school-archive`
- 生产部署：`6c46fc27-02b2-4b65-b268-2ebc1206fdad`，源码提交 `17bdc41`
- 远端 D1 已应用 `0002_create_profile_values.sql`
- Pages 已部署学校画像 2.0
- 已配置 Secret：`ADMIN_KEY`、`ARK_API_KEY`、`TURNSTILE_SECRET`、`TURNSTILE_SITE_KEY`

管理密钥和管理链接只保存在被 Git 忽略的本地文件或 Cloudflare Secret 中，不得写入仓库、聊天、日志、截图或普通文档。

## 2.0 运行结构

- 单个原生 `index.html`
- Cloudflare Pages Functions
- D1：文档元数据、八张画像卡片、隐藏历史
- 私有 R2：原文件，使用随机对象键
- Workers AI `AI` binding：`toMarkdown`
- 火山方舟 Responses API：`doubao-seed-2-0-lite-260215`
- Turnstile：公开上传校验

`0001_create_documents.sql` 是旧基线，不能重写；生产已应用 `0002_create_profile_values.sql`，旧文档的文件与核心元数据已迁移保留，并创建八卡片及历史表。

## 权限与安全边界

- 公开：查看画像、完成度、来源文件名、最近更新、上传资料、触发每份文件唯一一次的自动整理。
- 管理链接：人工编辑并锁定卡片、解锁、下载原文件、软删除、重试失败整理。
- 公开上传必须通过 Turnstile；同一网络散列每小时最多 5 份。
- 服务端继续校验扩展名、MIME、文件头和 50MB 上限。
- 原文件不公开，下载强制附件并设置 `nosniff`；删除只软删除 D1 记录。
- AI 输出必须经过八个 section key 白名单、去重和 4000 字长度校验；资料正文被视为不可信数据，不能改变系统指令。
- 不保存明文 IP，不安装方舟 SDK，不使用知识库、向量库、队列或额外服务层。

## 发布前配置

Cloudflare 生产环境需要：

- Secret：`ADMIN_KEY`
- Secret：`ARK_API_KEY`
- Secret：`TURNSTILE_SECRET`
- Secret：`TURNSTILE_SITE_KEY`（值本身可公开，当前按 Secret 管理）
- Workers AI binding：`AI`
- 已有 D1 `DB` 与私有 R2 `BUCKET` bindings

发布前应在安全终端中配置或核对这些值，不得把值放进命令历史以外的可见输出。

## 发布顺序

后续生产发布仍需逐次获得明确授权：

1. 再次只读核对本地 `main` 与 `origin/main`。
2. 安全核对 Secret/变量和 Workers AI binding。
3. 如有待执行项，先应用远端 D1 迁移。
4. 部署 Pages。
5. 用无密钥与管理链接分别做生产冒烟验证；使用无敏感信息的小文件，避免真实学校资料触发首次 AI 验收。

```powershell
npx.cmd wrangler d1 migrations apply ledu-school-archive --remote
npx.cmd wrangler pages deploy . --project-name ledu-school-archive --branch main
```

禁止强推。认证失败、冲突或远端出现未知提交时立即停止。

## 已完成的验证

- `node --test tests/api.test.mjs`
- `node --test tests/profile.test.mjs`
- 全新本地 D1 顺序应用 `0001` 与 `0002`
- Pages Functions 构建
- 真实本地 D1/R2 的查看、上传、私有下载、人工编辑/解锁和软删除闭环
- 模拟方舟响应的自动更新、锁定不覆盖、失败保留、管理员重试、输出白名单测试
- 生产首页返回 200；公开画像 API 返回 0/8、八张卡片和已配置 Turnstile
- 生产公开资料列表为 0；无密钥删除请求返回 401
- 远端 D1 无待执行迁移，新部署已成为 `main` 的最新生产部署
- 未使用生产资料触发真实 AI 调用

Edge 本地桌面与 390px 验收已通过；发布后因当前网络对 `*.pages.dev` 连接超时，生产视觉复核未完成。该限制不影响已通过的公网 HTTP/API 检查。

浏览器验收结果与当前发布边界见 `school-profile-handoff.md`。
