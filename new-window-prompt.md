# 小红书课程产品 7 天最小试运行交接提示词

请接手 `D:\Project\ledu_project\Intelligence System` 的“小红书课程产品 7 天最小试运行”，全程使用 `ponytail` full 和固定提交 `afa96802d3e61cdd5e7bd7b37ec59182bbe07d37` 对应的已安装 `xiaohongshu-skill`。设计已经确认，不要扩展或重新访谈。

## 开始前

1. 完整阅读 `AGENTS.md`、`readme.md`、`handoff.md`、`school-profile-handoff.md`、本文件、上传/分析代码，以及技能的 `SKILL.md`、`AGENTS.md`、`docs/INSTALL.md`、`docs/SECURITY.md`、`docs/API.md` 和相关代码。
2. 确认 `main` 和工作区状态；fetch 后只读核对 `origin/main`。认证失败、冲突或未知远端变化立即停止，只允许正常快进推送。
3. 不读取、输出或记录现有密钥、管理链接、Cookie、分享查询参数或原文件内容。

## 当前状态

- 固定账号 `565aa55cb8ce1a32c6fdebe7` 已在本机系统 Edge 完成登录、身份核验和最新 20 条 ID 基线。
- 基线没有生产上传或 AI 调用；本地状态、Edge profile、Conda Python 3.12 环境和 DPAPI 凭据均在 `%LOCALAPPDATA%\LeduSchoolArchive\xhs-course-trial`，不得进入 Git。
- 生产 `INGEST_KEY` 和源码提交 `ec9a231` 已部署；Windows 任务在 2026-08-29 至 2026-09-04 每日 09:00 运行，实时状态以本地状态文件和 `handoff.md` 为准。

## 固定运行边界

- 只使用本机系统 Edge；不使用 Chrome、不下载 Playwright Chromium，不注入 stealth、指纹伪装、User-Agent 或验证码绕过。验证码、登录失效、安全验证和账号身份异常立即通知并停止，允许人工在 Edge 接管。
- 仅监控上述标准主页 ID；不保存 `xsec_token`、`share_id` 等临时参数。只保留明确的课程、课程包和教师培训课程；排除观点、文具、硬件、单独教材、个人动态和模糊活动。
- 每条只保存产品字段、原文标题、无临时参数的公开链接和 100–200 字确定性事实摘要；不保存全文、图片、视频、评论或用户信息，不调用第二个 AI。
- 配置完成次日 09:00（Asia/Shanghai）开始，连续 7 个自然日。每日最多一个 PDF、10 条、一次现有生产 AI；溢出顺延。无新增课程产品则不上传、不调用 AI。
- 首次只记录 20 条 ID；之后只处理新增，不回查旧编辑。临时网络错误 15 分钟后仅重试一次；登录、身份、上传或 AI 异常立即通知并停止后续任务，失败不延长周期。

## 网站与发布边界

- 机器上传只使用现有 `POST /api/documents` 的独立 `INGEST_KEY`，仅绕过 Turnstile；网络散列限流、PDF/DOCX/XLSX、50MB、扩展名/MIME/文件头校验保持，不得使用 `ADMIN_KEY`。
- 上传后继续调用现有 `/api/documents/{id}/analyze`；不增加表、迁移、队列、框架、依赖、服务、上传端点、快照、来源表、重做或分支。
- 本任务已授权最小代码修改、正常提交和快进推送、配置 `INGEST_KEY`、生产 Pages 部署，以及试运行最多 7 次真实生产 AI；未授权远端 D1 迁移、生产硬删除或规避平台验证。
- 每次生产动作前重新 fetch 并核对远端。完成后更新交接文件，只暂存本次文件，验证后正常提交、再次核对并快进推送；禁止强推。
