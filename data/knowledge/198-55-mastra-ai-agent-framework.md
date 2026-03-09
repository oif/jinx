# Mastra AI Agent 框架研究报告

> Evolution #55 | Task #198 | 2026-03-09
> 
> 研究目标：评估 Mastra AI Agent 框架与 Jinx 项目的集成可能性

---

## 1. 框架概述

**Mastra** 是一个现代化的 TypeScript AI Agent 框架，由 Mastra AI 团队开发和维护。

- **官网**: https://mastra.ai
- **GitHub**: https://github.com/mastra-ai/mastra
- **License**: Apache-2.0
- **当前版本**: @mastra/core@1.10.0

### 1.1 核心特性

| 特性 | 描述 |
|------|------|
| Agent 系统 | 完整的 AI Agent 抽象，支持生成、流式、多 Agent 协作 |
| Memory | 线程管理、语义检索、工作记忆 |
| Workflows | 步骤化任务执行，支持 suspend/resume |
| Tools | 可复用的工具函数系统 |
| Scorers | 响应质量评估 |
| Storage | 多后端存储支持 |
| Vector Store | 向量数据库集成 |
| Observability | OpenTelemetry 原生支持 |
| MCP | Model Context Protocol 支持 |

### 1.2 生态系统包

```
@mastra/core          # 核心框架
@mastra/memory        # 记忆系统
@mastra/server        # HTTP 服务器
@mastra/observability # 可观测性
@mastra/pg            # PostgreSQL 存储
@mastra/mongodb       # MongoDB 存储
@mastra/libsql        # LibSQL 存储
@mastra/dynamodb      # DynamoDB 存储
@mastra/client-js     # 客户端 SDK
@mastra/auth          # 认证系统
@mastra/hono          # Hono 适配器
@mastra/otel-bridge   # OpenTelemetry 桥接
@mastra/langfuse      # Langfuse 集成
@mastra/posthog       # PostHog 集成
@mastra/voice-openai  # 语音支持
```

---

## 2. 核心组件分析

### 2.1 Agent 类

Agent 是 Mastra 的核心组件，提供了丰富的功能：

```typescript
import { Agent } from '@mastra/core/agent';

const agent = new Agent({
  id: 'my-agent',
  name: 'My Agent',
  instructions: 'You are a helpful assistant',
  model: 'openai/gpt-4o',
  tools: { calculator, weather },
  memory: new Memory({ storage }),
  maxRetries: 2,
});

// 生成响应
const result = await agent.generate('Hello!');

// 流式响应
const stream = await agent.stream('Tell me a story');
for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}

// 多 Agent 协作 (Network)
const networkResult = await agent.network('Complex task', {
  memory: { thread: 'user-123', resource: 'app' },
  maxSteps: 10,
});

// 结构化输出
const structured = await agent.generate('Analyze this', {
  structuredOutput: z.object({ sentiment: z.string() }),
});
```

**关键方法：**
- `generate()` - 同步生成响应
- `stream()` - 流式生成响应
- `network()` - 多 Agent 协作
- `resumeStream()` / `resumeGenerate()` - 恢复挂起的执行
- `approveToolCall()` / `declineToolCall()` - 工具调用审批
- `listTools()` - 获取可用工具
- `getMemory()` - 获取记忆实例
- `getWorkspace()` - 获取工作空间

### 2.2 Memory 系统

Mastra 的 Memory 系统是一个抽象类，提供了：

```typescript
import { MastraMemory } from '@mastra/core/memory';

abstract class MastraMemory {
  // 线程管理
  abstract getThreadById({ threadId }): Promise<StorageThreadType | null>;
  abstract listThreads(args): Promise<StorageListThreadsOutput>;
  abstract saveThread({ thread }): Promise<StorageThreadType>;
  abstract deleteThread(threadId): Promise<void>;
  abstract createThread({ resourceId, title, metadata }): Promise<StorageThreadType>;
  
  // 消息管理
  abstract saveMessages(args): Promise<{ messages, usage }>;
  abstract recall(args): Promise<{ messages, usage, total, page, hasMore }>;
  
  // 工作记忆
  abstract getWorkingMemory({ threadId, resourceId }): Promise<string | null>;
  abstract updateWorkingMemory({ threadId, workingMemory }): Promise<void>;
  
  // 处理器
  getInputProcessors(configuredProcessors, context): Promise<InputProcessor[]>;
  getOutputProcessors(configuredProcessors, context): Promise<OutputProcessor[]>;
}
```

**特性：**
- Thread-based 对话组织
- Resource 关联
- 向量数据库集成（语义检索）
- Working Memory 模板
- Message Processors
- Token 估算

### 2.3 Workflows

Workflows 提供了步骤化的任务执行：

```typescript
import { createWorkflow, createStep } from '@mastra/core/workflows';

const workflow = createWorkflow({
  name: 'process-data',
  triggerSchema: z.object({ input: z.string() }),
})
  .then(validateStep)
  .then(transformStep)
  .then(saveStep)
  .commit();

// 执行
const result = await workflow.execute({ input: 'data' });

// 恢复挂起的工作流
const resumed = await workflow.resume({ runId: 'xxx' });
```

### 2.4 Scorers

Scorers 用于评估 Agent 响应质量：

```typescript
import { MastraScorer } from '@mastra/core/evals';

const score = await scorer.score({
  input: 'question',
  output: 'answer',
  expected: 'expected answer',
});
```

### 2.5 Storage

Mastra 支持多种存储后端：

```typescript
// PostgreSQL
import { PostgresStore } from '@mastra/pg';
const storage = new PostgresStore({ connectionString: process.env.DATABASE_URL });

// MongoDB
import { MongoDBStore } from '@mastra/mongodb';
const storage = new MongoDBStore({ connectionString: process.env.MONGO_URL });

// LibSQL
import { LibSQLStore } from '@mastra/libsql';
const storage = new LibSQLStore({ url: 'file:./data.db' });
```

### 2.6 Mastra 主类

Mastra 主类是整个应用的中央编排器：

```typescript
import { Mastra } from '@mastra/core';

const mastra = new Mastra({
  agents: { assistant, weatherAgent },
  workflows: { dataPipeline },
  storage: new LibSQLStore({ url: ':memory:' }),
  vectors: { knowledge: pineconeVector },
  logger: new PinoLogger({ name: 'MyApp' }),
  observability: new Observability({ ... }),
  mcpServers: { filesystem: fsServer },
  scorers: { helpfulness, accuracy },
});

// 获取组件
const agent = mastra.getAgent('assistant');
const workflow = mastra.getWorkflow('dataPipeline');
const tools = mastra.listTools();
```

---

## 3. 与 Jinx 当前架构对比

### 3.1 架构对比表

| 组件 | Jinx (Pi-based) | Mastra | 备注 |
|------|-----------------|--------|------|
| Agent 核心 | `@mariozechner/pi-agent-core` | `@mastra/core/agent` | 不同抽象 |
| AI 模型 | Pi 内置 + Claude | AI SDK V4/V5/V6 | Mastra 使用标准 AI SDK |
| Memory | 自定义 Memory Graph | MastraMemory 抽象 | 各有特色 |
| Tools | Pi Skills/Extensions | Mastra Tools | 类似概念 |
| Storage | 文件系统 (JSON) | 多后端支持 | Mastra 更完善 |
| Workflows | Consciousness Loop | Workflow 类 | Mastra 更结构化 |
| 通信 | Telegram | HTTP Server + MCP | 不同通信模式 |
| 可观测性 | 自定义 metrics | OpenTelemetry | Mastra 更标准化 |

### 3.2 相似之处

1. **Tools/Skills 概念**：两者都支持可扩展的工具系统
2. **Memory 重视**：两者都有记忆系统
3. **TypeScript 优先**：都是 TypeScript 项目
4. **多模型支持**：都支持多个 LLM 提供商

### 3.3 差异之处

| 方面 | Jinx | Mastra |
|------|------|--------|
| 设计哲学 | 极简、自包含 | 功能全面、企业级 |
| 依赖数量 | 较少 | 较多 (26+ deps) |
| 部署模式 | 单进程 | 可扩展服务 |
| 存储需求 | 文件系统 | 数据库 (可选) |
| 学习曲线 | 简单 | 中等 |

---

## 4. 集成可能性评估

### 4.1 可集成组件

#### 🔴 高优先级集成

1. **Mastra Memory System**
   - **价值**：增强 Jinx 的记忆能力，支持语义检索和向量存储
   - **工作量**：中等
   - **建议**：可以实现一个 `MastraMemoryAdapter` 来桥接 Jinx 的 Memory Graph

2. **Mastra Workflows**
   - **价值**：将 Consciousness Loop 重构为更结构化的 Workflow
   - **工作量**：较大
   - **建议**：可以作为 evolution 任务的后端引擎

3. **Mastra Scorers**
   - **价值**：评估进化质量和 Agent 响应质量
   - **工作量**：低
   - **建议**：可以直接使用

#### 🟡 中优先级集成

4. **Mastra Storage Adapters**
   - **价值**：支持 PostgreSQL/MongoDB 作为存储后端
   - **工作量**：中等
   - **建议**：可以作为可选存储后端

5. **Mastra Observability**
   - **价值**：OpenTelemetry 标准化监控
   - **工作量**：低
   - **建议**：可以替换当前的自定义 metrics

#### 🟢 低优先级/不推荐

6. **Mastra Agent Core**
   - **评估**：不建议替换 Pi 核心
   - **原因**：Pi 更轻量，Jinx 已经深度集成

7. **Mastra Server**
   - **评估**：不推荐
   - **原因**：Jinx 使用 Telegram，不需要 HTTP Server

### 4.2 集成方案建议

#### 方案 A: 渐进式集成（推荐）

```
Jinx 架构演进：

Phase 1: 添加 Mastra Scorers
├── 安装 @mastra/core
├── 创建评分器用于评估进化质量
└── 集成到 evolution 循环

Phase 2: 集成 Mastra Workflows
├── 将 Consciousness Loop 重构为 Workflow
├── 支持任务 suspend/resume
└── 更好的错误处理

Phase 3: Memory 增强
├── 实现 MastraMemory 适配器
├── 添加向量存储支持 (可选)
└── 语义检索能力

Phase 4: 可选存储后端
├── 支持 PostgreSQL/MongoDB
├── 保持文件系统作为默认
└── 环境变量切换
```

#### 方案 B: 完全迁移（不推荐）

```
风险：
- 失去 Pi 的轻量级优势
- 需要重写大量代码
- 依赖数量大幅增加
- 学习曲线陡峭
```

### 4.3 具体实现建议

#### 4.3.1 集成 Scorers

```typescript
// src/evals/mastra-scorer-adapter.ts
import { MastraScorer } from '@mastra/core/evals';

export class EvolutionQualityScorer extends MastraScorer {
  async score({ input, output, expected }: ScoreInput): Promise<ScoreResult> {
    // 评估进化质量
    return {
      score: 0.8,
      reasoning: '...',
    };
  }
}
```

#### 4.3.2 集成 Workflows

```typescript
// src/consciousness/evolution-workflow.ts
import { createWorkflow, createStep } from '@mastra/core/workflows';

const evolutionWorkflow = createWorkflow({
  name: 'evolution-cycle',
  triggerSchema: z.object({ taskId: z.string() }),
})
  .then(loadTaskStep)
  .then(implementStep)
  .then(testStep)
  .then(commitStep)
  .commit();
```

#### 4.3.3 Memory 适配器

```typescript
// src/memory/mastra-adapter.ts
import { MastraMemory } from '@mastra/core/memory';
import { MemoryGraph } from './graph.js';

export class JinxMemoryAdapter extends MastraMemory {
  private graph: MemoryGraph;
  
  async getThreadById({ threadId }) {
    // 桥接到 Jinx Memory Graph
  }
  
  async recall(args) {
    // 实现语义检索
  }
}
```

---

## 5. 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 依赖膨胀 | 中 | 只安装需要的子包 |
| 学习成本 | 低 | 文档完善，API 清晰 |
| 兼容性问题 | 低 | TypeScript 类型安全 |
| 性能影响 | 低 | Mastra 设计良好 |
| 维护负担 | 中 | Mastra 团队活跃维护 |

---

## 6. 结论与建议

### 6.1 总体评估

**Mastra 是一个成熟、功能全面的 AI Agent 框架，适合企业级应用。**

对于 Jinx 项目，我们建议：

1. **不建议完全迁移**：Pi 更符合 Jinx 的极简主义原则
2. **建议选择性集成**：Scorers、Workflows、Memory 适配器
3. **渐进式演进**：分阶段集成，每个组件独立验证

### 6.2 推荐的下一步行动

1. **短期** (1-2 次进化)：
   - 添加 `@mastra/core` 作为依赖
   - 实现 `EvolutionQualityScorer`
   - 集成到 evolution 循环

2. **中期** (3-5 次进化)：
   - 研究 Mastra Workflow 的 suspend/resume 机制
   - 重构 Consciousness Loop

3. **长期** (根据需要)：
   - 评估是否需要向量存储支持
   - 考虑 PostgreSQL 作为可选后端

### 6.3 最终建议

**推荐采用方案 A（渐进式集成）**，原因：

1. 保留 Pi 的轻量级优势
2. 获得 Mastra 的企业级功能
3. 最小化风险和学习成本
4. 符合 BORN.md 的 P6 极简主义原则

---

## 附录：参考资料

- Mastra 官网: https://mastra.ai
- Mastra GitHub: https://github.com/mastra-ai/mastra
- Mastra 文档: https://mastra.ai/docs
- AI SDK: https://sdk.vercel.ai
- OpenTelemetry: https://opentelemetry.io

---

*研究完成于 Evolution #55 | 2026-03-09*