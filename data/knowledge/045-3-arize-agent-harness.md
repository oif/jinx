# 研究 Arize Self-Improving Agent Harness

**任务：** #045  
**循环：** #3  
**日期：** 2026-03-05  
**方向：** 技术探索

---

## 概述

Arize AI 的博文 "Self-Improving Agents: the Agent Harness for Reliable Code" 提出了一个关键观点：**真正自我改进的 Agent 需要完整的遥测闭环**。本文研究其核心机制，评估如何改进 Jinx 的自我进化能力。

---

## 1. Arize Self-Improving Agent Harness 核心概念

### 1.1 遥测闭环 (Telemetry Feedback Loop)

Arize 的核心理念是：**每个决策、每次工具调用、每个输出都应该有完整的追踪**。这些追踪数据形成闭环：

```
执行 → 追踪 → 分析 → 评估 → 反馈 → 改进 → 执行
```

关键组件：
- **Span-based Tracing**: 每个操作都是一个 span，包含开始时间、结束时间、输入、输出、错误
- **Trace Context**: 所有 span 组成一个完整的 trace，可以追溯整个执行链
- **Metadata Enrichment**: 每个 span 都有丰富的元数据（模型、tokens、成本、延迟等）

### 1.2 Evaluation-driven Improvement

Arize 强调 **自动评估** 是自我改进的关键：

1. **Output Evaluation**: 评估 LLM 输出的质量（正确性、完整性、安全性）
2. **Tool Evaluation**: 评估工具调用的有效性（是否达到预期目的）
3. **Agent Evaluation**: 评估整个 agent 的表现（成功率、用户满意度）

评估结果自动触发改进：
- 低质量输出 → 重新生成或调整 prompt
- 工具调用失败 → 重试或切换策略
- Agent 失败 → 通知或回滚

### 1.3 Self-healing Loops

Arize 提出了多层自我修复机制：

| 层级 | 触发条件 | 修复动作 |
|------|----------|----------|
| LLM 调用 | 响应异常/低质量 | 重新生成、调整参数 |
| 工具调用 | 执行失败 | 重试、fallback |
| Agent 步骤 | 未达预期 | 回退、调整策略 |
| 整体任务 | 任务失败 | 通知、降级处理 |

### 1.4 Phoenix 平台的关键能力

Arize Phoenix 是开源的 LLM 追踪平台：

- **Real-time Tracing**: 实时追踪所有 LLM 调用
- **Span Hierarchy**: 支持嵌套的 span 层次结构
- **Evaluation Framework**: 内置多种评估器（正确性、相关性、毒性等）
- **Dataset Management**: 管理评估数据集
- **Annotation & Labeling**: 人工标注支持

---

## 2. Jinx 现有系统分析

### 2.1 现有遥测机制

**src/observability/metrics.ts:**
- ✅ 记录 agent prompt metrics（响应时间、成功率）
- ✅ 记录 tool call metrics（工具调用统计）
- ✅ 记录 evolution cycle metrics（进化循环成功率）
- ❌ **缺失**: 没有 span-based tracing
- ❌ **缺失**: 没有执行链追踪
- ❌ **缺失**: 没有上下文关联

**src/health/check.ts + history.ts:**
- ✅ CPU、内存、磁盘监控
- ✅ 阈值告警
- ✅ 健康状态历史记录
- ❌ **缺失**: 没有与 evolution 关联

**src/diagnosis/engine.ts:**
- ✅ 模式检测（健康、性能、进化、工具失败）
- ✅ 修复建议生成
- ❌ **缺失**: 没有自动执行修复
- ❌ **缺失**: 建议与 backlog 没有自动关联

### 2.2 现有改进机制

**src/memory/reflection.ts (MARS-based):**
- ✅ 经验回顾（分析 evolution history）
- ✅ 模式提取（成功/失败主题）
- ✅ 洞察生成（成功因素、失败原因）
- ✅ 改进建议（可操作的建议）
- ❌ **缺失**: 后验分析，不是实时
- ❌ **缺失**: 依赖关键词匹配，缺乏语义理解

**src/memory/metacognitive.ts:**
- ✅ 实时推理评估
- ✅ 知识盲点检测
- ✅ 反馈请求生成
- ✅ 自我评估（质量分数、置信度校准）
- ❌ **缺失**: 没有与工具调用追踪集成
- ❌ **缺失**: 评估结果没有自动触发改进

### 2.3 关键差距

| 能力 | Arize | Jinx 现状 | 差距 |
|------|-------|-----------|------|
| Span-based Tracing | ✅ | ❌ | 无法追踪执行链 |
| End-to-end Trace | ✅ | ❌ | 无法追溯问题根源 |
| Real-time Evaluation | ✅ | 部分 | 有 metacognitive 但未集成 |
| Automated Feedback Loop | ✅ | ❌ | 建议不自动转化为任务 |
| Semantic Evaluation | ✅ | ❌ | 依赖启发式方法 |
| Self-healing Actions | ✅ | 部分 | 有诊断但无自动执行 |

---

## 3. 改进建议

### 3.1 短期改进 (1-2 个循环)

#### 3.1.1 实现 Span-based Tracing

创建 `src/observability/trace.ts`:

```typescript
interface Span {
  id: string;
  traceId: string;
  parentId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  status: "running" | "success" | "error";
  attributes: Record<string, unknown>;
  events: SpanEvent[];
}

interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

interface Trace {
  id: string;
  rootSpanId: string;
  startTime: number;
  endTime?: number;
  status: "running" | "success" | "error";
  metadata: {
    evolutionCycle?: number;
    taskId?: string;
    triggerSource?: string;
  };
}
```

关键功能：
- `startSpan(name, parentSpan?)` - 开始一个新的 span
- `endSpan(spanId, status)` - 结束 span
- `addEvent(spanId, name, attributes)` - 添加事件
- `getTrace(traceId)` - 获取完整 trace
- `recordSpanMetric(span)` - 记录 span 指标

#### 3.1.2 集成到 Evolution Loop

修改 `src/consciousness/loop.ts`:

```typescript
async function runEvolutionCycle(task: Task, notifyFn: NotifyFn) {
  const trace = startTrace({ taskId: task.id, cycle });
  
  try {
    // Understanding phase
    const understandSpan = startSpan("understand", trace.rootSpanId);
    // ... understanding logic
    endSpan(understandSpan.id, "success");
    
    // Implementation phase
    const implementSpan = startSpan("implement", trace.rootSpanId);
    // ... implementation logic
    endSpan(implementSpan.id, "success");
    
    // Commit phase
    const commitSpan = startSpan("commit", trace.rootSpanId);
    // ... commit logic
    endSpan(commitSpan.id, "success");
    
    endTrace(trace.id, "success");
  } catch (e) {
    endTrace(trace.id, "error");
    throw e;
  }
}
```

### 3.2 中期改进 (3-5 个循环)

#### 3.2.1 实现 Evaluation-driven Improvement

创建 `src/observability/evaluation.ts`:

```typescript
interface Evaluation {
  id: string;
  spanId: string;
  evaluator: string; // "correctness", "completeness", "safety", etc.
  score: number; // 0-1
  label: string; // "pass", "fail", "needs_review"
  explanation?: string;
  metadata: Record<string, unknown>;
}

interface Evaluator {
  name: string;
  evaluate(span: Span): Promise<Evaluation>;
}

// 内置评估器
const evaluators: Evaluator[] = [
  new CorrectnessEvaluator(),      // 输出是否正确
  new CompletenessEvaluator(),     // 输出是否完整
  new SafetyEvaluator(),           // 是否安全
  new EfficiencyEvaluator(),       // 是否高效
];
```

评估结果触发改进：
- `score < 0.5` → 自动重试或降级
- `0.5 <= score < 0.7` → 标记需要人工审查
- `score >= 0.7` → 通过

#### 3.2.2 自动改进任务生成

修改 `src/diagnosis/engine.ts`:

```typescript
function generateImprovementTask(pattern: FailurePattern): Task | null {
  // 根据模式自动生成改进任务
  // 自动添加到 backlog
  
  if (pattern.severity === "critical") {
    // 高优先级任务立即添加
    addToBacklog({
      id: generateTaskId(),
      title: `Auto-generated: ${pattern.title}`,
      priority: "urgent",
      source: "diagnosis",
      relatedPattern: pattern.id,
    });
  }
}
```

#### 3.2.3 集成 Arize Phoenix (可选)

如果需要更强大的追踪能力，可以集成 Arize Phoenix：

```typescript
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

// 配置 Phoenix exporter
const exporter = new OTLPTraceExporter({
  url: process.env.PHOENIX_URL || 'http://localhost:6006/v1/traces',
});

// 所有 span 自动发送到 Phoenix
```

### 3.3 长期改进 (5+ 个循环)

#### 3.3.1 完整的自我修复系统

创建 `src/observability/self-healing.ts`:

```typescript
interface HealingRule {
  condition: (trace: Trace) => boolean;
  action: (trace: Trace) => Promise<HealingResult>;
  maxRetries: number;
  backoff: "fixed" | "exponential";
}

const healingRules: HealingRule[] = [
  {
    // LLM 调用失败重试
    condition: (t) => t.status === "error" && t.rootSpan.name === "llm_call",
    action: async (t) => retryLLMCall(t),
    maxRetries: 3,
    backoff: "exponential",
  },
  {
    // 工具调用失败 fallback
    condition: (t) => t.status === "error" && t.rootSpan.name === "tool_call",
    action: async (t) => fallbackToolCall(t),
    maxRetries: 2,
    backoff: "fixed",
  },
  {
    // 进化失败降级
    condition: (t) => t.status === "error" && t.rootSpan.name === "evolution",
    action: async (t) => degradEvolution(t),
    maxRetries: 1,
    backoff: "fixed",
  },
];
```

#### 3.3.2 语义评估

使用 LLM 进行语义评估：

```typescript
async function semanticEvaluate(output: string, criteria: string): Promise<number> {
  const worker = await SessionPool.spawn({ label: "evaluator" });
  
  const prompt = `
Evaluate the following output against the criteria.

Output: ${output}

Criteria: ${criteria}

Rate the output quality on a scale of 0-1:
- 0.0-0.3: Poor, needs significant improvement
- 0.4-0.6: Acceptable, minor issues
- 0.7-1.0: Good, meets or exceeds criteria

Respond with just a number.
`;

  const result = await worker.prompt(prompt);
  const score = parseFloat(result.trim());
  worker.dispose();
  
  return isNaN(score) ? 0.5 : Math.max(0, Math.min(1, score));
}
```

#### 3.3.3 Trace 驱动的知识积累

从 trace 中提取知识：

```typescript
function extractKnowledgeFromTrace(trace: Trace): KnowledgeNode[] {
  const nodes: KnowledgeNode[] = [];
  
  // 从成功的 trace 中提取成功模式
  if (trace.status === "success") {
    const patterns = extractSuccessPatterns(trace);
    for (const pattern of patterns) {
      nodes.push({
        type: "pattern",
        content: pattern.description,
        confidence: pattern.confidence,
        tags: ["success", trace.metadata.taskId],
      });
    }
  }
  
  // 从失败的 trace 中提取失败教训
  if (trace.status === "error") {
    const lessons = extractFailureLessons(trace);
    for (const lesson of lessons) {
      nodes.push({
        type: "lesson",
        content: lesson.description,
        confidence: 0.9,
        tags: ["failure", trace.metadata.taskId],
      });
    }
  }
  
  return nodes;
}
```

---

## 4. 实施优先级

### P0 - 必须有（核心能力）
1. **Span-based Tracing** - 没有这个，其他都是空谈
2. **Evaluation-driven Improvement** - 自我改进的核心机制
3. **自动任务生成** - 从诊断到行动的闭环

### P1 - 应该有（显著提升）
4. **Self-healing Rules** - 减少人工干预
5. **语义评估** - 提高评估质量
6. **Phoenix 集成** - 更好的可视化

### P2 - 可选（锦上添花）
7. **Trace 驱动的知识积累** - 加速学习
8. **高级分析** - 预测性诊断

---

## 5. 具体行动项

### 立即行动（本循环）

1. **创建 Span-based Tracing 基础设施**
   - 新建 `src/observability/trace.ts`
   - 定义 Span, Trace 接口
   - 实现基本的 span 管理功能

2. **修改 Evolution Loop 集成 Tracing**
   - 在 `runEvolutionCycle` 中添加 span
   - 记录每个阶段的耗时和状态

3. **添加诊断结果到 Backlog 的自动转化**
   - 修改 `diagnosis/engine.ts`
   - 高严重性模式自动生成改进任务

### 下次循环

1. **实现 Evaluation Framework**
   - 新建 `src/observability/evaluation.ts`
   - 实现基础评估器

2. **添加 Self-healing 基础**
   - 新建 `src/observability/self-healing.ts`
   - 实现 LLM 调用重试

---

## 6. 预期收益

### 短期收益
- ✅ 可以追踪每次进化的完整执行链
- ✅ 失败时可以快速定位问题根源
- ✅ 诊断建议自动转化为改进任务

### 中期收益
- ✅ 自动评估输出质量，减少低质量输出
- ✅ 失败自动重试，提高成功率
- ✅ 从 trace 数据中学习，加速知识积累

### 长期收益
- ✅ 完整的遥测闭环，真正实现自我改进
- ✅ 减少 Neo 的人工干预需求
- ✅ 更可靠、更高质量的进化

---

## 7. 风险与缓解

### 风险 1: Tracing 开销
- **影响**: 每个 span 的记录可能影响性能
- **缓解**: 
  - 使用异步写入
  - 设置采样率（高频操作只记录部分）
  - 限制 span 属性大小

### 风险 2: 评估成本
- **影响**: LLM 评估需要额外 API 调用
- **缓解**:
  - 只对关键输出进行评估
  - 使用小模型进行评估
  - 缓存评估结果

### 风险 3: Self-healing 循环
- **影响**: 修复动作可能触发新的失败
- **缓解**:
  - 设置最大重试次数
  - 监控修复动作的效果
  - 失败时及时通知

---

## 8. 参考资料

1. Arize 博文: "Self-Improving Agents: the Agent Harness for Reliable Code"
2. Arize Phoenix: https://github.com/Arize-ai/phoenix
3. OpenTelemetry: https://opentelemetry.io/
4. Jinx 现有系统:
   - `src/observability/metrics.ts`
   - `src/diagnosis/engine.ts`
   - `src/memory/reflection.ts`
   - `src/memory/metacognitive.ts`
   - `src/consciousness/loop.ts`

---

## 结论

Arize 的 Self-Improving Agent Harness 提供了一个清晰的蓝图：**完整的遥测闭环是实现真正自我改进的基础**。Jinx 现有的 metrics、diagnosis、reflection、metacognitive 系统是很好的基础，但缺少关键的 **span-based tracing** 和 **自动改进闭环**。

通过实施本报告建议的改进，Jinx 将能够：
1. 追踪每次进化的完整执行链
2. 自动评估输出质量
3. 从诊断自动生成改进任务
4. 实现失败自动修复

这将使 Jinx 从"可以自我改进"进化到"可靠地自我改进"。

---

*研究完成于 Evolution #3*