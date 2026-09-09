# 乐读内部资料库

少量内部用户使用的单校资料与小红书公开资料工具。保持单个原生 `index.html`、Pages Functions、D1、私有 R2、既有 Conda 和 Windows 任务计划。

生产地址：https://ledu-school-archive.pages.dev

## 发布状态

生产仍为部署 `4310e4b9`、源码 `6e2ff6f`、迁移 `0007`，使用共享工作器 profile。2026-09-09 新源码增加每用户隔离扫码绑定及 `0008_user_browser_bindings.sql`，已完成本地模拟验证，**未部署、未切换计划任务、未进行真实扫码验收**。

用户已确认旧“24 位标准账号 ID”页面在刷新后变为“小红书号”。没有重复修改正确表单，也没有增加刷新脚本；不能据此认定特定缓存或预览域名是根因。

## 登录与学校资料

手机号白名单与 Turnstile 登录，无密码、短信、自助注册或注销。完整手机号不落库；D1 保存手机号 HMAC、末四位及会话 SHA-256。12 小时安全 Cookie，不将会话放入 localStorage。用户接口从 Cookie 确定身份；敏感管理操作同时要求会话与 `ADMIN_KEY`，禁用用户删除会话但保留历史数据。

学校资料共享八张卡片；第九张 `other_products` 及历史文件保留但隐藏。上传只支持 PDF、DOCX、XLSX，最大 50MB，保留文件校验、Turnstile、网络散列限流、私有 R2、附件下载、线性撤销和彻底删除边界。原学校 AI 整理链路未变。`INGEST_KEY` 只用于既有文档上传权限。

## 网络资料（新源码）

- 用户先在网络资料页扫码绑定自己的后台登录状态；二维码最多等待两分钟，支持刷新、解绑、重新绑定。访问本站的浏览器不提供小红书 Cookie 给工作器。
- 每用户使用随机目录标识的独立本机 profile。未绑定或失效时不能核验/检索，不回退共享会话。旧共享 profile 原样保留但不再使用。
- 用户输入主页显示、大小写完全一致的小红书号，最多保存 3 个关注账号。核验一次用户搜索页前 20 个候选，最多打开一个精确匹配主页。
- 核验和检索各为每人每日 3 次、全站 20 次；删除核验申请不返还次数。检索为 1～2 个 AND 关键词、近 1/3/7 日、每账号最多 20 条候选、每任务最多 30 条结果。
- 保留每人最近 10 个结束任务。结果包含账号名、标题、日期、干净公开链接及 100～200 字确定性摘要，不保存完整正文、媒体、评论或临时访问参数，不进入学校画像、R2/PDF 或 AI。
- 三类工作共用全局串行工作器。绑定使用 3 分钟租约、最多 2 分钟等待；核验/检索继续使用 50 分钟租约、40 分钟详情截止及全站每日 180 次详情预算。已排队的资料任务等待绑定完成，运行中的资料任务阻止更换会话。
- 验证码、安全验证或登录失效必须 blocked、通知并全局停机。人工恢复命令需要明确的用户 profile 标识：`python -m automation.network_worker repair-login --profile-id <内部随机标识>`。不得自动恢复。

## 二维码暂存

页面生成 RSA-OAEP 密钥对，私钥仅留在当前页面内存；工作器只截取二维码元素并经受认证的接口提交，服务端以随机 AES-GCM 密钥加密图片并用页面公钥封装密钥。D1 仅暂存密文、公钥、所有者会话哈希与过期时间；取图需同一有效发起会话。二维码不写本地图片文件或 R2，不返回扫码 token。

终态、刷新、解绑、禁用、会话失效与过期清除挑战；每次状态查询/工作器认领执行过期清理。停机时密文可能保留到下次清理，但没有服务端持久化私钥可用于解密。页面刷新、退出、离开和二维码过期清除内存密钥及图片。

## 验证与维护

```powershell
node --test tests/api.test.mjs
node --test tests/profile.test.mjs
node --test tests/network.test.mjs tests/network-resolution.test.mjs tests/network-binding.test.mjs
%LOCALAPPDATA%\LeduSchoolArchive\xhs-course-trial\conda-env\python.exe -m unittest tests/test_xhs_course_trial.py
%LOCALAPPDATA%\LeduSchoolArchive\xhs-course-trial\conda-env\python.exe -m unittest tests/test_network_worker.py
npx.cmd wrangler d1 migrations apply ledu-school-archive --local --persist-to .wrangler/state
npx.cmd wrangler pages functions build
```

本轮 Node 33 项、Python 3+15 项通过，Pages Functions 构建及全新本地 `0001`～`0008` 迁移通过。内置浏览器完成模拟绑定、重新绑定、解绑、桌面、390px、键盘焦点和主导航验证，控制台无错误。截图：`artifacts/school-archive-desktop.png`。本地验收页可用 `node tests/preview-server.mjs` 启动，仅监听本机，全部使用合成数据。

发布操作须另行授权；详见 `AGENTS.md`、`handoff.md` 和 `school-profile-handoff.md`。代码仓库：https://github.com/zhipeng-yu/Intelligence-System
