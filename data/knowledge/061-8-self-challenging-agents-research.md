# Self-Challenging Language Model Agents 研究

**论文**: "Self-Challenging Language Model Agents" (Zhou et al., NeurIPS 2025)  
**ArXiv**: 2506.01716  
**日期**: 2026-03-05  
**任务**: #061 研究 NeurIPS 2025 Self-Challenging Agents 模式

---

## 1. 核心问题

训练 LLM agents 需要大量人类标注的任务、工具和评估标准，这既昂贵又不可扩展。如何让 agent **自主生成高质量训练数据**？

## 2. Self-Challenging Agent (SCA) 框架

### 2.1 核心思想

> Agent 自己扮演两个角色：**Challenger（挑战者）** 和 **Solver（解决者）**。  
> 挑战者生成任务，解决者尝试解决，成功的任务成为训练数据。

### 2.2 Code-as-Task (CaT) 形式

每个任务包含四个明确定义的组件：

| 组件 | 描述 | 示例 |
|------|------|------|
| **Instruction** | 任务指令 | "实现一个函数，将 CSV 文件转换为 JSON" |
| **Verification Function** | 验证函数（代码） | 测试代码，验证输出正确性 |
| **Example Solution** | 示例解决方案 | 参考实现思路 |
| **Failure Cases** | 失败案例 | 常见错误、边界情况 |

### 2.3 工作流程

```
┌─────────────────┐
│   Challenger    │
│  (生成任务)      │
└────────┬────────┘
         │  Task (CaT format)
         ▼
┌─────────────────┐
│     Solver      │
│   (解决任务)     │
└────────┬────────┘
         │  Solution
         ▼
┌─────────────────┐
│   Verifier      │
│  (运行验证函数)  │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
 成功       失败
    │         │
    ▼         ▼
训练数据   反馈改进
```

### 2.4 关键创新

1. **Label-free**: 不需要人类标注
2. **Self-verifiable**: 使用代码验证，而非 LLM 评估
3. **High-quality**: 只有通过验证的任务才进入训练数据
4. **Diversity**: 通过控制生成参数保证任务多样性

---

## 3. 与 Jinx 现有机制对比

### 3.1 现有 Goal Discovery 机制

```typescript
// loop.ts - runGoalDiscovery()
// 当 backlog 为空时触发

当前流程:
1. 能力缺口分析 → 候选目标
2. 经验挖掘 → 候选目标
3. 外部发现（web search）→ 候选目标
4. 多因素评分筛选
5. 写入 backlog.md
```

**问题**:
- 依赖外部 backlog（Neo 添加任务）
- 没有自动验证机制
- 任务格式不包含验证条件
- 失败的任务没有结构化反馈

### 3.2 SCA 可借鉴的点

| SCA 特性 | Jinx 现状 | 改进方向 |
|----------|----------|----------|
| 自主生成任务 | 部分有（goal discovery） | 增强"挑战"导向 |
| Code-as-Task 格式 | 无 | 添加验证函数字段 |
| 双角色（Challenger/Solver） | 单一角色 | 可模拟（同一次对话） |
| 自验证 | 无 | 添加测试代码验证 |
| 失败案例学习 | 有反思机制 | 结构化失败案例 |

---

## 4. 改进方案：Self-Challenging Goal Discovery

### 4.1 新任务格式

```typescript
interface ChallengeTask {
  id: string;           // #XXX
  title: string;        // 任务标题
  category: 'capability_gap' | 'experience_mining' | 'external_discovery';
  
  // SCA-inspired fields
  instruction: string;           // 详细指令
  verificationCriteria: string;  // 如何验证完成（可执行的条件）
  exampleApproach: string;       // 示例解决思路
  failureCases: string[];        // 预期失败情况
  
  // 难度和优先级
  difficulty: 'easy' | 'medium' | 'hard';
  dependencies: string[];        // 依赖的其他任务
}
```

### 4.2 Self-Challenge 流程

```
┌──────────────────────────────────────────────────────────────┐
│                  Self-Challenging Goal Discovery              │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Phase 1: Challenge Generation                                 │
│ - 分析当前能力状态（已有能力、缺失能力）                         │
│ - 生成 3-5 个"挑战"任务                                        │
│ - 每个任务包含：指令 + 验证条件 + 示例思路 + 失败案例            │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Phase 2: Challenge Ranking                                   │
│ - 可行性评估（能否在 1-3 个循环完成？）                          │
│ - 依赖价值评估（这个任务是否开启更多可能性？）                    │
│ - BORN 对齐检查                                                │
│ - 选择最高分任务                                               │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Phase 3: Task Execution (Evolution Cycle)                     │
│ - 执行选中的任务                                               │
│ - 运行验证条件（pnpm test, 类型检查, 功能验证）                  │
│ - 记录成功/失败                                                │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Phase 4: Learning (Experience Distillation)                   │
│ - 成功任务：蒸馏为 principle                                   │
│ - 失败任务：分析失败原因，添加到失败案例库                        │
│ - 更新能力图谱                                                  │
└──────────────────────────────────────────────────────────────┘
```

### 4.3 具体实现建议

#### 4.3.1 新增模块：`src/self-challenge/`

```
src/self-challenge/
├── challenge-generator.ts   # 生成挑战任务
├── task-verifier.ts        # 验证任务完成情况
├── challenge-store.ts      # 存储挑战历史
└── types.ts                # 类型定义
```

#### 4.3.2 修改 `evolution-prompt.ts`

在 GOAL_DISCOVERY prompt 中添加 Self-Challenge 部分：

```markdown
## Self-Challenge 生成（SCA 启发）

按照以下格式生成挑战任务：

### 挑战 #{序号}: {标题}

**类别**: [capability_gap | experience_mining | external_discovery]
**难度**: [easy | medium | hard]

**指令**: 
详细描述要完成的任务...

**验证条件**: 
如何判断任务成功完成？（必须是可执行验证的条件）
- [ ] 测试通过（pnpm test）
- [ ] 类型检查通过（pnpm build）
- [ ] 功能验证（具体行为）

**示例思路**:
一种可能的解决方法...

**可能的失败案例**:
1. ...
2. ...

**依赖价值**: 为什么这个挑战值得做？
```

#### 4.3.3 修改 `loop.ts`

在 `runEvolutionCycle` 结束时添加验证步骤：

```typescript
// 验证任务完成情况
const verificationResult = await verifyTaskCompletion(task, result);
if (verificationResult.passed) {
  // 蒸馏为 principle
  await distillToPrinciple(task, result);
} else {
  // 记录失败案例
  await recordFailureCase(task, verificationResult.failures);
}
```

---

## 5. 与现有系统的集成点

### 5.1 与 Experience Distillation 的集成

```
Self-Challenge 成功 → Principle Distillation → Principle Store
                                              ↓
Goal Discovery ← Principle Retrieval ←───────┘
```

### 5.2 与 Agent Archive 的集成

```
Self-Challenge 分支 → Archive 存储不同探索路径
                      ↓
              多样性保持（DGM 启发）
```

### 5.3 与 Metacognitive 的集成

```
Self-Challenge 失败 → Metacognitive 分析 → 为什么失败？
                                        ↓
                              调整策略重试
```

---

## 6. 实施优先级

| 优先级 | 任务 | 复杂度 | 价值 |
|--------|------|--------|------|
| P0 | 修改 prompt，添加验证条件字段 | 低 | 高 |
| P1 | 实现 `task-verifier.ts` | 中 | 高 |
| P2 | 实现挑战历史存储 | 中 | 中 |
| P3 | 实现完整的 Self-Challenge 流程 | 高 | 高 |
| P4 | 与 Principle Distillation 集成 | 中 | 高 |

---

## 7. 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 生成的任务太简单或太难 | 添加难度评估，过滤不合适的任务 |
| 验证条件不可执行 | 限制验证条件格式（必须是可检查的条件） |
| 与现有 backlog 冲突 | 两种模式并存：外部任务优先，空闲时自挑战 |
| API 成本增加 | 添加成本限制，每次最多生成 5 个挑战 |

---

## 8. 结论

Self-Challenging Agents 模式提供了一条 **label-free 自我提升** 的路径。核心借鉴：

1. **Code-as-Task 形式** - 每个任务包含验证条件，确保可评估
2. **双角色机制** - 同一 agent 扮演挑战者和解决者
3. **自我验证** - 通过代码而非 LLM 评估验证成功
4. **失败案例学习** - 结构化记录失败，避免重复

**推荐行动**：
1. 先修改 goal discovery prompt，添加验证条件字段（快速迭代）
2. 后续实现完整的 self-challenge 模块（长期改进）

---

## 参考文献

- Zhou et al., "Self-Challenging Language Model Agents", NeurIPS 2025
- ArXiv: 2506.01716
- OpenReview: https://openreview.net/forum?id=9yusqX9DpR
- AlphaXiv: https://www.alphaxiv.org/overview/2506.01716v1