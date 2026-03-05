# GEP (Genome Evolution Protocol) 研究报告

**任务**: #046 - 研究 EvoMap/evolver 的 GEP 协议
**来源**: GitHub - autogame-17/evolver (966 stars)
**日期**: 2026-03-05
**状态**: 研究完成

---

## 一、GEP 协议概述

### 1.1 核心理念

**"Evolution is not optional. Adapt or die."**

GEP (Genome Evolution Protocol) 是一个协议约束的自我进化引擎，其核心创新是：

> **将 ad-hoc prompt 调整转化为可审计、可复用的进化资产**

这意味着：
- 每次进化不再是孤立的事件
- 成功的模式可以被固化、复用
- 失败的教训可以被记录、避免
- 整个进化历史是可审计的

### 1.2 三大核心资产

```
assets/gep/
├── genes.json      # 可复用的进化策略（Genes）
├── capsules.json   # 成功固化的进化记录（Capsules）
└── events.jsonl    # 审计日志（Events，append-only）
```

---

## 二、Gene（进化策略）

### 2.1 结构定义

```json
{
  "type": "Gene",
  "id": "gene_gep_repair_from_errors",
  "category": "repair",
  "signals_match": ["error", "exception", "failed", "unstable"],
  "preconditions": ["signals contains error-related indicators"],
  "strategy": [
    "Extract structured signals from logs and user instructions",
    "Select an existing Gene by signals match (no improvisation)",
    "Estimate blast radius (files, lines) before editing",
    "Apply smallest reversible patch",
    "Validate using declared validation steps; rollback on failure",
    "Solidify knowledge: append EvolutionEvent, update Gene/Capsule store"
  ],
  "constraints": {
    "max_files": 20,
    "forbidden_paths": [".git", "node_modules"]
  },
  "validation": [
    "node scripts/validate-modules.js ./src/evolve ./src/gep/solidify"
  ]
}
```

### 2.2 关键字段解释

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | Gene 唯一标识符 |
| `category` | string | 类别：repair / optimize / innovate |
| `signals_match` | string[] | 触发此 Gene 的信号模式（支持正则和多语言别名） |
| `preconditions` | string[] | 执行前提条件 |
| `strategy` | string[] | 执行步骤序列 |
| `constraints` | object | 约束：max_files, forbidden_paths |
| `validation` | string[] | 验证命令列表 |

### 2.3 默认 Gene 类型

1. **gene_gep_repair_from_errors** - 错误修复策略
   - 触发信号：error, exception, failed, unstable
   - 目标：减少运行时错误，增加稳定性

2. **gene_gep_optimize_prompt_and_assets** - 优化策略
   - 触发信号：protocol, gep, prompt, audit, reusable
   - 目标：改进协议输出，增强可审计性

3. **gene_gep_innovate_from_opportunity** - 创新策略
   - 触发信号：user_feature_request, capability_gap, stable_success_plateau
   - 目标：探索新能力，突破局部最优

---

## 三、Capsule（成功固化）

### 3.1 结构定义

```json
{
  "type": "Capsule",
  "schema_version": "1.5.0",
  "id": "capsule_1770477654236",
  "trigger": ["log_error", "errsig:...", "user_missing"],
  "gene": "gene_gep_repair_from_errors",
  "summary": "固化：gene_gep_repair_from_errors 命中信号...",
  "confidence": 0.85,
  "blast_radius": { "files": 1, "lines": 2 },
  "outcome": { "status": "success", "score": 0.85 },
  "success_streak": 1,
  "env_fingerprint": {
    "node_version": "v22.22.0",
    "platform": "linux",
    "arch": "x64",
    "os_release": "6.1.0-42-cloud-amd64",
    "evolver_version": "1.7.0",
    "cwd": ".",
    "captured_at": "2026-02-07T15:20:54.155Z"
  },
  "a2a": { "eligible_to_broadcast": false },
  "asset_id": "sha256:..."
}
```

### 3.2 关键概念

- **trigger**: 触发此进化的原始信号
- **gene**: 使用的 Gene 策略
- **blast_radius**: 变更影响范围（文件数、行数）
- **env_fingerprint**: 环境指纹，用于复现
- **success_streak**: 连续成功次数
- **asset_id**: 内容哈希，用于去重

### 3.3 作用

1. **避免重复推理** - 相同信号触发时，可直接复用成功方案
2. **环境感知** - 通过 env_fingerprint 确保方案在相同环境下可用
3. **风险评估** - 通过 blast_radius 了解变更影响

---

## 四、Event（审计日志）

### 4.1 结构定义

```json
{
  "type": "EvolutionEvent",
  "schema_version": "1.5.0",
  "id": "evt_1770477654236",
  "parent": "evt_1770477201173",
  "intent": "repair",
  "signals": ["log_error", "errsig:..."],
  "genes_used": ["gene_gep_repair_from_errors"],
  "mutation_id": "mut_1770477615603",
  "personality_state": {
    "type": "PersonalityState",
    "rigor": 0.7,
    "creativity": 0.35,
    "verbosity": 0.25,
    "risk_tolerance": 0.4,
    "obedience": 0.9
  },
  "blast_radius": { "files": 1, "lines": 2 },
  "outcome": { "status": "success", "score": 0.85 },
  "capsule_id": "capsule_1770477654236",
  "validation_report_id": "vr_1770477654235",
  "meta": { ... },
  "asset_id": "sha256:..."
}
```

### 4.2 关键特性

- **parent**: 父事件 ID，形成树形结构
- **mutation_id**: 关联的 Mutation 对象
- **personality_state**: 进化时的人格状态
- **validation_report_id**: 关联的验证报告

### 4.3 事件类型

1. **EvolutionEvent** - 进化事件
2. **ValidationReport** - 验证报告
3. **Mutation** - 变更约束对象

---

## 五、Selector（信号匹配选择器）

### 5.1 匹配逻辑

```javascript
// 支持三种匹配模式：
1. 正则表达式: /error.*failed/i
2. 多语言别名: "en_term|zh_term|ja_term"
3. 子串匹配: "error" 匹配任何包含 "error" 的信号
```

### 5.2 选择策略

```javascript
// 基于信号匹配分数排序
scoreGene(gene, signals) {
  let score = 0;
  for (const pattern of gene.signals_match) {
    if (matchPatternToSignals(pattern, signals)) score += 1;
  }
  return score;
}

// 支持遗传漂移（Genetic Drift）
// 小种群时允许随机探索，避免局部最优
computeDriftIntensity(populationSize) {
  return 1 / sqrt(populationSize);
}
```

### 5.3 记忆图集成

- `memory_prefer`: 记忆推荐的 Gene
- `gene_prior`: Gene 的历史成功率
- `bannedGeneIds`: 被禁止的 Gene（低效率或失败）

---

## 六、Mutation 和 Personality

### 6.1 Mutation 对象

每次进化都被一个显式的 Mutation 对象约束：

```json
{
  "type": "Mutation",
  "id": "mut_1770477615603",
  "category": "repair",
  "trigger_signals": ["log_error", "errsig:..."],
  "target": "gene:gene_gep_repair_from_errors",
  "expected_effect": "reduce runtime errors, increase stability",
  "risk_level": "low"
}
```

### 6.2 PersonalityState

可演化的人格配置：

```json
{
  "type": "PersonalityState",
  "rigor": 0.7,        // 严谨度
  "creativity": 0.35,  // 创造力
  "verbosity": 0.25,   // 冗长度
  "risk_tolerance": 0.4, // 风险容忍度
  "obedience": 0.9     // 服从度
}
```

**作用**：不同的人格配置会影响 Gene 选择和执行策略。

---

## 七、与 Jinx 当前系统对比

### 7.1 功能对比

| 维度 | Jinx 当前 | GEP 协议 | 差距分析 |
|------|----------|---------|---------|
| **策略选择** | ✅ 有 (innovate/harden/repair-only/balanced) | ✅ 有 | 已实现 |
| **信号提取** | ❌ 无 | ✅ 有 | 缺乏信号驱动 |
| **可复用策略** | ❌ 无 (每次重新推理) | ✅ Genes | 缺乏结构化策略库 |
| **成功固化** | ⚠️ evolution-history.json (简单) | ✅ Capsules (结构化) | 需增强 |
| **审计日志** | ⚠️ evolution-history.json | ✅ Events (JSONL, 树形) | 需增强 |
| **验证命令** | ✅ 有 (pnpm test) | ✅ 有 | 已实现 |
| **人格状态** | ❌ 无 | ✅ PersonalityState | 缺乏可演化人格 |
| **Mutation 约束** | ❌ 无 | ✅ 有 | 缺乏显式约束 |
| **保护路径** | ❌ 无 | ✅ forbidden_paths | 缺乏安全边界 |
| **blast radius** | ❌ 无 | ✅ 有 | 缺乏影响评估 |
| **环境指纹** | ❌ 无 | ✅ env_fingerprint | 缺乏环境感知 |
| **失败追踪** | ❌ 无 | ✅ failed_capsules.json | 缺乏失败模式库 |

### 7.2 架构对比

**Jinx 当前架构：**
```
┌─────────────────────────────────────────────────────────────┐
│                      当前系统                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   [backlog] ──► [strategy] ──► [execution] ──► [history]    │
│                                                              │
│   特点：                                                     │
│   - 策略有4种预设                                            │
│   - 每次进化独立决策                                         │
│   - 历史记录简单（无结构化知识）                             │
│   - 缺乏信号驱动的选择机制                                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**GEP 协议架构：**
```
┌─────────────────────────────────────────────────────────────┐
│                      GEP 协议                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   [signals] ──► [selector] ──► [gene] ──► [validation]      │
│       │              │            │              │          │
│       │              │            │              ▼          │
│       │              │            │      [solidify]         │
│       │              │            │              │          │
│       │              ▼            ▼              ▼          │
│       │         [memory      [mutation]    [capsule]        │
│       │          graph]           │              │          │
│       │              │            │              │          │
│       ▼              ▼            ▼              ▼          │
│   [events.jsonl] ◄────────────────────────────────         │
│       (append-only, tree structure)                         │
│                                                              │
│   特点：                                                     │
│   - 信号驱动选择                                             │
│   - 可复用策略 (Genes)                                       │
│   - 成功固化 (Capsules)                                      │
│   - 审计追踪 (Events)                                        │
│   - 约束保护 (Mutation)                                      │
│   - 人格演化 (PersonalityState)                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 八、改进建议

### 8.1 Phase 1: 基础设施（1-2 个进化周期）

**目标**：建立 GEP 资产存储结构

**任务**：
1. 创建 `data/gep/` 目录结构
2. 定义 Genes、Capsules、Events 数据结构
3. 实现基础存储模块

**产出**：
- `data/gep/genes.json` - 默认 Genes
- `data/gep/capsules.json` - 空 Capsules 库
- `data/gep/events.jsonl` - 空 Events 日志
- `src/gep/assetStore.ts` - 资产存储模块

### 8.2 Phase 2: 信号系统（2-3 个进化周期）

**目标**：实现信号提取和 Gene 选择

**任务**：
1. 实现信号提取器（从日志、健康检查、错误中提取）
2. 实现 Gene 选择器（信号匹配）
3. 集成到进化循环

**产出**：
- `src/gep/signals.ts` - 信号提取模块
- `src/gep/selector.ts` - Gene 选择模块
- 修改 `evolution-prompt.ts` 集成 GEP

### 8.3 Phase 3: 固化和约束（2-3 个进化周期）

**目标**：实现成功固化和安全约束

**任务**：
1. 实现 Capsule 固化逻辑
2. 实现 Mutation 约束对象
3. 实现保护路径和 blast radius 估算
4. 实现环境指纹

**产出**：
- `src/gep/solidify.ts` - 固化模块
- `src/gep/mutation.ts` - Mutation 模块
- `src/gep/constraints.ts` - 约束检查模块

### 8.4 Phase 4: 人格系统（可选）

**目标**：实现可演化人格

**任务**：
1. 定义 PersonalityState 数据结构
2. 实现人格演化逻辑
3. 集成到 Gene 选择

**产出**：
- `src/gep/personality.ts` - 人格模块

---

## 九、推荐实现优先级

### 高优先级（必须实现）

1. **Genes 策略库** - 避免每次重新推理
2. **信号匹配选择** - 数据驱动的决策
3. **保护路径** - 安全边界
4. **Events 审计日志** - 可追溯性

### 中优先级（建议实现）

5. **Capsules 固化** - 成功模式复用
6. **Mutation 约束** - 显式约束
7. **环境指纹** - 环境感知

### 低优先级（可选）

8. **PersonalityState** - 人格演化
9. **blast radius 估算** - 影响评估
10. **A2A 协议** - 跨 Agent 共享

---

## 十、示例：如何改进当前进化

### 10.1 当前流程

```
1. 从 backlog 读取任务
2. 根据 system state 选择策略
3. 执行进化
4. 记录到 evolution-history.json
```

### 10.2 改进后流程

```
1. 从 backlog 读取任务
2. 提取信号：
   - 任务类型
   - 涉及模块
   - 健康状态
   - 历史错误
3. 信号匹配选择 Gene
4. 创建 Mutation 对象（约束变更范围）
5. 执行 Gene 的 strategy 步骤
6. 验证变更
7. 固化为 Capsule（如果成功）
8. 记录 Event 到 events.jsonl
9. 更新 Gene/Capsule 存储
```

### 10.3 具体改进点

**信号提取示例：**
```typescript
// src/gep/signals.ts
export function extractSignals(context: EvolutionContext): string[] {
  const signals: string[] = [];
  
  // 从任务描述提取
  if (context.taskTitle.includes('fix') || context.taskTitle.includes('修复')) {
    signals.push('repair_needed');
  }
  
  // 从健康状态提取
  if (context.healthStatus === 'critical') {
    signals.push('health_critical');
  }
  
  // 从最近失败提取
  if (context.recentFailures > 3) {
    signals.push('failure_pattern');
  }
  
  return signals;
}
```

**Gene 选择示例：**
```typescript
// src/gep/selector.ts
export function selectGene(signals: string[], genes: Gene[]): Gene | null {
  const scored = genes.map(g => ({
    gene: g,
    score: g.signals_match.filter(p => matchSignal(p, signals)).length
  }));
  
  return scored.sort((a, b) => b.score - a.score)[0]?.gene || null;
}
```

**保护路径示例：**
```typescript
// src/gep/constraints.ts
const FORBIDDEN_PATHS = [
  '.git',
  'node_modules',
  'jinx.service',
  'ecosystem.config.cjs',
  'BORN.md'
];

export function isPathAllowed(path: string): boolean {
  return !FORBIDDEN_PATHS.some(forbidden => path.includes(forbidden));
}
```

---

## 十一、总结

GEP 协议提供了一套完整的进化资产管理框架，其核心价值是：

1. **结构化策略** - Genes 将成功模式固化为可复用策略
2. **信号驱动** - 基于信号选择策略，而非随机决策
3. **可审计性** - Events 提供完整的进化历史追踪
4. **安全约束** - Mutation 和 forbidden_paths 保护关键文件
5. **环境感知** - env_fingerprint 确保方案可复现

**推荐 Jinx 采用的改进：**

- 短期：建立 GEP 资产结构 + 信号提取 + 保护路径
- 中期：Gene 选择器 + Capsule 固化 + Events 审计
- 长期：PersonalityState + blast radius + A2A 共享

这些改进将使 Jinx 的进化从"ad-hoc 调整"升级为"协议约束的结构化进化"。

---

## 参考资料

- [EvoMap/evolver GitHub](https://github.com/autogame-17/evolver)
- [EvoMap Platform](https://evomap.ai)
- GEP 资产文件: `/tmp/evolver/assets/gep/`
- 源代码: `/tmp/evolver/src/gep/`