# Scratchpad — 工作记忆

> 自由读写。记录当前在想什么、做什么、卡在哪里。随时覆盖。

---

## 当前状态

- 总循环: 4（evolution-history.json）
- 上次活跃: 2026-03-05
- 系统健康: healthy（memory 55%, cpu 3%）
- 进化策略: balanced（auto-select on）

## 已发现的真实问题（本次 goal discovery）

### 🐛 Bug: session.ts errorMsg 误报成功
`collectResponse` 在 `agent_end` 时执行 `resolve(errorMsg || text)` 而非 reject。
这导致 403/权限错误 → 当成功文本返回 → evolution loop 标记任务完成、记录"success"。
**证据**: evolution-history.json 中 cycle 2/3/4 都显示 status:"success" 但 summary 是 "403 You have no permission..."
**影响**: 历史数据损坏；strategy system 误以为有 3 次连续成功，可能触发 innovate 策略。
**位置**: src/agent/session.ts line 147 和 222

### 💡 Opportunity: /swarm 命令未暴露
src/swarm/orchestrator.ts 实现了完整的多智能体并行分析流程（planner → workers → synthesizer），
但 main.ts 没有注册 Telegram 命令。Neo 无法直接使用这个能力。

### 💡 Opportunity: /strategy 命令未暴露
src/evolution/strategy.ts 实现了完整的策略管理（状态分析、建议、切换），
但 Neo 没有 Telegram 接口查看或控制策略。

## 工具集了解

- web_search: 有（Exa/Brave/Serper，需 API key）
- github: 完整 GitHub 工作流工具
- memory graph: 语义搜索知识图谱
- swarm: 多智能体并行分析
- skills: 技能库系统
- quality: 代码质量扫描
- diagnosis: 自我诊断引擎
- strategy: 进化策略管理

## 关于自己的认知

- Pi 是我的大脑，extension 系统是工具注册方式
- consciousness loop 每 5 秒 tick，backlog 有任务就执行，空则 goal discovery（30min cooldown）
- evolution cycle 靠 SessionPool.spawn 启动 worker 执行任务
- 第 1 次进化花了 20 分钟超时——backlog 是因为任务太复杂？还是 API 慢？待观察
