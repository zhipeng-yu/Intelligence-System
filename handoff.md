# 两人资料库交接

更新日期：2026-08-20

## 已完成

- 生产临时地址：<https://ledu-school-archive.pages.dev>
- Pages 项目：`ledu-school-archive`
- D1：`ledu-school-archive`（`1ba7ee18-968d-4598-aad4-8f667454563e`）
- 私有 R2 bucket：`ledu-school-archive`
- Pages Secret：`ADMIN_KEY`
- 管理链接仅保存在本机 `.wrangler/access-url.txt`；密钥同时保存在被忽略的 `.dev.vars`，均未提交。

代码只在 `main` 维护并正常推送 `origin/main`；禁止强推，遇到未知远端变化立即停止。

## 固定边界

- 单学校、五类资料：学校信息、教学进度、试卷资料、家长与情报、活动与产品。
- 只有“人员1（我）”和“人员2（上级）”；无注册、登录、手机号、部门、角色或用户后台。
- 两人共享随机管理密钥，权限完全相同。上传者是手动声明，不是身份审计。
- 只接收 PDF、DOCX、XLSX，单文件最大 50MB；服务端校验扩展名、MIME、文件头和大小。
- 文件保存在私有 R2，使用随机对象键；下载强制附件并设置 `nosniff`。
- 元数据保存在 D1；新资料默认为“待确认”；删除是 D1 软删除，R2 对象保留以避免跨服务失败造成数据丢失。
- 不实现 AI、多校、全文解析、通知、病毒扫描、公司域名或 ICP。

## API

全部接口都要求 `Authorization: Bearer <ADMIN_KEY>`：

- `GET /api/documents`
- `POST /api/documents`
- `GET /api/documents/:id/file`
- `PATCH /api/documents/:id`
- `DELETE /api/documents/:id`

写入顺序为 R2 后 D1；D1 写入失败时删除刚写入的 R2 对象。用户字段只通过安全 DOM API 渲染。

## 已验证

- `node --test tests/api.test.mjs`：5 项通过。
- Pages Functions 构建和 D1 迁移通过。
- 无密钥和错误密钥不能读取、上传、下载、修改或删除资料。
- PDF、DOCX、XLSX 可上传；错误扩展名、MIME、文件头和超过 50MB 均由服务端拒绝。
- Edge 验证了读取、搜索、五类筛选、空结果、状态修改、下载提示、删除确认、响应式布局、键盘焦点和无脚本错误。
- 生产环境完成 R2 上传、默认待确认、附件下载、内容一致、状态修改、软删除闭环；测试数据已清空。
- 当前桌面截图：`artifacts/school-archive-desktop.png`。

## 运维命令

```powershell
npx wrangler d1 migrations apply ledu-school-archive --remote
npx wrangler pages deploy . --project-name ledu-school-archive --branch main
npx wrangler pages secret put ADMIN_KEY --project-name ledu-school-archive
```

最后一条用于轮换泄露的管理密钥。轮换后重新生成管理链接并只通过可信渠道发给两名使用者；不要把秘密写入仓库或聊天。

`*.pages.dev` 在中国大陆的跨境速度和稳定性没有保证；本项目不使用公司域名，也不办理 ICP。
