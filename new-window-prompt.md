# 网络资料生产状态

2026-09-03 已按 **ponytail full** 完成网络资料访问预算优化上线。

## 当前生产

- Pages 部署 `1693b189`，源码提交 `4ea51be`，生产地址 <https://ledu-school-archive.pages.dev>。
- 远端 D1 已应用 `0001`～`0006`；`network_worker_control.halted = 0`。
- `Ledu-Network-Materials-Worker` 为 `Ready`，每分钟触发、`MultipleInstances IgnoreNew`；上线后首次空闲轮询返回 0。
- `Ledu-Xiaohongshu-Course-Trial` 仍为 `Disabled`，旧 `seen.json`、状态与 `held_candidates` 未改动。
- 未修改 Secret、未创建真实检索、未调用真实 AI、未删除旧任务或历史候选。

## 已验证

- Node 测试 8 + 9 + 6 项、Python 测试 9 + 11 项全部通过。
- Pages Functions 构建成功；全新临时 D1 顺序应用 `0001`～`0006` 成功。
- GPT 内置浏览器已完成登录后主流程、1280px、390px、主导航、键盘焦点和控制台验收；生产登录页无水平溢出且控制台无错误。
- 生产迁移记录、9 个新增任务字段、全局停机行、部署源码和计划任务首次轮询均已只读复核。

## 后续边界

继续遵守 `AGENTS.md`。验证码、登录失效或安全验证必须 blocked、通知并停机，只能人工运行 `repair-login` 显式恢复。不得删除旧任务、历史候选或读取、输出 Secret、Cookie、管理链接、Edge 会话文件和原始凭据。
