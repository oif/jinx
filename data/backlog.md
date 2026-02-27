# Backlog

Jinx 的任务队列。每次 Evolution Cycle 从 Pending 取第一个任务执行。
Neo 通过 Telegram 消息告知 Jinx 添加任务，Jinx 也可在 consciousness check 中自行发现并追加。

**规则:**
- 每次只执行一个任务（Pending 列表顶部）
- Pending 为空时 Evolution 自动跳过，不唤醒 AI，不消耗 API
- 任务完成后移入 Done（保留记录，带完成日期）
- 禁止做"更新统计"、"修复数据不一致"等元数据操作作为任务

---

## Pending

## Done
- [x] #001: 添加网页搜索工具 - 集成 Brave Search API 或 Serper，支持主动搜索获取信息 — 2026-02-27
- [x] #002: 添加代码质量检查工具 - 在构建流程中集成代码复杂度/安全扫描 — 2026-02-27
- [x] #003: 添加性能追踪工具 - 集成 AgentOps 或自定义性能指标收集，增强可观测性 — 2026-02-27
