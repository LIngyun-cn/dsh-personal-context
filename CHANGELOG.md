# Changelog

## Unreleased

- 许可证由 MIT 改为 Apache License 2.0，并新增 `NOTICE`。
- README 末尾加入作者与项目声明。
- 修复面板长期显示旧 `lastError`：成功写入后清除错误，删除已不存在的记录按幂等成功处理，失败时不再强行刷新主题。
- 新会话增加「不导入」快捷按钮，选择器文案改为「不导入任何上下文」。
- 28 项冒烟测试。

## 0.4.0 — 2026-11-17

- 主题与条目敏感度标记：`normal` / `important` / `sensitive`，默认按主题类型继承；面板显示角标，不改变注入行为。
- 备份保留策略：默认 120 份 / 180 天；过期或超量备份先生成永久二级摘要（`backups/summaries/YYYY-MM.md`），确认写入后再删除原始目录。
- 跨进程写入：`Memory/.pc.lock` 串行化 mutation，陈旧锁 30 秒回收；LOG/INDEX/MASTER/合并/删除/更新使用文件戳 CAS，冲突返回明确错误。
- 修复导出时把 `.pc.lock` 一并复制的问题。
- 25 项冒烟测试。

## 0.3.0 — 2026-11-17

- 新会话「记忆」选择器：不加载 / 摘要 / 按主题 / 最近记录，第一条消息前即可生效。
- 每会话动态系统提示段；规范化 session id；revision guard 避免并发覆盖。
- 本机 JSON 路由 `/personal-context/session`（同源 + 客户端标记）。
- 22 项冒烟测试。

## 0.2.0 — 2026-11-17

- 历史会话档案层：`archive/txt`、`catalog.jsonl`、`manifest.json`。
- `archive` 标题检索与可选 `deep` 全文检索；`archive_doc` 读取原文（30,000 字上限）。
- 面板「档案」页；通用 `scripts/import-archive.mjs` 与 seed 格式。
- 21 项冒烟测试。

## 0.1.0 — 2026-11-17

- 初始版本：分层 Markdown 记忆、自动捕获、模型工具、合并/审计/备份/恢复/导出、侧栏面板、斜杠命令、19 项测试。
