# AGENTS.md

## 开始前

完整阅读 `readme.md`、`handoff.md` 和相关代码；确认位于 `main`，核对 `origin/main` 未出现未知变化。只允许正常快进推送，禁止强推。

## 当前状态

两人资料库已部署到 <https://ledu-school-archive.pages.dev>。Pages、D1、私有 R2 和 `ADMIN_KEY` 已配置；最终运行与运维信息以 `handoff.md` 为准。

## 维护边界

- 保留单个原生 `index.html`，不引入前端框架、依赖或构建体系。
- 只维护必要的 Pages Functions、D1、私有 R2 与部署配置。
- 固定两名同权使用者；无注册、登录、手机号、部门、角色、AI、多校、病毒扫描或复杂后台。
- 共享管理密钥保护全部资料 API；秘密不得进入 Git、聊天或普通文档。
- 上传者仅为手动声明；支持 PDF、DOCX、XLSX，最大 50MB；服务端边界校验不得弱化。
- 保留五类筛选、搜索、缺失资料、默认待确认、私有随机对象键、附件下载和 D1 软删除。

## 验证与发布

- 修改后至少运行 `node --test tests/api.test.mjs`、Pages Functions 构建和与改动对应的本地闭环。
- 涉及页面时用电脑端 Edge 或 Chrome 检查主要流程、响应式布局、键盘焦点和控制台错误，并更新 `artifacts/school-archive-desktop.png`。
- 部署前确认无密钥访问被拒绝，格式与 50MB 限制由服务端执行。
- 只暂存本次文件；提交到本地 `main` 后再次核对远端，再正常推送 `origin/main`。遇到冲突、认证失败或未知远端变更立即停止。
