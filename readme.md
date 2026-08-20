# 学校资料库

面向“人员1（我）”和“人员2（上级）”的单校资料库，使用原生 HTML、CSS、JavaScript 与 Cloudflare Pages Functions、私有 R2、D1 实现。

临时地址：<https://ledu-school-archive.pages.dev>

## 使用方式

- 不注册、不登录；两人权限完全相同。
- 首次使用本机 `.wrangler/access-url.txt` 中的管理链接。密钥会保存在浏览器并从地址栏清除。
- 上传者由下拉框手动选择，只代表声明身份，不是可核验审计。
- 支持 PDF、DOCX、XLSX，单文件最大 50MB；新上传状态为“待确认”。
- 支持五类筛选、搜索、下载、状态修改、删除确认和缺失资料查看。

不要把 `.dev.vars`、`.wrangler/access-url.txt` 或管理密钥发到聊天、提交到 Git，或放进普通文档。

## 本地运行与验证

```powershell
npx wrangler d1 migrations apply ledu-school-archive --local
npx wrangler pages dev . --persist-to .wrangler/state
node --test tests/api.test.mjs
```

本地密钥保存在被 Git 忽略的 `.dev.vars`。部署配置见 `wrangler.toml`；生产建表与部署命令见 `handoff.md`。

## 主要文件

- `index.html`：单页前端
- `functions/`：资料 API 与鉴权、文件校验
- `migrations/0001_create_documents.sql`：D1 建表
- `wrangler.toml`：Pages、D1、R2 绑定
- `tests/api.test.mjs`：最小服务端测试
- `artifacts/school-archive-desktop.png`：当前桌面端验收截图

代码仓库：<https://github.com/zhipeng-yu/Intelligence-System>
