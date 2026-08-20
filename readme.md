# 学校资料库

面向两名内部使用者的单校资料索引，用于查看、搜索、上传和维护 PDF、DOCX、XLSX 文件。

## 当前状态

当前版本仍是无需安装即可打开的静态演示页：使用最新版 Edge 或 Chrome 直接打开 [`index.html`](index.html)。页面已有学校概况、五类资料搜索与筛选、资料清单和缺失资料；演示链接尚未接入真实文件。

下一任务将按 [`handoff.md`](handoff.md) 接入最小真实上传能力并部署到 Cloudflare 临时地址。前端继续使用原生 HTML、CSS、JavaScript；服务端仅使用 Pages Functions、私有 R2 文件存储和 D1 元数据。

## 已确定的使用方式

- 使用者只有“人员1（我）”和“人员2（上级）”，权限相同。
- 不注册、不登录，通过一条随机共享管理链接进入。
- 上传时手动选择上传者，姓名对两人可见；该记录不具备身份核验能力。
- 暂不使用公司域名，不办理 ICP 备案。
- 仅支持 PDF、DOCX、XLSX，单文件最大 50MB。

## 文件

- `index.html`：当前页面、样式、交互和演示数据
- `handoff.md`：下一任务的完整实施交接
- `AGENTS.md`：开发、验证与发布约束
- `artifacts/school-archive-desktop.png`：当前静态版本验收截图

代码仓库：<https://github.com/zhipeng-yu/Intelligence-System>
