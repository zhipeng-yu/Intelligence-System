# 两人资料库交接

更新日期：2026-08-24

## 已完成

- 生产临时地址：<https://ledu-school-archive.pages.dev>
- Pages 项目：`ledu-school-archive`
- D1：`ledu-school-archive`（`1ba7ee18-968d-4598-aad4-8f667454563e`）
- 私有 R2 bucket：`ledu-school-archive`
- Pages Secret：`ADMIN_KEY`
- 管理链接仅保存在本机 `.wrangler/access-url.txt`；密钥同时保存在被忽略的 `.dev.vars`，均未提交。
- 仓库已实现学校画像 1.0 的本地可验证版本；生产仍运行 2026-08-20 的资料库版本，尚未应用 `0002_create_profile_values.sql` 或部署本次页面与 Functions。

代码只在 `main` 维护并正常推送 `origin/main`；禁止强推，遇到未知远端变化立即停止。

## 固定边界

- 单学校、五类资料：学校信息、教学进度、试卷资料、家长与情报、活动与产品。
- 只有“人员1（我）”和“人员2（上级）”；无注册、登录、手机号、部门、角色或用户后台。
- 两人共享随机管理密钥，权限完全相同。上传者是手动声明，不是身份审计。
- 只接收 PDF、DOCX、XLSX，单文件最大 50MB；服务端校验扩展名、MIME、文件头和大小。
- 文件保存在私有 R2，使用随机对象键；下载强制附件并设置 `nosniff`。
- 元数据保存在 D1；新资料默认为“待确认”；删除是 D1 软删除，R2 对象保留以避免跨服务失败造成数据丢失。
- 不实现 AI、多校、全文解析、通知、病毒扫描、公司域名或 ICP。
- 画像 V1 固定为一所学校、当前学期和一个试点年级/学科，共 36 个字段；不保存学生、家长个人明细。

## API

全部接口都要求 `Authorization: Bearer <ADMIN_KEY>`：

- `GET /api/documents`
- `POST /api/documents`
- `GET /api/documents/:id/file`
- `PATCH /api/documents/:id`
- `DELETE /api/documents/:id`
- `GET /api/profile`
- `POST /api/profile`
- `PATCH /api/profile/:id`
- `DELETE /api/profile/:id`

写入顺序为 R2 后 D1；D1 写入失败时删除刚写入的 R2 对象。用户字段只通过安全 DOM API 渲染。

画像候选直接关联一份未删除资料和来源定位。新候选固定为“待确认”；确认候选前来源资料也必须确认。画像按字段封顶计分：缺失 0、待确认 0.25、已确认 1、冲突 0、过期 0；重复证据不叠加，两个不同的有效已确认值自动形成冲突。

## 已验证

- `node --test tests/api.test.mjs`：5 项通过。
- `node --test tests/profile.test.mjs`：5 项通过。
- Pages Functions 构建和 D1 迁移通过。
- 无密钥和错误密钥不能读取、上传、下载、修改或删除资料。
- PDF、DOCX、XLSX 可上传；错误扩展名、MIME、文件头和超过 50MB 均由服务端拒绝。
- Edge 验证了读取、搜索、五类筛选、空结果、状态修改、下载提示、删除确认、响应式布局、键盘焦点和无脚本错误。
- 生产环境完成 R2 上传、默认待确认、附件下载、内容一致、状态修改、软删除闭环；测试数据已清空。
- 当前桌面截图：`artifacts/school-archive-desktop.png`。
- 本地真实 API 闭环已验证：零资料 0%，候选 1.5%，确认 6%，冲突和来源软删除回退 0%，来源未确认时服务端以 409 拒绝确认候选。
- 学校画像 1.0 已在电脑端 Microsoft Edge 完成本地验收：上传资料、登记候选、来源未确认时拦截、确认后按固定权重从 1.5% 增至 6%、重复候选拦截、冲突/过期/来源退回待确认时回退、搜索与五类筛选均正常；390px 宽度无横向溢出，Tab 焦点轮廓清晰，控制台无警告或错误。桌面截图已更新。

## 运维命令

```powershell
npx wrangler d1 migrations apply ledu-school-archive --remote
npx wrangler pages deploy . --project-name ledu-school-archive --branch main
npx wrangler pages secret put ADMIN_KEY --project-name ledu-school-archive
```

最后一条用于轮换泄露的管理密钥。轮换后重新生成管理链接并只通过可信渠道发给两名使用者；不要把秘密写入仓库或聊天。

画像版本首次发布时必须先应用远端 D1 迁移，再部署 Pages；发布前重新核对远端 `main`，并完成浏览器验收。当前未执行任何远端迁移或生产部署。

`*.pages.dev` 在中国大陆的跨境速度和稳定性没有保证；本项目不使用公司域名，也不办理 ICP。
