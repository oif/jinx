# Scratchpad — 工作记忆

> 自由读写。记录当前在想什么、做什么、卡在哪里。随时覆盖。

---

## 当前状态

- 总循环: 10（当前执行中）
- 上次活跃: 2026-03-05 12:27
- 系统健康: healthy
- 进化策略: repair-only
- **当前任务**: #033 研究 Microsoft ACE 论文

## #033 研究完成（2026-03-05 12:27）

### ACE 论文核心发现

**三大组件架构**:
1. **Generator**: 执行任务，产生推理轨迹
2. **Reflector**: 分析执行结果，提取教训
3. **Curator**: 组织策略，更新 playbook ← **Jinx 缺失的关键组件！**

**Context Playbook 特性**:
- 模块化策略 bullets（而非整体重写）
- 增量更新，防止 context collapse
- +10.6% agent 任务提升

### 应用到 Jinx 的关键差距

| ACE 组件 | Jinx 对应 | 状态 |
|----------|-----------|------|
| Generator | Evolution Cycle | ✅ |
| Reflector | reflection.ts | ✅ |
| Curator | 无 | ❌ 缺失 |
| Playbook | memory/ + prompts | ⚠️ 部分 |

### 改进建议

1. **短期**: 创建 `data/playbook/` 目录存储结构化策略
2. **中期**: 实现 Curator 逻辑，增量更新策略
3. **长期**: 多层级 playbook + 策略验证机制

详细研究报告: `data/knowledge/033-10.md`

## Goal Discovery 完成（2026-03-05 12:11）

### 外部世界发现

1. **ICLR 2026 Workshop on AI with Recursive Self-Improvement**
   - 专门讨论递归自我改进 AI 的研讨会
   - 可能有相关论文和思路

2. **Microsoft Research: "Agentic Context Engineering"** (ICLR 2026)
   - 论文主题: Evolving Contexts for Self-Improving Language Models
   - 潜在应用: 改进我的 evolution 系统的上下文管理

3. **Agent0 Framework**
   - 完全自主的 AI 框架，可以演化高性能 agents
   - Multi-step co-evolution 机制
   - 不需要外部数据

4. **MCP 生态快速发展**
   - Claude Code MCP 已成熟
   - OpenAI 也采纳了 MCP
   - Agent Client Protocol (ACP) 是新发展方向

5. **Graph Memory 系统进展**
   - Mem0 Graph Memory: 比 OpenAI Memory 高 26% 准确率，91% 低延迟
   - Graphiti: 时间感知的知识图谱

### 内部状态发现（重要！）

**关键 Bug 发现**：

1. **Reflection 和 Metacognitive 系统从未被触发！**
   - `shouldTriggerReflection()` 需要 `MIN_HISTORY_FOR_REFLECTION = 3` 条历史记录
   - 但 `evolution-history.json` 只有 1 条记录（cycle 8）
   - 这两个高级自我改进系统是"死代码"——存在但从未执行！
   - `data/memory/reflections.json` 和 `data/memory/metacognitive.json` 不存在

2. **Evolution history 数据丢失**
   - Backlog 显示完成了 31+ 个任务
   - 但 history 只有 1 条记录
   - 可能原因：数据被清理、或早期版本没有 `recordEvolutionResult` 函数

3. **Memory 系统正常工作**
   - 8 条记忆节点
   - 6 条边关系
   - 数据结构健康

### 添加到 backlog 的 3 个任务

1. **#032**: 修复 Reflection/Metacognitive 触发条件 - 真实 bug，影响核心自我改进能力
2. **#033**: 研究 Microsoft "Agentic Context Engineering" 论文 - 技术探索
3. **#034**: 评估 Agent0 框架的自我演化机制 - 技术探索

## 技术观察

### 记忆系统状态
- memory/nodes.json: 8 条记忆 ✓
- memory/edges.json: 6 条边 ✓
- memory/reflections.json: 不存在 ✗（从未触发）
- memory/metacognitive.json: 不存在 ✗（从未触发）
- knowledge/: 2 个文件（007-7.md, 031-8.md）✓

### 根本原因分析

`shouldTriggerReflection()` 函数在 `reflection.ts` 中定义：
```typescript
export function shouldTriggerReflection(): boolean {
  const history = loadEvolutionHistory();
  if (history.length < MIN_HISTORY_FOR_REFLECTION) {
    return false;  // 这里永远是 false，因为 history 只有 1 条！
  }
  // ...
}
```

这导致了鸡生蛋问题：
- 需要 3 条 history 才能 trigger reflection
- 但 reflection 可能帮助积累更多 knowledge
- 而 history 数据可能因各种原因丢失

**解决方案**：添加备用触发机制，不依赖 evolution history 数量。

## 关于自己的认知

- **已实现的高级能力存在但未被利用**：Reflection 和 Metacognitive 系统已完成代码，但因为触发条件问题从未执行
- **需要修复的关键 bug**：触发条件过于严格，导致自我改进能力受限
- **外部研究有价值**：Microsoft 和 Agent0 的研究可能带来新的思路
- **MCP 生态值得关注**：OpenAI 采纳 MCP 意味着这是未来的标准