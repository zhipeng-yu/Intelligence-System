# 学校画像系统 1.0

面向“人员1（我）”和“人员2（上级）”的单校画像系统，使用原生 HTML、CSS、JavaScript 与 Cloudflare Pages Functions、私有 R2、D1 实现。现有资料库能力完整保留；资料作为证据，人工登记并确认的字段结论形成可解释画像。

临时地址：<https://ledu-school-archive.pages.dev>

## 使用方式

- 不注册、不登录；两人权限完全相同。
- 首次使用本机 `.wrangler/access-url.txt` 中的管理链接。密钥会保存在浏览器并从地址栏清除。
- 上传者由下拉框手动选择，只代表声明身份，不是可核验审计。
- 支持 PDF、DOCX、XLSX，单文件最大 50MB；新上传状态为“待确认”。
- 支持五类筛选、搜索、下载、状态修改、删除确认和缺失资料查看。
- 画像固定为 36 个字段、总权重 100%；展示总完成度、分维度完成度、状态分布和最高收益补充项。
- 候选结论必须关联一份资料和来源定位；新候选固定为“待确认”，确认、冲突、过期、候选删除或来源删除后实时重算。
- 第一版只做人工确认，不接入外部 AI 或文档解析服务。

不要把 `.dev.vars`、`.wrangler/access-url.txt` 或管理密钥发到聊天、提交到 Git，或放进普通文档。

## 本地运行与验证

```powershell
npx wrangler d1 migrations apply ledu-school-archive --local
npx wrangler pages dev . --persist-to .wrangler/state
node --test tests/api.test.mjs
node --test tests/profile.test.mjs
```

本地密钥保存在被 Git 忽略的 `.dev.vars`。部署配置见 `wrangler.toml`；生产建表与部署命令见 `handoff.md`。

## 主要文件

- `index.html`：单页前端
- `functions/`：资料 API 与鉴权、文件校验
- `functions/api/profile/`：画像查询、候选登记、状态更新和软删除 API
- `migrations/0001_create_documents.sql`：资料表建表
- `migrations/0002_create_profile_values.sql`：画像候选表、索引和重复约束
- `profile-schema-v1.md`：36 个画像字段、权重、有效期、证据标准和完成度公式
- `wrangler.toml`：Pages、D1、R2 绑定
- `tests/api.test.mjs`：最小服务端测试
- `tests/profile.test.mjs`：画像计分与候选闭环测试
- `artifacts/school-archive-desktop.png`：当前桌面端验收截图

代码仓库：<https://github.com/zhipeng-yu/Intelligence-System>
