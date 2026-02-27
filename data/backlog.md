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
- [ ] #009: 实现自我诊断与修复引擎 - 分析 health-history.json 和 performance-metrics.json，识别失败模式并生成修复方案
- [ ] #008: 添加进化策略系统 - 实现 innovate/harden/repair-only 等策略预设，根据当前状态智能选择进化方向而非固定循环
- [ ] #007: 实现技能库系统 (Skill Library) - 让 Jinx 能创建、存储和复用参数化技能（工具组合），实现从单次执行到经验积累的跨越
- [ ] #006: 升级 Memory 系统 - 实现知识图谱式持久记忆，支持语义搜索和关联记忆，替代简单的文件存储
- [ ] #005: 添加 GitHub 增强工具 - 支持 issues 管理、PR 代码审查、仓库分析等完整 GitHub 工作流
- [ ] #004: 集成 MCP (Model Context Protocol) 客户端 - 连接外部 MCP servers 扩展能力，如 filesystem、git、memory 等

## Done
- [x] #001: 添加网页搜索工具 - 集成 Brave Search API 或 Serper，支持主动搜索获取信息 — 2026-02-27
- [x] #002: 添加代码质量检查工具 - 在构建流程中集成代码复杂度/安全扫描 — 2026-02-27
- [x] #003: 添加性能追踪工具 - 集成 AgentOps 或自定义性能指标收集，增强可观测性 — 2026-02-27
