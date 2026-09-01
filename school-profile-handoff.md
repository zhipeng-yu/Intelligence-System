# 学校资料与网络资料技术交接

更新日期：2026-09-01

## 实现边界

本轮按 ponytail full 在原架构上增加最小多用户能力：一个原生页面、一个 D1 迁移、三组 Pages Functions 接口和一个本机串行工作器。没有增加框架、构建体系、第三方队列、新服务、短信、密码、R2/PDF 链路、网络资料 AI 或版本系统。

生产仍是 `538f8c6` 与远端迁移 `0004`；本轮代码尚未部署。

## 学校资料兼容

- 登录后共享原八张学校画像卡片，完成度分母为 8。
- `other_products` 行、历史演示、文档和 R2 对象均不删除、不迁移；画像读取、普通资料列表、撤销候选和彻底删除入口不展示这类历史资料。
- 普通上传继续执行 Turnstile、网络散列每小时 5 份、PDF/DOCX/XLSX、50MB、扩展名、MIME 和文件头校验。
- Workers AI `toMarkdown`、方舟 Responses API、一次性整理、线性撤销、私有下载和符合顺序的彻底删除保持不变。
- `INGEST_KEY` 仍只在 `POST /api/documents` 绕过 Turnstile；不能替代用户会话、`ADMIN_KEY` 或 `NETWORK_WORKER_KEY`。

## 登录模型

`users` 保存手机号 HMAC、末四位、备注、启用状态和时间；`sessions` 保存随机令牌的 SHA-256 与 12 小时过期时间。完整手机号和明文会话均不入库。

登录必须通过 Turnstile，错误手机号、无效格式、禁用用户和 Turnstile 失败使用同一响应。所有用户接口只从 `ledu_session` Cookie 得到身份。禁用用户时同步删除其会话，但保留关注账号、任务和结果。

管理员白名单与原有敏感管理操作同时要求有效会话和 `Authorization: Bearer <ADMIN_KEY>`。部署时需在安全终端一次性插入首个管理员白名单用户，之后使用页面管理。

## 网络资料模型

```text
users
  -> watched_accounts (每人最多 3)
  -> network_search_jobs (每人一个活动任务)
       -> network_search_results (删除任务时级联删除)
```

- 检索输入为 1～2 个规范化 AND 关键词和近 1/3/7 日；账号快照与时间窗口在创建时固定。
- D1 条件插入和唯一部分索引共同限制活动任务；同一 SQL 条件同时执行每人 3 次/日和全站 20 次/日配额。
- 用户查询和删除均带 `user_id` 条件，猜测其他用户资源 ID 返回不存在。
- 每人只保留最近 10 个结束任务，活动任务不参与清理。
- 结果只保存账号 ID/名称、发布时间、标题、无查询参数的公开 URL 和 100～200 字摘要；服务端最多接受 30 条。

## 工作器

`automation/network_worker.py` 复用既有 Conda 与固定版 `xiaohongshu-skill`，通过 `edge_client_type(PROFILE_PATH)` 使用独立的系统 Edge profile。关闭浏览器时清除专用 profile 的 History/Sessions 文件，保留登录所需站点存储，避免把含临时参数的访问记录长期留存。

任务计划每分钟启动一次，`MultipleInstances IgnoreNew`，每次只认领一个任务。API 用独立工作器密钥、30 分钟租约和 claim token 控制认领与回传；同一 payload 可安全重复提交。

工作器串行核验账号主页，只取最近 20 条候选，先按主页发布时间排除窗口外内容，再打开详情；主页和详情两层均排除视频。标题与公开文案使用 NFKC、小写和空白归一化后做 AND 匹配，摘要由明确事实确定性拼接，不使用 AI。

单账号失败生成 `partial` 并保留成功结果。验证码、登录失效或安全验证生成 `blocked`，写入无秘密的 halt 状态、发送 Windows 通知并停止后续认领；只能运行 `repair-login` 人工处理并显式恢复。

## 验证与发布边界

本轮已通过三组 Node 测试、两组 Python 测试、全新本地 `0001`～`0005` 迁移、Pages Functions 构建，以及系统 Edge 桌面/390px/键盘/控制台验收。`artifacts/school-archive-desktop.png` 已更新为只显示八张学校卡片的登录后页面。

自动化测试不访问真实小红书、不调用真实 AI。生产迁移、Secret、部署、真实 Edge 检索和旧任务停用均未授权；上线步骤见 `handoff.md`。
