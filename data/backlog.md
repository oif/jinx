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
- [ ] #016: 添加 API 成本与配额监控 - 追踪 Claude Code、Web Search、GitHub API 调用次数和估算成本，设置预算预警，避免意外高额账单
- [ ] #017: 实现测试覆盖率报告生成 - 集成 vitest coverage 生成覆盖率报告，在站点展示或定期发送给 Neo，识别未测试的代码区域
- [ ] #018: 添加数据自动备份机制 - 定期将 data/ 目录（记忆、技能、状态）备份到 GitHub Gist 或外部存储，防止数据丢失

## Done
- [x] #015: 增强 Site 公开站点内容 - 添加技能库展示页面、记忆图谱可视化、实时健康状态仪表盘，让站点成为真正的"数字身份展示" — 2026-02-27
- [x] #014: 将 Browser Automation 暴露为 Pi 工具 - src/browser/automation.ts 已实现但未被 agent 使用，需添加 screenshot/analyze_page/test_interaction 等工具 — 2026-02-27
- [x] #013: 实现技能真实执行引擎 - 当前 execute_skill 仅返回执行计划，需实现真正的工具链调用执行，支持顺序执行、错误恢复、参数传递 — 2026-02-27
- [x] #010: 重构工具注册为 Pi Extension 形式 - 将 src/agent/tools.ts 中的工具改为 Pi Extension 机制注册 — 2026-02-27
- [x] #011: 修复 MCP 客户端空壳问题 - 要么完整实现 MCP SDK 集成，要么移除空壳代码 — 2026-02-27
- [x] #012: 评估并清理 Session 存储冲突 - 检查 data/sessions/ 和 Pi 的 ~/.pi/agent/sessions/ 是否重复 — 2026-02-27
- [x] #004: 集成 MCP (Model Context Protocol) 客户端 - 连接外部 MCP servers 扩展能力，如 filesystem、git、memory 等 — 2026-02-27
- [x] #006: 升级 Memory 系统 - 实现知识图谱式持久记忆，支持语义搜索和关联记忆，替代简单的文件存储 — 2026-02-27
- [x] #005: 添加 GitHub 增强工具 - 支持 issues 管理、PR 代码审查、仓库分析等完整 GitHub 工作流 — 2026-02-27
- [x] #007: 实现技能库系统 (Skill Library) - 让 Jinx 能创建、存储和复用参数化技能（工具组合），实现从单次执行到经验积累的跨越 — 2026-02-27
- [x] #008: 添加进化策略系统 - 实现 innovate/harden/repair-only 等策略预设，根据当前状态智能选择进化方向而非固定循环 — 2026-02-27
- [x] #009: 实现自我诊断与修复引擎 - 分析 health-history.json 和 performance-metrics.json，识别失败模式并生成修复方案 — 2026-02-27
- [x] #001: 添加网页搜索工具 - 集成 Brave Search API 或 Serper，支持主动搜索获取信息 — 2026-02-27
- [x] #002: 添加代码质量检查工具 - 在构建流程中集成代码复杂度/安全扫描 — 2026-02-27
- [x] #003: 添加性能追踪工具 - 集成 AgentOps 或自定义性能指标收集，增强可观测性 — 2026-02-27
