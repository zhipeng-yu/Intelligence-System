# 学校资料库 1.0

面向分校校长和学校攻坚小组的单校资料索引。核心问题只有三个：我们有什么资料、原文在哪里、还缺什么。

> 当前 `index.html` 仍是旧版经营指标看板，下一任务将按 [`handoff.md`](handoff.md) 重构为资料库1.0。

## 运行

直接使用最新版 Edge 或 Chrome 打开 [`index.html`](index.html)，无需安装、构建或启动服务。

## 1.0目标

页面只保留：

1. 学校概况
2. 资料清单
3. 缺失资料

资料分为学校信息、教学进度、试卷资料、家长与情报、活动与产品。支持关键词搜索、分类筛选和打开原文链接。

演示数据直接保存在 `index.html` 的JavaScript数组中。1.0不做网页录入、Excel导入、文件上传、后台、权限、AI、预警、多校对比或复杂统计。

## 文件

- `index.html`：页面、样式、交互和演示数据
- `handoff.md`：下一窗口执行说明
- `AGENTS.md`：开发与发布约束
- `artifacts/`：验收截图

代码仓库：<https://github.com/zhipeng-yu/Intelligence-System>
