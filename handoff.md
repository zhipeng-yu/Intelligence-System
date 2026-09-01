# 乐读内部资料库运维交接

更新日期：2026-09-01

## 当前结论

- 仓库已完成“小规模多用户网络资料 MVP”的最小代码、迁移、自动化测试和系统 Edge 页面验收。
- 生产地址仍为 <https://ledu-school-archive.pages.dev>，Pages 仍运行源码提交 `538f8c6`，远端 D1 仍只应用到 `0004_add_other_products_section.sql`。
- 本轮未获授权且未执行：远端 `0005`、生产 Secret 配置、Pages 部署、真实生产 Edge 检索、生产 AI 或远端数据删除。
- 旧 `Ledu-Xiaohongshu-Course-Trial` 任务未停用。本轮没有读取或改变其实时状态；新功能真实验收后才能停用，并须保留旧 `seen.json`、状态文件和 `held_candidates`。
- 现有生产 D1、私有 R2、Workers AI 与方舟闭环保持原状。秘密和管理链接不得进入 Git、聊天、日志、截图或普通文档。

## 新源码结构

- 登录后只有“学校资料”和“网络资料”两个一级板块。
- 学校资料共享原八张画像卡片。第九张“其他产品资料”及其历史数据、原文件和数据库记录保留，但画像 API、资料列表和撤销选择均排除它。
- 网络资料按会话用户隔离关注账号、任务和结果；用户最多关注 3 个标准账号 ID，按 1～2 个 AND 关键词检索近 1/3/7 日图文。
- `0005_add_network_materials.sql` 仅新增五张表：`users`、`sessions`、`watched_accounts`、`network_search_jobs`、`network_search_results`。
- 一个本机串行工作器使用系统 Edge 和独立 `NETWORK_WORKER_KEY`，每账号最多读取最近 20 条主页候选，但只打开时间窗口内的图文详情；每任务最多保存 30 条结果。
- 工作器不下载媒体、不保存完整文案或临时 token、不调用 AI；验证码、登录失效或安全验证会停止并等待人工显式恢复。

## 权限与配额

- 登录接受白名单手机号和 Turnstile，统一返回失败信息。完整手机号只参与请求内 HMAC，不持久化；D1 只保存 HMAC、末四位、备注和状态。
- 会话随机生成，D1 只保存 SHA-256；Cookie 有效 12 小时，并设置 `Secure`、`HttpOnly`、`SameSite=Strict`、`Path=/`。
- 所有用户接口从会话取得 `user_id`。白名单接口以及原有下载、重试、撤销和彻底删除同时要求有效会话与 `ADMIN_KEY`。
- 禁用用户会删除其会话但保留数据。`INGEST_KEY` 的既有权限没有扩大，工作器只接受 `NETWORK_WORKER_KEY`。
- 网络检索按 Asia/Shanghai 计数：每人每天 3 次、全站每天 20 次、每人最多一个 `queued` 或 `running` 任务。
- 任务使用 30 分钟租约；崩溃后可重新认领。字段、任务归属、时间窗口、结果数、摘要长度和无参数公开链接均由服务端校验，重复相同回传幂等。

## 已完成验证

- `node --test tests/api.test.mjs`：8 项通过。
- `node --test tests/profile.test.mjs`：9 项通过；包含第九卡数据存在但页面/API 隐藏。
- `node --test tests/network.test.mjs`：4 组通过；覆盖登录不可枚举、Cookie、注销/禁用、双重管理员鉴权、用户隔离、资源 ID 越权、账号/关键词/日期限制、每日配额、独立工作器密钥、原子租约、重认领、回传校验、幂等和最近 10 项清理。
- 既有 Conda Python 环境运行 `tests/test_xhs_course_trial.py`：9 项通过。
- 同一环境运行 `tests/test_network_worker.py`：8 项通过；覆盖视频排除、AND 匹配、摘要、30 条上限、单账号失败、blocked 停止和任务计划边界。
- 全新临时 D1 依次应用 `0001`～`0005` 成功。
- Pages Functions 构建成功。
- 系统 Edge 完成登录后主流程、8 张学校卡片、网络账号/检索、桌面布局、390px、移动端主导航、键盘焦点和控制台验收；控制台无错误，截图已更新。

测试均使用模拟数据，不访问真实小红书、不调用真实 AI，也没有读取现有 Secret、Cookie 或 Edge 会话文件。

## 最小上线动作

以下动作必须逐项获得新的明确授权：

1. 再次 fetch，只读确认本地 `main` 是 `origin/main` 的正常快进。
2. 在安全终端生成并配置 `PHONE_PEPPER` 与 `NETWORK_WORKER_KEY`，不输出值。
3. 用同一 `PHONE_PEPPER` 对首位管理员手机号计算 HMAC，并在安全操作中向 `users` 写入首个启用用户；这是白名单接口同时要求会话和 `ADMIN_KEY` 后的唯一一次引导。
4. 应用远端 `0005_add_network_materials.sql`。
5. 部署 Pages。
6. 用合成账号/关键词完成登录、隔离、配额和系统 Edge 真实检索验收；不调用 AI。
7. 验收成功后注册新的一分钟 `IgnoreNew` 任务并停用旧七日任务，保留旧状态与候选文件。

生产命令只在获得授权后执行。禁止强推；认证失败、冲突、非快进或未知远端提交时立即停止。
