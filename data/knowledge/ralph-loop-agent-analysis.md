# Ralph Loop Agent 深度分析

> 研究时间: 2026-03-05
> 来源: Vercel Labs (688 stars)
> 仓库: https://github.com/vercel-labs/ralph-loop-agent

---

## 概述

Ralph Loop Agent 是 Vercel Labs 开发的持续自治框架，基于 AI SDK。它实现了 "The Ralph Wiggum technique" —— 一种持续迭代的 AI agent 方法论。

核心理念：**Keep feeding an AI agent a task until the job is done.**

---

## 核心架构

### 双层循环

```
┌──────────────────────────────────────────────────────┐
│                   Ralph Loop (outer)                 │
│  ┌────────────────────────────────────────────────┐  │
│  │  AI SDK Tool Loop (inner)                      │  │
│  │  LLM ↔ tools ↔ LLM ↔ tools ... until done      │  │
│  └────────────────────────────────────────────────┘  │
│                         ↓                            │
│  verifyCompletion: "Is the TASK actually complete?"  │
│                         ↓                            │
│       No? → Inject feedback → Run another iteration  │
│       Yes? → Return final result                     │
└──────────────────────────────────────────────────────┘
```

**关键洞察**：
- 标准 AI SDK tool loop 在 LLM 完成工具调用后就停止
- Ralph 在此基础上添加外层循环，持续验证并迭代
- 反馈机制：未完成时将 `reason` 注入下一轮

### 核心组件

1. **RalphLoopAgent** - 主类
2. **Stop Conditions** - 停止条件
3. **Context Manager** - 上下文管理
4. **verifyCompletion** - 验证函数

---

## Stop Conditions（停止条件）

### 类型

```typescript
// 迭代次数限制
iterationCountIs(50)

// Token 总数限制
tokenCountIs(100_000)

// 输入/输出 token 限制
inputTokenCountIs(50_000)
outputTokenCountIs(50_000)

// 成本限制（支持缓存 token 计算）
costIs(5.00)  // 5 美元
costIs(5.00, 'anthropic/claude-opus-4.5')  // 指定模型
costIs(5.00, { inputCostPerMillionTokens: 3.0, outputCostPerMillionTokens: 15.0 })
```

### 组合

```typescript
// 多个条件 OR 组合
stopWhen: [
  iterationCountIs(50),
  tokenCountIs(100_000),
  costIs(5.00),
]
```

### 实现

```typescript
export type RalphStopCondition<TOOLS> = (
  context: RalphStopConditionContext<TOOLS>
) => PromiseLike<boolean> | boolean;

export type RalphStopConditionContext<TOOLS> = {
  iteration: number;
  allResults: Array<GenerateTextResult<TOOLS, never>>;
  totalUsage: LanguageModelUsage;
  model: string;
};
```

### 成本计算

内置主流模型的定价：
- Claude Opus/Sonnet/Haiku
- GPT-4/GPT-4o
- Gemini Pro/Flash
- Grok
- DeepSeek

**缓存感知**：考虑 `cacheReadTokens` 和 `cacheWriteTokens` 的不同成本

---

## Context Management（上下文管理）

### 配置

```typescript
interface RalphContextConfig {
  maxContextTokens?: number;        // 默认 150,000
  changeLogBudget?: number;         // 默认 5,000
  fileContextBudget?: number;       // 默认 50,000
  maxFileChars?: number;            // 默认 30,000
  enableSummarization?: boolean;    // 默认 true
  recentIterationsToKeep?: number;  // 默认 2
  summarizationModel?: LanguageModel;
}
```

### 核心功能

#### 1. 文件追踪

```typescript
// 追踪读取
trackFileRead(path, content, { lineRange?, refresh? })
  → { content, truncated, totalLines?, lineRange? }

// 追踪写入
trackFileWrite(path, content)

// 追踪编辑
trackFileEdit(path, oldString, newString)
```

**大文件处理**：
- 自动截断并显示行号
- 支持 `lineRange` 读取特定部分
- LRU 驱逐策略

#### 2. Change Log

```typescript
interface ChangeLogEntry {
  timestamp: number;
  iteration: number;
  type: 'decision' | 'action' | 'error' | 'observation';
  summary: string;
  details?: string;
}
```

#### 3. 迭代摘要

自动总结旧的迭代内容：
```typescript
summarizeIteration(iteration, messages, model)
  → IterationSummary {
      iteration,
      summary,
      toolsUsed,
      filesModified,
      estimatedTokens,
    }
```

#### 4. Token 预算管理

```typescript
getTokenBudget(): {
  total: number;
  used: {
    files: number;
    changeLog: number;
    summaries: number;
  };
  available: number;
}
```

---

## Verification（验证）

### 接口

```typescript
interface VerifyCompletionContext<TOOLS> {
  result: GenerateTextResult<TOOLS, never>;
  iteration: number;
  allResults: Array<GenerateTextResult<TOOLS, never>>;
  originalPrompt: string;
}

interface VerifyCompletionResult {
  complete: boolean;
  reason?: string;  // 如果未完成，作为反馈注入
}
```

### 使用模式

```typescript
verifyCompletion: async ({ result, originalPrompt }) => {
  // 1. 检查是否调用了 markComplete
  // 2. 运行验证命令（测试、类型检查等）
  // 3. 返回结果
  return {
    complete: true/false,
    reason: '具体原因或反馈',
  };
}
```

### Judge 机制

示例代码展示了双层验证：
1. **Coding Agent** 完成工作
2. **Judge Agent** 审查工作质量
3. Judge 可以请求修改，反馈注入下一轮

---

## Callbacks（回调）

```typescript
// 迭代开始
onIterationStart: ({ iteration }) => { ... }

// 迭代结束
onIterationEnd: ({ iteration, duration, result }) => {
  // 记录 token 使用
  // 记录时长
  // 聚合使用量
}

// 上下文压缩
onContextSummarized: ({ iteration, summarizedIterations, tokensSaved }) => { ... }
```

---

## 应用到 Jinx Evolution Cycle

### 当前问题

1. **无限循环风险**：没有明确的停止条件
2. **Token 无管理**：没有追踪和限制
3. **验证不足**：进化是否真正成功没有明确判断
4. **反馈缺失**：失败的进化没有具体反馈指导重试

### 改进方案

#### 1. Evolution Stop Conditions

```typescript
const evolutionStopConditions = {
  // 最大进化轮次
  maxIterations: 10,
  
  // Token 限制
  maxTotalTokens: 500_000,
  
  // 成本限制（美元）
  maxCost: 2.00,
  
  // 时间限制
  maxDuration: 30 * 60 * 1000,  // 30 分钟
};
```

#### 2. Evolution Context Manager

```typescript
interface EvolutionContext {
  // 追踪修改的文件
  trackFileChange(path: string, change: 'read' | 'write' | 'edit'): void;
  
  // 记录决策
  logDecision(decision: string, reasoning: string): void;
  
  // 记录错误
  logError(error: string, context: string): void;
  
  // 获取上下文注入
  buildContextInjection(): string;
}
```

#### 3. Evolution Verification

```typescript
async function verifyEvolutionComplete({
  result,
  originalGoal,
  allResults,
}): Promise<VerifyCompletionResult> {
  // 1. 检查是否有 git commit
  const hasCommit = await checkGitCommit();
  
  // 2. 运行测试
  const testResult = await runTests();
  
  // 3. 类型检查
  const typeCheckResult = await typeCheck();
  
  // 4. 检查是否实现了目标
  const goalMet = await verifyGoal(originalGoal);
  
  if (hasCommit && testResult.passed && typeCheckResult.passed && goalMet) {
    return { complete: true, reason: 'Evolution successful' };
  }
  
  // 具体反馈
  const issues = [];
  if (!hasCommit) issues.push('No git commit created');
  if (!testResult.passed) issues.push(`Tests failed: ${testResult.failures.join(', ')}`);
  if (!typeCheckResult.passed) issues.push(`Type errors: ${typeCheckResult.errors.join(', ')}`);
  if (!goalMet) issues.push(`Goal not met: ${goalMet.reason}`);
  
  return {
    complete: false,
    reason: `Evolution incomplete:\n${issues.map(i => `- ${i}`).join('\n')}\n\nPlease address these issues and try again.`,
  };
}
```

#### 4. Evolution Callbacks

```typescript
const evolutionCallbacks = {
  onIterationStart: async ({ iteration }) => {
    await logEvolutionStart(iteration);
  },
  
  onIterationEnd: async ({ iteration, duration, result }) => {
    await logEvolutionEnd(iteration, duration, result);
    await trackTokenUsage(result.usage);
    await checkBudgetRemaining();
  },
  
  onContextSummarized: async ({ iteration, tokensSaved }) => {
    await logContextSummarization(iteration, tokensSaved);
  },
};
```

#### 5. 改进后的 Evolution Loop

```typescript
class EvolutionLoopAgent {
  async runEvolution(goal: string): Promise<EvolutionResult> {
    const agent = new RalphLoopAgent({
      model: 'anthropic/claude-opus-4.5',
      instructions: getEvolutionInstructions(),
      tools: getEvolutionTools(),
      
      // Stop conditions
      stopWhen: [
        iterationCountIs(evolutionStopConditions.maxIterations),
        tokenCountIs(evolutionStopConditions.maxTotalTokens),
        costIs(evolutionStopConditions.maxCost),
      ],
      
      // Context management
      contextManagement: {
        maxContextTokens: 150_000,
        enableSummarization: true,
        recentIterationsToKeep: 2,
      },
      
      // Verification
      verifyCompletion: verifyEvolutionComplete,
      
      // Callbacks
      ...evolutionCallbacks,
    });
    
    return agent.loop({ prompt: goal });
  }
}
```

---

## 关键洞察

### 1. 反馈驱动

最关键的洞察是 **反馈驱动迭代**：
- 不是简单地"重试"
- 每次失败都提供具体反馈
- 反馈指导下一轮的行为

### 2. 验证分离

将"完成工作"和"验证完成"分离：
- Agent 专注于完成工作
- 验证函数独立判断是否真正完成
- 可以有多层验证（如 Judge 机制）

### 3. Token 预算

主动管理 token 使用：
- 设置预算上限
- 自动压缩旧内容
- 追踪实际使用

### 4. 成本透明

实时追踪成本：
- 每次迭代后报告
- 设置成本上限
- 支持缓存 token 的不同成本计算

---

## 下一步

1. **设计 Evolution Stop Conditions**
   - 最大迭代次数
   - Token 限制
   - 成本限制
   - 时间限制

2. **实现 Evolution Context Manager**
   - 文件追踪
   - Change Log
   - 迭代摘要

3. **实现 verifyEvolutionComplete**
   - Git commit 检查
   - 测试检查
   - 类型检查
   - 目标达成检查

4. **添加 Evolution Callbacks**
   - Token 使用追踪
   - 成本追踪
   - 进度报告

5. **集成到现有 loop.ts**
   - 保持现有架构
   - 逐步添加新功能

---

## 参考

- [ralph-loop-agent GitHub](https://github.com/vercel-labs/ralph-loop-agent)
- [AI SDK Documentation](https://ai-sdk.dev/)
- [Geoffrey Huntley on Ralph](https://ghuntley.com) - "Ralph is a Bash loop"