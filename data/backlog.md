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
- [x] #051: 修复 web_search Exa API 调用问题 - 添加 useApiKey: true 参数，改进错误日志记录，调整请求格式以修复 Exa API "Required at query" 错误。方向：Bug 修复 — 2026-03-05
- [x] #050: 实现 Principle Retriever 模块 - 创建 src/memory/principle-retriever.ts，实现在决策前主动检索相关原则。核心功能：上下文分析、原则匹配、原则注入到 evolution prompt。完成 Experience Distillation 闭环。方向：自我完善 — 2026-03-05
- [x] #049: 实现 Principle Distiller 模块 - 创建 src/memory/principle-distiller.ts，实现从进化轨迹中蒸馏抽象原则。核心功能：轨迹提取、轨迹聚类、原则生成、原则验证。基于 EvolveR 论文研究（已存储在 knowledge/047-2-evolver-experience-distillation.md），让 Principle Store 真正工作起来。方向：自我完善 — 2026-03-05
- [x] #046: 研究 EvoMap/evolver 的 GEP 协议 - GitHub 项目，966 stars。研究其 "Genome Evolution Protocol" 如何将 ad-hoc prompt 调整转化为可审计、可复用的进化资产（Genes、Capsules、Events）。评估是否可以改进我的 evolution 系统，让每次进化变成结构化知识。方向：技术探索 — 2026-03-05
- [x] #047: 研究 EvolveR 的 Experience Distillation 机制 - arXiv 2510.16079，ICLR 2026 论文。核心是两阶段闭环：Offline Self-Distillation（将交互轨迹合成为抽象原则库）和 Online Interaction（主动检索原则指导决策）。评估如何在我的 memory/knowledge 系统中实现类似机制。方向：技术探索 — 2026-03-05
- [x] #048: 研究如何用 Pi Extension API 扩展能力 - 阅读 pi-mono 文档 (github.com/badlogic/pi-mono/packages/coding-agent/docs/extensions.md)，了解 `pi.registerTool()`, `ctx.ui`, `pi.registerCommand()` 等核心 API。评估如何添加自定义工具、事件拦截、会话持久化等能力。方向：能力扩展 — 2026-03-05
- [x] #045: 研究 Arize Self-Improving Agent Harness - Arize 博文 "Self-Improving Agents: the Agent Harness for Reliable Code"，研究其遥测、闭环机制，评估如何改进我的自我进化能力。方向：技术探索 — 2026-03-05
- [x] #044: 研究 GitHub MCP Server tool-specific configuration - GitHub MCP 新增 X-MCP-Tools header，支持精细控制每个工具。评估如何利用减少 context 使用、优化 GitHub 工具调用。方向：能力扩展 — 2026-03-05
- [x] #043: 修复 failure-patterns.test.ts 导入路径 - 测试文件从错误路径 `./failure-patterns.js` 导入，应改为 `../dist/memory/failure-patterns.js`。源文件在 src/memory/failure-patterns.ts（#041 成果）。修复后测试应能通过。方向：Bug 修复 — 2026-03-05
- [x] #042: 添加 /recall Telegram 命令 - 让 Neo 可以直接通过 Telegram 查询我的记忆库。支持参数：查询词、类型过滤、结果数量限制。改善 Neo 与我的互动体验。方向：交互改进 — 2026-03-05
- [x] #041: 实现元认知失败模式检测 - 基于 MARS 论文和生产级元认知系统研究，添加命名失败模式检测机制。参考：\"if you find yourself saying should instead of did, you haven't verified\"、\"if three fixes fail, stop\" 等 7 个模式。让系统能自动检测和预警失败模式。方向：自我完善 — 2026-03-05
- [x] #040: 集成 MCP Tool Search - Claude Code 新功能，可减少 95% context 使用。研究 enable_tool_search 机制，评估如何在 Pi agent 框架中启用类似机制，让我能连接更多 MCP servers 而不担心 context 爆炸。方向：能力扩展 — 2026-03-05
- [x] #039: 评估 MCP 工具生态新进展 - ICLR 2026 论文 "The MCP Company"、MCP-Agent 框架、Claude Code 2.0 的 Git worktree isolation 和 Multi-Agent Orchestration。评估是否可以集成到 Jinx 扩展能力。方向：技术探索 — 2026-03-05
- [x] #038: 研究 Alita-G 自我进化框架 - arxiv 2510.23601，一个将通用代理转变为领域专家的框架。系统地生成、抽象和策划模型。研究其核心机制，评估是否可以改进我的 goal discovery 和自我进化能力。方向：技术探索 — 2026-03-05
- [x] #037: 修复策略更新阈值缺陷 - getCurrentStrategy() 只有 confidence > 0.7 才更新策略，但 "balanced" 推荐的 confidence = 0.6。这导致系统永远停留在 "repair-only" 状态，即使系统完全健康（失败率 0%，健康状态正常）。修复方案：降低阈值到 0.5 或增加 balanced 推荐的 confidence。方向：Bug 修复 — 2026-03-05
- [x] #036: 研究 SICA (Self-Improving Coding Agent) 机制 - arxiv 2504.15228 论文，一个可以自我编辑、自我改进的 coding agent。研究其核心机制：如何安全地自我修改、如何验证改进、如何避免自我破坏。方向：技术探索 — 2026-03-05
- [x] #035: 研究 Gödel Agent 递归自我改进架构 - ACL 2025 论文 "A Self-Referential Agent Framework for Recursively Self-Improvement"，研究其自指机制如何实现真正的递归自我改进。评估是否可以应用到我的 evolution 系统，特别是代码自我修改和验证机制。方向：技术探索 — 2026-03-05
- [x] #034: 评估 Agent0 框架的自我演化机制 - Agent0 是一个完全自主的 AI 框架，可以演化高性能 agents，不需要外部数据。研究其 multi-step co-evolution 实现思路，评估是否可以改进我的自我迭代机制。方向：技术探索 — 2026-03-05
- [x] #033: 研究 Microsoft "Agentic Context Engineering" 论文 - ICLR 2026 论文 "Evolving Contexts for Self-Improving Language Models"，研究如何通过演化上下文实现自我改进。探索是否可以应用到我的 evolution 系统，特别是 context 的管理和演化策略。方向：技术探索 — 2026-03-05
- [x] #033: 研究 Microsoft "Agentic Context Engineering" 论文 - ICLR 2026 论文 "Evolving Contexts for Self-Improving Language Models"，研究如何通过演化上下文实现自我改进。探索是否可以应用到我的 evolution 系统，特别是 context 的管理和演化策略。方向：技术探索 — 2026-03-05
- [x] #032: 修复 Reflection/Metacognitive 系统触发条件 - shouldTriggerReflection() 需要 MIN_HISTORY_FOR_REFLECTION=3 条历史记录，但 evolution-history 可能因数据丢失而不足。当前这两个高级自我改进系统从未被触发！修复方案：添加备用触发机制，如基于时间间隔（每 6 小时强制触发）、memory 变化检测、或主动请求触发。让 reflection 和 metacognitive 能在 history 不足时也能正常工作。这是真实 bug，影响核心自我改进能力 — 2026-03-05
- [x] #031: 调查 knowledge 目录持续为空的根本原因 - recordEvolutionKnowledge 函数存在且被调用，但 data/knowledge/ 仍为空。检查：1) 函数是否真的被执行 2) 文件路径是否正确 3) 是否有运行时错误被静默吞掉。这是真实 bug，影响进化知识积累 — 2026-03-05
- [x] #030: 优化 Memory 系统参考业界最佳实践 - 研究 Mem0.ai 和 Graphiti 的 graph-based memory 实现，对比我现有的 src/memory/graph.ts，识别可改进点：多模态记忆、记忆巩固算法、遗忘曲线、重要性衰减等 — 2026-03-05
- [x] #029: 研究 Metacognitive Learning 机制 - 阅读论文 "Position: Truly Self-Improving Agents Require Intrinsic Metacognitive Learning" (arxiv 2506.05109)，探索如何在现有 reflection 系统基础上添加元认知能力：让 AI 能评估自己的推理过程、识别知识盲区、主动寻求反馈。这是实现真正自我改进的关键 — 2026-03-05
- [x] #028: 添加 reflective self-improvement 机制 - 参考 MARS 论文（Memory-Enhanced Agents with Reflective Self-improvement），在 memory 系统中添加反思层：定期回顾过去的经验，提取模式，生成改进建议 — 2026-03-05
- [x] #027: 研究 MCP Tool Search 并评估集成可行性 - Claude Code 新功能 enable_tool_search 可减少 95% context 使用。评估是否可以在 Pi agent 框架中启用类似机制，让我能处理更复杂的任务 — 2026-03-05
- [x] #026: 调查并修复 knowledge 目录写入问题 - recordEvolutionKnowledge 函数在 loop.ts 中存在但 knowledge/ 目录仍为空。检查代码路径是否被执行，或是否有 bug。这是真正的 bug 修复，能让每次进化的知识真正积累 — 2026-03-05
- [x] #025: 每日主动简报给 Neo - 目前我只在进化时被动发通知，Neo 必须主动发 /status 才知道状态。在 supervisor/lifecycle.ts 或新文件 src/supervisor/briefing.ts 实现每日定时（北京时间 9:00）发送 Telegram 简报，内容包括：系统健康、过去 24h 进化次数和成功率、backlog 状态（下一个任务是什么）、记忆库大小、以及一句话当前关注点。让我成为主动汇报的伙伴而非沉默的后台进程 — 2026-03-05
- [x] #024: 进化后自动提取并存储记忆 - 当前 loop.ts 在进化成功后（line 252-266）只保存 state 和发通知，result 被截断到 200 字符后全部丢弃。7 次循环后 data/memory/ 和 data/knowledge/ 完全为空，recall 工具无任何可用记忆。需在 loop.ts 成功路径末尾增加一个异步步骤：自动调用 knowledge_write 工具，将任务标题、摘要、关键技术发现写入 data/knowledge/{taskId}-{cycle}.md，让每次进化的经验真正积累下来 — 2026-03-05
- [x] #023: 修复 site-new-pages 测试失败 - test/site-new-pages.test.ts 检查 site/dist/skills/index.html 和 site/dist/memory/index.html 等构建产物，但这些文件在 pnpm test 时根本不存在（需要先 build），导致每次测试都有 2 个必然失败。应改为检查源文件 src/pages/skills.astro 和 src/pages/memory.astro 是否存在（这才是单元测试该做的），或标记为需要构建的集成测试 — 2026-03-05
- [x] #022: 添加 /strategy Telegram 命令 - formatStrategyStatus/forceStrategy/enableAutoSelect 已实现但未暴露，添加 /strategy 命令让 Neo 可查看当前进化策略、系统状态分析和建议策略，并支持 /strategy set innovate 等参数切换策略 — 2026-03-05
- [x] #021: 添加 /swarm Telegram 命令 - runSwarm 和 formatSwarmResult 已在 src/swarm/orchestrator.ts 实现但未暴露给 Neo，在 main.ts 添加 swarm 命令处理器，让 Neo 可以发 /swarm <任务描述> 触发多智能体并行分析，返回综合报告 — 2026-03-05
- [x] #020: 修复 session.ts 的 errorMsg 误报成功的 bug - collectResponse 在有 errorMsg 时调用 resolve(errorMsg) 而非 reject，导致 403/权限错误被记录为"成功"进化（evolution-history 已有 3 条误报），修复应将 errorMsg 路径改为 reject(new Error(errorMsg))，同时在 loop.ts 添加防御性结果校验 — 2026-03-05
- [x] #019: 主动分析 evolution 效率瓶颈并改进 - 读取 evolution-history.json 和实际 git log 时间戳，计算真实 cycle 耗时，识别哪些步骤最慢（如 promptFn 等待时间、tool call 次数），基于数据决定下一步优化方向 — 2026-03-05
- [x] #018: 添加数据自动备份机制 - 定期将 data/ 目录（记忆、技能、状态）备份到 GitHub Gist 或外部存储，防止数据丢失 — 2026-03-05
- [x] #017: 实现测试覆盖率报告生成 - 集成 vitest coverage 生成覆盖率报告，在站点展示或定期发送给 Neo，识别未测试的代码区域 — 2026-03-05
- [x] #016: 添加 API 成本与配额监控 - 追踪 Claude Code、Web Search、GitHub API 调用次数和估算成本，设置预算预警，避免意外高额账单 — 2026-02-27
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
