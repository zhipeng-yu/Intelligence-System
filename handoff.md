# 学校资料库运维交接

更新日期：2026-08-26

## 当前状态

- 生产地址：<https://ledu-school-archive.pages.dev>
- Pages 项目：`ledu-school-archive`
- D1：`ledu-school-archive`（`1ba7ee18-968d-4598-aad4-8f667454563e`）
- 私有 R2 bucket：`ledu-school-archive`
- 生产部署：`15ff5cd8-1c2b-4c5f-a33b-8ea21894c769`，源码提交 `f0234f3`
- 远端 D1 已应用 `0002_create_profile_values.sql`
- Pages 已部署学校画像 2.0
- 仓库源码已实现 `0003` 对应的碎片累积、线性撤销和彻底删除，尚未执行远端迁移或新版本部署
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

## 新源码权限与安全边界

- 公开：查看画像、完成度、来源文件名、最近更新、上传资料、触发每份文件唯一一次的自动整理。
- 管理链接：下载原文件、重试失败整理、撤销最近一次有效画像更新，以及彻底删除失败、未生效或已撤销资料。
- 公开上传必须通过 Turnstile；同一网络散列每小时最多 5 份。
- 服务端继续校验扩展名、MIME、文件头和 50MB 上限。
- 原文件不公开，下载强制附件并设置 `nosniff`；有效更新必须先按顺序撤销，彻底删除同时移除 R2 对象和 D1 文件身份，画像历史匿名保留。
- AI 输出必须经过八个 section key 白名单、每卡 1–12 个非空条目、去重和 4000 字总长度校验；资料正文被视为不可信数据，不能改变系统指令。
- AI 使用当前八卡片与新资料生成受影响卡片的完整新版；相同结果不写历史、来源或撤销步骤。人工编辑与锁定运行时逻辑已删除。
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

- `node --test tests/api.test.mjs`：6 项通过
- `node --test tests/profile.test.mjs`：7 项通过
- 全新本地 D1 顺序应用 `0001`、`0002`、`0003`
- 本地已有状态回填验证：`A → B` 被正确补成两个可连续撤销步骤，并保留前一更新时间
- Pages Functions 构建
- 模拟 D1/R2/方舟响应的上传、私有下载、碎片合并、同值跳过、多卡整体撤销、A/B/C 线性顺序、失败重试、撤销后禁止重试、硬删除与匿名历史测试
- 新源码已用电脑端 Edge 验收桌面、390px 单列布局、键盘焦点、来源展开、失败重试入口、线性撤销和永久删除确认；控制台无错误，桌面截图已更新
- 旧版生产验收时：首页与部署地址返回 200，公开画像 API 返回 1/8、八张卡片和已配置 Turnstile
- 旧版生产验收时：公开资料列表为 1，资料状态为 `completed`，无密钥删除请求返回 401，远端 D1 当时无待执行迁移
- 经用户明确授权，旧版生产曾重试一份此前失败的资料；Workers AI 转换、方舟 Responses API、白名单解析和 D1 写入真实链路成功

浏览器验收结果与当前发布边界见 `school-profile-handoff.md`。

## 发布边界

- 代码提交和快进推送不授权远端 D1 `0003`、Pages 部署、生产硬删除或真实生产 AI 调用。
- 上述生产动作均须再次获得明确授权。
