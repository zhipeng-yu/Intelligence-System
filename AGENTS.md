# AGENTS.md

## 开始前

完整阅读 `readme.md`、`handoff.md`、`school-profile-handoff.md` 和相关代码；确认位于 `main`，fetch 后只读核对 `origin/main` 未出现未知变化。只允许正常快进推送，禁止 pull 和强推。

涉及网络资料时使用 ponytail full，并完整阅读固定提交 `afa96802d3e61cdd5e7bd7b37ec59182bbe07d37` 对应的已安装 `xiaohongshu-skill` 指令与相关 Edge/登录/主页/详情代码。

## 当前状态

小规模多用户网络资料 MVP 已部署；生产部署 `8cc8a54f` 运行源码 `aed9c23`，远端 D1 已到 `0005_add_network_materials.sql`，所需 Secret 已配置。`ADMIN_KEY` 已于 2026-09-02 轮换并随当前部署生效；生产有 1 个 `queued` 检索任务，真实 Edge 检索、新工作器计划任务和旧七日任务停用尚未执行。

旧七日任务只有在新功能真实验收后才能停用。停用时保留旧 `seen.json`、运行状态和 `held_candidates`，不删除历史候选。

## 维护边界

- 保留单个原生 `index.html`、Pages Functions、D1、既有 R2、当前 Conda、系统 Edge 和 Windows 任务计划；不增加框架、构建体系、第三方队列、新服务或浏览器依赖。
- 固定单校与两个登录后一级板块。学校资料共享原八张卡片；第九张 `other_products` 及历史数据保留但从画像、资料列表和撤销范围隐藏。
- 手机号登录不增加密码、短信、邀请码、自助注册或自助注销。完整手机号不得落库或记录；会话不得明文存储或写入 localStorage。
- 所有用户 API 从安全 Cookie 会话确定 `user_id`。管理员白名单和原敏感管理操作同时要求会话与 `ADMIN_KEY`；禁用用户删除会话但保留数据。
- 文件仍只支持 PDF、DOCX、XLSX，最大 50MB；Turnstile、网络散列限流、扩展名、MIME、文件头、私有 R2、随机对象键、附件下载、线性撤销和彻底删除规则不得弱化。
- `INGEST_KEY` 只保留既有 `POST /api/documents` 权限；工作器只接受独立 `NETWORK_WORKER_KEY`。
- 网络资料固定为每人 3 个账号、1～2 个 AND 关键词、近 1/3/7 日、每账号 20 条主页候选且只打开时间窗口内的图文详情、每任务 30 条结果、每人每天 3 次、全站每天 20 次、每人一个活动任务、最近 10 个结束任务。
- 网络资料不进入学校画像、R2/PDF 或 AI。不得保存完整文案、媒体、评论、用户资料或临时 token。
- 工作器只用系统 Edge，全局串行；禁止 Chrome、下载版 Chromium、stealth、指纹伪装和验证码绕过。验证码、登录失效或安全验证必须 blocked、通知、停机并等待显式人工恢复。
- 不得恢复 1.0 的 36 字段、权重、候选、双确认，也不增加快照、重做、分支、知识图谱或向量库。
- 秘密不得进入 Git、聊天、日志、截图或普通文档；不读取或输出已有秘密、Cookie、管理链接、Edge 会话文件或原始凭证。

## 验证与发布

- 至少运行三组 Node 测试、两组 Python 测试、Pages Functions 构建和全新本地 `0001`～`0005` 迁移。
- 页面修改使用系统 Edge 检查主要流程、390px、主导航、键盘焦点和控制台，并更新 `artifacts/school-archive-desktop.png`。
- 只暂存本次文件；提交本地 `main` 后再次 fetch 并只读比较，再正常推送 `origin/main`。冲突、认证失败、非快进或未知远端变化立即停止。
- 推送代码不授权生产 D1、Secret、Pages 部署、真实 Edge 检索、真实 AI、旧任务停用或远端删除。

## 每次任务收尾

按实际结果精简更新 `readme.md`、`handoff.md`、`school-profile-handoff.md` 和本文件，删除失效说明。除非用户明确要求不提交或不推送，验证通过后正常提交并快进推送。
