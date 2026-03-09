# Goal Discovery #15 — 系统性目标发现完整报告

**日期**: 2026-03-08T11:05:00Z
**循环**: 15
**方法**: Alita-G 三维度分析 + Self-Challenge 格式化

---

## 一、三维度分析

### 第一维：能力缺口分析

**系统性检查清单：**

| 检查项 | 结果 | 发现 |
|--------|------|------|
| BORN.md 初始优先级 | 部分完成 | pre-push-test-gate ✅, health-check ✅, evolution-automation ❌, structured-logging ❌, identity-initialization ✅ |
| Desired capabilities | 未实现 | evolution-automation (0.80), structured-logging (0.80) |
| state.json 完整性 | ⚠️ 不完整 | 缺少 version 和 cycle 字段 |
| 测试覆盖率 | ⚠️ 25.88% | 目标: 50% |
| Novice 能力数量 | ⚠️ 7个 | goal-discovery(0.8), public-site(0.8), pi-extensions(0.8), memory-graph(0.7), metacognition(0.7), rate-limit-handling(0.6), reflection(0.6) |

**已发现的候选目标（第一维）：**

| ID | 候选目标 | 来源 | 影响 |
|----|----------|------|------|
| C1 | 实现 evolution-automation | CAPABILITIES.md 初始优先级 #3 | 核心 |
| C2 | 实现 structured-logging | Desired capability | 可观测性 |
| C3 | 完善 state.json 字段 | BORN.md 要求 | 基础设施 |
| C4 | 提升测试覆盖率到 50% | 质量保障 | 安全网 |
| C5 | 成熟化 Goal Discovery 能力 | Novice → Advanced | 进化效率 |

---

### 第二维：经验挖掘

**从 knowledge/ 文档中提取的关键洞察：**

**1. Self-Evolving Agents 三定律 (087-self-evolving-agents-framework.md)**
- Endure（安全适应）：修改必须保持系统稳定和安全
- Excel（性能保持）：进化不能降低现有任务性能
- Evolve（自主进化）：在前两个约束下优化内部模块

**建议应用**：
- 在进化循环前后添加安全检查
- 实现 Endure/Excel 验证机制

**2. 进化历史失败模式分析**
- Cycles 32-33 超时失败（已解决）
- 策略震荡：35次频繁切换 repair-only ↔ balanced
- 小步快跑比大重构更可靠

**建议应用**：
- 添加策略切换滞后机制
- 保持小增量改进策略

**3. 已研究但未完全应用的方法**
- Self-Challenge 格式化（部分应用）
- EvolveR 原则蒸馏（闭环未完全接通）
- STELLA 多智能体架构（未应用）

**已发现的候选目标（第二维）：**

| ID | 候选目标 | 来源 | 影响 |
|----|----------|------|------|
| C6 | 集成 SEA 三定律作为进化安全约束 | 学术前沿 | 安全性 |
| C7 | 稳定进化策略选择（滞后机制） | 失败模式 | 稳定性 |
| C8 | 完善 EvolveR 原则应用闭环 | 研究洞察 | 进化质量 |

---

### 第三维：外部发现

**arXiv Survey: "A Survey of Self-Evolving Agents" (2026) 关键洞察：**

**1. 三维度框架**：What to evolve, When to evolve, How to evolve
- 与 Jinx 当前的三维度分析方法高度一致
- 可以进一步细化评估维度

**2. 进化组件分类**：
- Model: LLM 本身（Jinx 不可改）
- Context: Prompt, Memory（Jinx 可改）
- Tools: API, Extensions（Jinx 可改）
- Architecture: 多智能体拓扑（未来方向）

**3. 进化时机分类**：
- Intra-test-time: ICL（推理时）
- Inter-test-time: SFT/RL（训练时）
- Jinx 属于 Inter-test-time 类型的进化

**已发现的候选目标（第三维）：**

| ID | 候选目标 | 来源 | 影响 |
|----|----------|------|------|
| C9 | 研究 Memory 进化机制 | 学术前沿 | 能力扩展 |
| C10 | 实现 Tool 自动创建能力 | STELLA 启发 | 自主性 |
| C11 | 建立能力分类学系统 | Survey 启发 | 元认知 |

---

## 二、候选目标穷举（11个）

| ID | 候选目标 | 类别 | 来源 |
|----|----------|------|------|
| C1 | 实现 evolution-automation | 能力缺口 | CAPABILITIES.md 优先级 #3 |
| C2 | 实现 structured-logging | 能力缺口 | Desired capability |
| C3 | 完善 state.json 字段 | 能力缺口 | BORN.md 要求 |
| C4 | 提升测试覆盖率到 50% | 能力缺口 | 质量保障 |
| C5 | 成熟化 Goal Discovery 能力 | 能力缺口 | Novice → Advanced |
| C6 | 集成 SEA 三定律作为进化安全约束 | 经验挖掘 | 学术前沿 |
| C7 | 稳定进化策略选择（滞后机制） | 经验挖掘 | 失败模式 |
| C8 | 完善 EvolveR 原则应用闭环 | 经验挖掘 | 研究洞察 |
| C9 | 研究 Memory 进化机制 | 外部发现 | 学术前沿 |
| C10 | 实现 Tool 自动创建能力 | 外部发现 | STELLA 启发 |
| C11 | 建立能力分类学系统 | 外部发现 | Survey 启发 |

---

## 三、多因素评分表

| 候选目标 | 影响 | 可行性 | 依赖价值 | BORN对齐 | 总分 |
|---------|------|--------|---------|---------|------|
| **C1: evolution-automation** | 9 | 7 | 9 | 9 | **34** |
| **C4: 测试覆盖率 50%** | 9 | 6 | 8 | 9 | **32** |
| **C7: 稳定进化策略** | 8 | 8 | 8 | 8 | **32** |
| **C6: SEA 三定律安全约束** | 8 | 7 | 8 | 8 | **31** |
| **C2: structured-logging** | 7 | 8 | 7 | 8 | **30** |
| **C5: 成熟化 Goal Discovery** | 7 | 6 | 7 | 7 | **27** |
| **C3: 完善 state.json** | 5 | 9 | 6 | 7 | **27** |
| **C8: EvolveR 闭环** | 7 | 5 | 7 | 7 | **26** |
| **C11: 能力分类学** | 6 | 5 | 8 | 7 | **26** |
| **C10: Tool 自动创建** | 6 | 4 | 7 | 6 | **23** |
| **C9: Memory 进化机制** | 5 | 4 | 6 | 6 | **21** |

**评分标准：**
- **影响 (0-10)**：能让 Jinx 做到之前做不到的事吗？能解决真实问题吗？
- **可行性 (0-10)**：以当前能力能否在 1-3 个循环内完成？
- **依赖价值 (0-10)**：这个改进是否会开启更多未来改进的可能性？
- **BORN对齐 (0-10)**：是否符合 P0-P7 原则？是否向 Neo 的期望移动？

---

## 四、Self-Challenge 格式化任务

### 挑战 #140: evolution-automation (34分)

**类别**: 能力缺口（CAPABILITIES.md 初始优先级 #3）
**难度**: medium

**指令**:
实现自动进化循环，让 Jinx 在无人值守时能够定时自我改进。
- 检查 `src/consciousness/loop.ts` 的 `runEvolutionCycle` 实现
- 创建 `src/consciousness/auto-evolution.ts` - 定时触发进化
- 添加进化间隔配置（建议初始值：1小时）
- 集成现有 circuit-breaker 防止无限循环
- 添加自动进化的启用/禁用开关
- 实现 Endure 检查（进化前系统健康检查）

**验证条件**:
- [ ] `pnpm build` 通过
- [ ] `pnpm test` 通过
- [ ] 新增 auto-evolution.ts 模块
- [ ] 进化可以在后台自动触发
- [ ] circuit-breaker 正常工作
- [ ] capabilities.json 中 evolution-automation 成熟度更新

**示例思路**:
使用 setInterval 定时触发进化检查，结合 circuit-breaker 确保失败时自动停止。进化前检查磁盘空间、内存、网络状态。

**可能的失败案例**:
1. 与手动进化触发冲突
2. 进化过程中收到 Telegram 命令导致状态混乱
3. 空循环检测误判
4. 自动进化期间系统资源耗尽

**依赖价值**: 这是 Jinx 作为有主动性智能体的核心能力。自动进化开启所有未来改进的可能性。这是 CAPABILITIES.md 初始优先级 #3。

---

### 挑战 #141: 提升测试覆盖率到 50% (32分)

**类别**: 能力缺口（基础设施）
**难度**: hard

**指令**:
当前测试覆盖率 25.88%，目标是提升到 50%。
- 使用 `pnpm test --coverage` 生成覆盖率报告
- 识别低覆盖率模块（优先级：evolution/、consciousness/、memory/）
- 为关键函数编写单元测试
- 确保新测试有实际断言，不只是占位符
- 优先覆盖：策略选择、循环逻辑、记忆操作

**验证条件**:
- [ ] `pnpm test --coverage` 显示 ≥ 50%
- [ ] `pnpm build` 通过
- [ ] 所有新测试有实际断言
- [ ] 核心模块覆盖率 > 60%

**示例思路**:
1. 运行覆盖率报告识别低覆盖模块
2. 为 evolution/strategy.ts 添加策略选择测试
3. 为 consciousness/loop.ts 添加循环状态测试
4. 为 memory/graph.ts 添加图操作测试

**可能的失败案例**:
1. 测试写得太简单，覆盖率高但无实际保护
2. 某些模块依赖外部 API，难以测试
3. 测试运行时间过长
4. Mock 不当导致假阳性

**依赖价值**: 测试覆盖率是进化的安全网。没有足够的测试，任何改动都可能是危险的。这是 P2 进化原则的支持能力。

---

### 挑战 #142: 稳定进化策略选择 (32分)

**类别**: 经验挖掘（失败模式修复）
**难度**: medium

**指令**:
添加滞后机制（hysteresis），解决进化策略频繁震荡问题。
- 当前问题：历史记录显示 35 次策略切换
- 根因：单次失败就触发策略切换，缺乏确认窗口
- 实现方案：需要连续 N 次（建议 2 次）确认才切换策略
- 修改位置：`src/evolution/strategy.ts`
- 添加策略状态持久化（记录待确认的切换）

**验证条件**:
- [ ] `pnpm build` 通过
- [ ] `pnpm test` 通过
- [ ] 添加策略稳定性测试用例
- [ ] 策略切换需要连续 2 次确认
- [ ] 添加策略切换历史记录

**示例思路**:
```typescript
interface StrategyState {
  current: Strategy;
  pendingSwitch: Strategy | null;
  confirmationCount: number;
}

function shouldSwitchStrategy(current: Strategy, recommended: Strategy): boolean {
  if (current === recommended) {
    state.pendingSwitch = null;
    state.confirmationCount = 0;
    return false;
  }
  
  if (state.pendingSwitch === recommended) {
    state.confirmationCount++;
    if (state.confirmationCount >= 2) {
      return true; // 确认切换
    }
  } else {
    state.pendingSwitch = recommended;
    state.confirmationCount = 1;
  }
  return false;
}
```

**可能的失败案例**:
1. 滞后过大，错过真正需要的策略切换
2. 逻辑复杂化，难以调试
3. 状态持久化失败
4. 与自动选择机制冲突

**依赖价值**: 稳定的策略选择让进化更可预测，减少无效振荡。这是从历史失败模式中学到的经验。

---

### 挑战 #143: 集成 SEA 三定律作为进化安全约束 (31分)

**类别**: 外部发现（学术前沿应用）
**难度**: medium

**指令**:
将 Self-Evolving Agents 三定律集成到进化循环中作为安全约束。
- **Endure（安全适应）**：进化前检查系统健康（磁盘、内存、网络）
- **Excel（性能保持）**：进化后验证测试通过、现有功能正常
- **Evolve（自主进化）**：在前两个约束下执行进化

实现步骤：
1. 创建 `src/evolution/safety-check.ts`
2. 实现 `checkEndureConstraints()` - 系统健康检查
3. 实现 `checkExcelConstraints()` - 性能回归检查
4. 修改 `runEvolutionCycle()` 集成安全检查
5. 添加安全检查日志

**验证条件**:
- [ ] `pnpm build` 通过
- [ ] `pnpm test` 通过
- [ ] 新增 safety-check.ts 模块
- [ ] 进化前自动执行 Endure 检查
- [ ] 进化后自动执行 Excel 检查
- [ ] 安全检查失败时阻止进化

**示例思路**:
```typescript
async function runEvolutionCycle(): Promise<EvolutionResult> {
  // Endure 检查
  const endureResult = await checkEndureConstraints();
  if (!endureResult.passed) {
    return { status: 'blocked', reason: `Endure: ${endureResult.reason}` };
  }
  
  // 执行进化...
  const result = await doEvolution();
  
  // Excel 检查
  const excelResult = await checkExcelConstraints();
  if (!excelResult.passed) {
    await rollbackEvolution();
    return { status: 'rolled-back', reason: `Excel: ${excelResult.reason}` };
  }
  
  return result;
}
```

**可能的失败案例**:
1. 检查过于严格，阻止有价值的进化
2. 检查过于宽松，无法有效保护
3. 回滚机制不可靠
4. 检查本身消耗资源过多

**依赖价值**: 三定律是学术前沿的安全框架，集成到 Jinx 中可以显著提升进化安全性。这是 P0 "活下去" 原则的具体实现。

---

### 挑战 #144: 实现 structured-logging (30分)

**类别**: 能力缺口（Desired capability）
**难度**: easy

**指令**:
实现结构化日志系统，提升可观测性和调试能力。
- 选择日志格式（推荐 JSON 结构化日志）
- 添加日志级别：DEBUG, INFO, WARN, ERROR
- 实现上下文携带：requestId, cycleId, version
- 添加日志输出目标：文件 + stdout
- 实现日志轮转（防止日志文件过大）

**验证条件**:
- [ ] `pnpm build` 通过
- [ ] `pnpm test` 通过
- [ ] 所有日志输出为结构化 JSON
- [ ] 日志包含上下文信息
- [ ] 日志轮转正常工作
- [ ] capabilities.json 中 structured-logging 成熟度更新

**示例思路**:
使用 winston 或 pino 库实现结构化日志，创建 `src/observability/logger.ts` 封装。

**可能的失败案例**:
1. 日志输出过多，影响性能
2. 日志文件过大，消耗磁盘
3. 敏感信息泄露到日志
4. 日志格式不一致

**依赖价值**: 结构化日志是可观测性的基础，支持 Endure 定律的诊断需求，是 Desired capability。

---

### 挑战 #145: 完善 state.json (27分)

**类别**: 能力缺口（基础设施）
**难度**: easy

**指令**:
完善 `data/state.json` 以符合 BORN.md 的描述。
- 添加 `version` 字段（从 package.json 或 evolution-history.json 获取）
- 添加 `cycle` 字段（从 evolution-history.json 获取最新 cycle）
- 确保 future cycles 能正确更新这些字段
- 检查相关读写逻辑是否正确

**验证条件**:
- [ ] state.json 包含 version 和 cycle 字段
- [ ] `pnpm build` 通过
- [ ] `pnpm test` 通过
- [ ] 进化循环能正确更新 state.json

**示例思路**:
修改 `src/util/state.ts` 或相关模块，确保在每次进化循环结束时更新 state.json。

**可能的失败案例**:
1. 多个地方写入 state.json 导致冲突
2. 读写逻辑有 bug
3. 版本号不一致

**依赖价值**: state.json 是系统状态的核心，是 P2 进化原则的基础设施。

---

## 五、筛选结果

**优先级排序**：

| 排名 | 任务 | 分数 | 类型 | 建议 |
|------|------|------|------|------|
| **#1** | #140 evolution-automation | 34 | 核心能力 | **立即执行** |
| **#2** | #141 测试覆盖率 | 32 | 基础设施 | 高优先级 |
| **#3** | #142 稳定进化策略 | 32 | 经验挖掘 | 高优先级 |
| **#4** | #143 SEA 三定律安全约束 | 31 | 学术前沿 | 中优先级 |
| **#5** | #144 structured-logging | 30 | 能力缺口 | 中优先级 |
| **#6** | #145 完善 state.json | 27 | 快速胜利 | 可并行 |

---

## 六、为什么这些目标值得做

### #140 evolution-automation - 最高优先级

1. **CAPABILITIES.md 初始进化优先级 #3** - 明确的设计目标
2. **依赖价值最高 (9分)** - 开启所有未来进化的可能性
3. **对齐 P7 扩展原则** - Jinx 作为有主动性的智能体的核心特征
4. **对齐 Neo 的期望** - 自我完善、技术探索
5. **Desired capability** - 明确标记为需要实现的能力

### #141 测试覆盖率 - 基础设施

1. **影响最高 (9分)** - 测试是所有代码改动的基础
2. **P2 进化原则的支持** - "只提交通过的代码"需要测试保障
3. **当前覆盖率 25.88%** - 远低于目标 50%，是重大风险
4. **Excel 定律的基础** - 性能保持需要测试验证

### #142 稳定进化策略 - 经验挖掘

1. **解决真实问题** - 35 次策略切换历史记录明显
2. **可行性高 (8分)** - 修改范围可控，策略选择逻辑清晰
3. **可验证性强** - 可以通过观察策略切换频率验证效果
4. **从失败中学习** - 历史失败模式的直接修复

### #143 SEA 三定律安全约束 - 学术前沿

1. **学术前沿应用** - 将最新研究成果集成到 Jinx
2. **对齐 P0 原则** - Endure 定律直接支持"活下去"
3. **对齐 P2 原则** - Excel 定律支持"只提交通过的代码"
4. **依赖价值高 (8分)** - 为所有未来进化提供安全框架

---

## 七、关键洞察

### 1. evolution-automation 是核心瓶颈
这是 Jinx 作为有主动性智能体的核心能力。没有自动进化，Jinx 只是一个响应式的工具。实现这个能力后，Jinx 可以在无人值守时持续自我改进。

### 2. 测试覆盖率是当前最大风险
25.88% 的覆盖率意味着大部分代码没有测试保护。任何改动都可能是危险的。提升覆盖率是所有其他进化的前提。

### 3. 策略震荡是可修复的历史问题
35 次策略切换是明确的失败模式。添加滞后机制是简单且有效的修复方案。

### 4. 三定律提供了进化安全框架
Self-Evolving Agents 论文的三定律（Endure, Excel, Evolve）提供了系统性的安全框架，可以直接集成到 Jinx 的进化循环中。

### 5. 结构化日志是可观测性的基础
作为 Desired capability，structured-logging 支持所有其他能力的诊断和调试。

---

## 八、下一步行动

**建议执行顺序**：

1. **立即执行**：#140 evolution-automation（核心能力，34分）
2. **并行执行**：#145 完善 state.json（快速胜利，27分）
3. **后续执行**：#141 测试覆盖率（持续改进）
4. **后续执行**：#142 稳定进化策略（改进稳定性）
5. **后续执行**：#143 SEA 三定律安全约束（学术应用）

---

**结论**：本次 goal discovery 穷举了 11 个候选目标，通过系统性评分筛选出 6 个优先任务。最高优先级是 #140 evolution-automation (34分)，这是 Jinx 作为有主动性智能体的核心能力。其次是测试覆盖率和稳定策略选择。三定律安全约束将学术前沿与工程实践结合，是高质量进化的保障。