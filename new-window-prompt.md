# 网络资料效率与访问预算优化交接

继续在 `D:\Project\ledu_project\Intelligence System` 按 **ponytail full** 收尾。开始前完整阅读 `AGENTS.md`、`readme.md`、`handoff.md`、`school-profile-handoff.md`、相关代码与测试，以及固定提交 `afa96802d3e61cdd5e7bd7b37ec59182bbe07d37` 对应的已安装 `xiaohongshu-skill` 必读指令和 Edge、登录、主页、详情实现。禁止 pull、强推和非快进推送。

## 源码已实现

- `0006_add_network_budget_metrics.sql` 直接扩展 `network_search_jobs`，保存任务额度、预算日、主页候选、初筛剩余、详情打开、关键词检查、命中、停止原因和计数完整性；另增加单行 `network_worker_control` 全局停机表。
- 详情预算固定为 `180` 次/Asia/Shanghai 自然日。claim 按账号数 × 20 原子预留最坏额度，完整回传后收敛为实际 `detail_opens`；硬崩溃或租约过期继续保留完整额度。
- 服务端保证最多一个 `running`；租约为 50 分钟，过期任务结束为 `failed/lease_expired` 且不重新认领，旧 claim 回传继续拒绝。
- 已占用当天预算的结束任务次日才允许删除，避免删除任务绕过日预算；结果仍随任务删除级联清理。
- 工作器先读取全部账号各最多 20 条主页候选，再排除视频、窗口外、无效 ID 和缺少当前会话临时参数的候选，跨账号按帖子 ID 去重，并按标题关键词命中数、发布时间安排详情顺序。标题未命中只后移，不排除。
- `detail_opens` 在详情导航前计数；只有可用、窗口内图文真正执行 AND 判断时才增加 `keyword_checks`。达到 30 条唯一结果、任务额度、40 分钟截止、安全阻断或候选耗尽立即停止。
- 验证码、登录失效和安全验证（包括 `wait_for_initial_state`）统一为 blocked；成功回传会设置 D1 全局停机，本地随后停机。只有人工 `repair-login` 成功后才同时显式恢复服务端和本地状态。
- 用户 API 返回任务漏斗和今日实际/预留/剩余预算。页面对统计不完整的任务明确显示“实际统计未完整上报”及保守预留，不用 0 冒充实际访问数。
- 没有增加框架、队列、服务、浏览器依赖、AI、网络响应监听、代理、并发、stealth、签名逆向或正文/媒体/评论/临时 token 持久化。

## 已完成验证

- `node --test tests/api.test.mjs`：8 项通过。
- `node --test tests/profile.test.mjs`：9 项通过。
- `node --test tests/network.test.mjs`：6 组通过。
- `tests/test_xhs_course_trial.py`：9 项通过。
- `tests/test_network_worker.py`：11 项通过。
- Pages Functions 构建成功。
- 全新临时 D1 依次应用 `0001`～`0006` 成功。
- `git diff --check` 通过，仅有既有行尾转换提示。
- 全部自动化验证使用模拟数据；未运行真实小红书检索、真实 AI，也未读取 Secret、Cookie、Edge 会话文件或原始凭据。

## 页面验收已完成

- GPT 内置浏览器使用本地模拟数据完成 1280px 桌面与 390px 响应式验收；未访问真实小红书或生产接口。
- 学校资料与网络资料主导航切换正确；390px 内容无水平溢出。
- 网络资料正确显示今日实际 `47 / 180`、当前预留 `40`、剩余 `93`，以及完整漏斗、停止原因和统计不完整提示。
- 键盘焦点显示 3px 黄色轮廓；控制台无 warning 或 error。
- `artifacts/school-archive-desktop.png` 已更新为网络资料桌面视图。

## 当前运维与生产边界

- 本地 `main` 与 `origin/main` 在实施前均为 `40d82ced3ec0407c97bbaada013a629de3273c61`；工作区包含本任务未提交改动，不得丢弃或覆盖。
- 生产 Pages 部署 `8cc8a54f` 仍运行源码 `aed9c23`，远端 D1 只到 `0005_add_network_materials.sql`；生产尚未包含本优化。
- `Ledu-Network-Materials-Worker` 已获用户授权临时禁用，当前必须保持 `Disabled`，完成验证后也不得自行恢复或重注册。
- 旧 `Ledu-Xiaohongshu-Course-Trial` 已禁用但未删除；旧 `seen.json`、运行状态和 `held_candidates` 必须原样保留，不得删除历史候选。
- 代码验证、提交和正常快进推送已获授权。提交前后必须 fetch 并只读比较 `origin/main`；冲突、认证失败、非快进或未知远端变化立即停止。
- 当前授权不包含生产 D1 `0006`、Pages 部署、Secret 变更、计划任务恢复/重注册、真实 Edge 检索、真实 AI、旧任务删除或任何远端删除。代码推送后需再次取得用户明确授权再上线。
