# 网络资料真实验收与上线收尾交接

请接手 `D:\Project\ledu_project\Intelligence System`，使用 **ponytail full**，完成现有“小规模多用户网络资料 MVP”的一次真实只读验收和最小上线收尾。不要新增功能、依赖、服务或设计。

开始前完整阅读 `AGENTS.md`、`readme.md`、`handoff.md`、`school-profile-handoff.md`、相关代码和测试，以及固定提交 `afa96802d3e61cdd5e7bd7b37ec59182bbe07d37` 对应的已安装 `xiaohongshu-skill` 全部必读指令与 Edge、登录、主页、详情实现。确认位于 `main`；先 fetch，再只读核对 `origin/main` 没有未知变化。禁止 pull、强推和非快进推送。

## 当前真实状态

- 生产 Pages 部署为 `8cc8a54f`，源码提交为 `aed9c23`；远端 D1 已应用到 `0005_add_network_materials.sql`，所需生产 Secret 已配置。
- `ADMIN_KEY` 已于 2026-09-02 轮换并重新部署；旧规范管理员链接已经失效。不要读取、输出或重新生成任何管理链接。
- 生产有 1 个待处理的网络资料任务。新工作器尚未进行真实 Edge 检索验收。
- 本机工作器凭据和专用 Edge 用户目录已经存在；尚无工作器 `state.json`，也未注册 `Ledu-Network-Materials-Worker` 计划任务。
- 旧 `Ledu-Xiaohongshu-Course-Trial` 计划任务仍为 `Ready`。新功能真实验收成功前不得停用；无论结果如何，都不得删除旧 `seen.json`、运行状态或 `held_candidates`。
- 当前代码会先按用户选择的近 1/3/7 日窗口筛选主页候选，只打开窗口内图文详情；它是只读流程，不点赞、收藏、评论、关注或发布，不保存完整正文、媒体、评论、用户资料或临时 token，也不调用 AI。
- 用户已经同意用自己的小红书主账号进行一次小规模只读测试；这不代表账号已经登录或检索已经完成。

## 只做以下步骤

1. 先核对上述状态仍然成立。不得读取或输出 Secret、Cookie、完整手机号、管理链接、Edge 会话文件或原始凭据。
2. 用户在电脑旁时，用仓库当前 Conda Python 启动专用 Edge 登录修复：

   ```powershell
   & "$env:LOCALAPPDATA\LeduSchoolArchive\xhs-course-trial\conda-env\python.exe" -m automation.network_worker repair-login
   ```

   由用户亲自在打开的 Edge 中登录并处理任何验证。不要代填账号或密码，不要查看账号私有内容，也不要改用用户日常浏览器或 App。
3. 登录完成后，向用户明确说明将只领取现有 1 个队列任务、执行一次只读检索且不会互动或调用 AI；获得用户当场确认后，仅运行一次：

   ```powershell
   & "$env:LOCALAPPDATA\LeduSchoolArchive\xhs-course-trial\conda-env\python.exe" -m automation.network_worker run
   ```

4. 若出现验证码、登录失效、安全验证或风控提示，立即停止；保持任务为 `blocked`，通知用户并等待人工恢复。禁止自动重试、验证码绕过、Chrome、下载版 Chromium、stealth、指纹伪装、代理池或并发浏览器。
5. 检索结束后核对该任务是否为 `completed`、`partial`、`blocked` 或 `failed`，并让用户在生产页面确认结果。只报告完成验收所需的信息，不输出无关账号内容。
6. 只有任务为 `completed` 或可接受的 `partial`、没有安全验证问题且用户确认页面结果正确后，才再次取得用户明确授权并执行上线收尾：

   - 运行 `& "$env:LOCALAPPDATA\LeduSchoolArchive\xhs-course-trial\conda-env\python.exe" -m automation.network_worker schedule` 注册新工作器计划任务；
   - 验证其为全局串行、每分钟触发且使用 `IgnoreNew`；
   - 仅禁用旧 `Ledu-Xiaohongshu-Course-Trial` 计划任务，不删除任务或历史文件。

7. 按实际结果精简更新 `readme.md`、`handoff.md`、`school-profile-handoff.md` 和 `AGENTS.md`。运行规定测试、构建和全新本地 `0001`～`0005` 迁移；只提交本次文件。提交后再次 fetch 并只读比较，确认可快进后正常推送 `origin/main`。

除专用 Edge 中必须由用户完成的登录和两次明确授权外，不要停下来重复询问已经能从仓库确认的事项。任何认证失败、非快进、未知远端变化或生产安全验证都立即停止并如实报告。
