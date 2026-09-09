# 网络资料生产状态

2026-09-09 已按 **ponytail full** 完成“小红书号”异步核验上线。

## 当前生产

- Pages 部署 `5df53e87`，源码提交 `4162d08`，生产地址 <https://ledu-school-archive.pages.dev>。
- 远端 D1 已应用 `0001`～`0007`，无待应用迁移；原有账号、任务和结果完整保留，外键检查通过。
- `Ledu-Network-Materials-Worker` 使用提交 `4162d08`，状态为 `Ready`，每分钟触发、`MultipleInstances IgnoreNew`；验收后的空闲轮询返回 0。
- `Ledu-Xiaohongshu-Course-Trial` 仍为 `Disabled`，旧 `seen.json`、状态与 `held_candidates` 未改动。
- 既有 Secret 未修改；未调用真实 AI、未删除旧任务或历史候选，也未执行任何远端删除。

## 真实只读验收

- 核验账号：“学而思网校”，主页显示的小红书号 `27247756272`。
- 核验结果：`ready`，稳定主页 ID 已确认，错误为空，租约正常关闭。
- 搜索设置：1 个账号，关键词“学习”，近 7 日；每账号最多 20 条主页候选，每任务最多 30 条结果。
- 搜索结果：`completed / candidates_exhausted`；主页候选 20，窗口内图文 0，详情打开 0，关键词检查 0，命中与保存结果 0，计数完整。
- 验收结束后账号核验与检索活动任务均为 0，`network_worker_control.halted = 0`，未出现验证码、登录失效或安全验证。

## 已验证

- Node 测试 8 + 9 + 12 项、Python 测试 9 + 15 项全部通过。
- Pages Functions 构建成功；全新临时 D1 顺序应用 `0001`～`0007` 成功。
- GPT 内置浏览器已完成小红书号添加与状态展示、1280px、390px、主导航、键盘焦点和控制台验收；生产公开页面返回 200，新提示已生效，未登录 API 仍返回 401。
- 生产迁移记录、历史数据保留、外键完整性、部署源码、计划任务源码和空闲轮询均已只读复核。

## 后续边界

继续遵守 `AGENTS.md`。验证码、登录失效或安全验证必须 blocked、通知并停机，只能人工运行 `repair-login` 显式恢复。不得删除旧任务、历史候选或读取、输出 Secret、Cookie、管理链接、Edge 会话文件和原始凭据。
