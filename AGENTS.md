# AGENTS.md

## 开始前

完整阅读 `readme.md`、`handoff.md`、`school-profile-handoff.md` 和相关代码；确认位于 `main`，只读核对 `origin/main` 未出现未知变化。只允许正常快进推送，禁止强推。

## 当前状态

学校画像系统 2.0 已部署到 <https://ledu-school-archive.pages.dev>，远端 D1 已应用 `0002_create_profile_values.sql`，真实方舟整理链路已完成生产验收。运行与发布信息以 `handoff.md` 为准。

## 维护边界

- 保留单个原生 `index.html`，不引入前端框架、依赖或构建体系。
- 固定单校、八张画像卡片和三块首页；不增加账号、多校、角色、复杂后台、知识图谱、向量库或队列。
- 不得恢复 1.0 的 36 字段、权重、候选、确认状态或双确认。
- 老师公开查看和上传；管理链接只保护人工编辑/解锁、原文件下载、软删除和失败重试。
- 文件只支持 PDF、DOCX、XLSX，最大 50MB；服务端扩展名、MIME、文件头和大小校验不得弱化。
- 公开上传必须保留 Turnstile、同一网络散列每小时 5 份、每文件一次自动整理；不得保存明文 IP。
- 原文件保存在私有 R2 并使用随机对象键；下载强制附件，删除保持 D1 软删除。
- AI 路径固定为 Workers AI `toMarkdown` 加原生 `fetch` 调用方舟 Responses API。只接受八个 key 的白名单输出，不覆盖人工锁定，不清空未提及卡片。
- 秘密不得进入 Git、聊天、日志、截图或普通文档；不读取或输出已有秘密。

## 验证与发布

- 修改后至少运行 `node --test tests/api.test.mjs`、`node --test tests/profile.test.mjs`、Pages Functions 构建和对应本地闭环。
- 涉及页面时用电脑端 Edge 或 Chrome 检查主要流程、390px 响应式、键盘焦点和控制台错误，并更新 `artifacts/school-archive-desktop.png`。
- 只暂存本次文件；提交本地 `main` 后再次只读核对远端，再正常推送 `origin/main`。
- 遇到冲突、认证失败或未知远端变化立即停止。
- 推送代码不代表授权远端 D1 迁移、生产部署或真实生产 AI 调用。

## 每次任务收尾

按实际结果精简更新 `readme.md`、`handoff.md`、`school-profile-handoff.md` 和本文件，删除失效说明，不追加流水账。除非用户明确要求不提交或不推送，验证通过后正常提交并快进推送。
