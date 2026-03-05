# MCP Tool Search 集成可行性评估报告

## 概述

本报告评估了 Anthropic 的 MCP Tool Search 功能及其在 Pi agent 框架中的集成可行性。

## 1. MCP Tool Search 功能分析

### 1.1 核心概念

MCP Tool Search 是 Anthropic 的新 beta 功能，允许模型动态搜索和加载工具，而不是将所有工具定义都包含在初始上下文中。

### 1.2 关键组件

从 Anthropic SDK 源码分析：

```typescript
// 搜索工具类型
- tool_search_tool_regex    // 正则表达式搜索
- tool_search_tool_bm25     // BM25 算法搜索

// 延迟加载属性
defer_loading?: boolean     // 如果为 true，工具不包含在初始系统提示中

// 搜索结果
BetaToolReferenceBlock {
  type: 'tool_reference';
  tool_name: string;        // 工具名称引用
}
```

### 1.3 工作原理

```
1. 初始化阶段
   ├── 工具设置 defer_loading: true
   └── 工具不包含在初始系统提示中（节省 context）

2. 搜索阶段
   ├── 模型调用 tool_search_tool_bm25/regex
   ├── 搜索参数：查询字符串、过滤条件等
   └── 返回 tool_references 数组

3. 加载阶段
   ├── 只有被引用的工具才会被加载
   └── 动态注入到上下文中
```

### 1.4 性能收益

根据用户反馈，可减少 **95%** 的 context 使用，特别适合：
- 大量工具的场景（如 MCP server 集成）
- 长对话会话
- 复杂任务处理

## 2. Pi 框架现状分析

### 2.1 当前架构

```
pi-coding-agent (主包)
├── core/
│   ├── agent-session.js    # 会话管理
│   ├── tools/              # 内置工具
│   └── extensions/         # 扩展系统
└── modes/
    └── interactive/        # 交互模式

pi-agent-core (核心包)
├── agent.js                # Agent 逻辑
├── types.js                # 类型定义
└── agent-loop.js           # Agent 循环

pi-ai (AI 工具包)
├── providers/              # 各 provider 实现
├── types.js                # 核心类型
└── stream.js               # 流式处理
```

### 2.2 当前工具系统

```typescript
// pi-ai/dist/types.d.ts
interface Tool<TParameters extends TSchema = TSchema> {
    name: string;
    description: string;
    parameters: TParameters;
}

interface Context {
    systemPrompt?: string;
    messages: Message[];
    tools?: Tool[];  // 所有工具都在每次请求时发送
}
```

**限制**：
- 没有 `defer_loading` 属性
- 没有 tool search 机制
- 所有工具都在每次请求时发送给 LLM

### 2.3 Pi 的设计哲学

从 README.md 中可以看到：

> **No MCP.** Build CLI tools with READMEs (see Skills), or build an extension that adds MCP support.

Pi 的设计哲学是：
- 保持核心最小化
- 通过扩展添加功能
- 不内置 MCP 支持

## 3. 集成可行性评估

### 3.1 技术可行性

| 方面 | 评估 | 说明 |
|------|------|------|
| API 支持 | ⚠️ 有限 | 仅 Anthropic beta API 支持 |
| 架构修改 | ✅ 可行 | 需要修改 Tool 接口和 agent 循环 |
| Provider 兼容 | ❌ 不兼容 | 其他 provider 无类似功能 |
| 向后兼容 | ✅ 可行 | 可作为可选功能 |

### 3.2 实现方案

#### 方案 A：核心集成（推荐）

修改 `pi-ai` 包：

```typescript
// types.d.ts
interface Tool<TParameters extends TSchema = TSchema> {
    name: string;
    description: string;
    parameters: TParameters;
    deferLoading?: boolean;  // 新增：延迟加载
}

interface ToolSearchConfig {
    enabled: boolean;
    tools: Tool[];  // 可搜索的工具池
}

interface Context {
    systemPrompt?: string;
    messages: Message[];
    tools?: Tool[];
    toolSearch?: ToolSearchConfig;  // 新增
}
```

修改 `pi-agent-core` 包：

```typescript
// agent-loop.js - 处理 tool_reference 块
if (event.type === 'tool_reference') {
    const tool = findToolInPool(event.tool_name);
    if (tool) {
        loadTool(tool);
    }
}
```

#### 方案 B：扩展实现（更符合 Pi 哲学）

创建一个扩展来处理 tool search：

```typescript
// ~/.pi/agent/extensions/tool-search.ts
export default function (pi: ExtensionAPI) {
    // 注册 tool_search 工具
    pi.registerTool({
        name: "tool_search",
        description: "Search for available tools by name or description",
        parameters: Type.Object({
            query: Type.String({ description: "Search query" }),
        }),
        async execute(toolCallId, params, signal, onUpdate, ctx) {
            const results = searchTools(params.query);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(results.map(r => ({
                        name: r.name,
                        description: r.description,
                    })))
                }],
            };
        },
    });
    
    // 监听 tool_call 来动态加载工具
    pi.on("tool_call", async (event, ctx) => {
        if (event.toolName === "tool_search") {
            // 处理搜索结果
        }
    });
}
```

### 3.3 限制和挑战

1. **API 限制**
   - 仅 Anthropic beta API 支持
   - 需要 `anthropic-beta` header
   - 可能随时变化

2. **Provider 兼容性**
   - OpenAI 无类似功能
   - Google Gemini 无类似功能
   - 需要为每个 provider 实现不同的机制

3. **架构复杂度**
   - 需要维护工具池
   - 需要处理工具加载状态
   - 可能影响扩展系统

### 3.4 替代方案

考虑到 Pi 的设计哲学，推荐以下替代方案：

#### 方案 C：Skills 系统

Pi 已经有 Skills 系统，可以实现类似效果：

```markdown
<!-- SKILL.md -->
# Tool Selection Skill
When the user asks for a specific task:
1. Analyze the task requirements
2. Select appropriate tools from the available set
3. Only use tools that are necessary
```

#### 方案 D：动态工具激活

通过扩展实现动态工具激活：

```typescript
pi.registerCommand("tools", {
    description: "Manage active tools",
    handler: async (args, ctx) => {
        const activeTools = pi.getActiveTools();
        const allTools = pi.getAllTools();
        
        // 让用户选择激活哪些工具
        const selected = await ctx.ui.select(
            "Select tools to activate:",
            allTools.map(t => t.name)
        );
        
        pi.setActiveTools(selected);
    },
});
```

## 4. 结论和建议

### 4.1 可行性结论

| 评估项 | 结论 |
|--------|------|
| 技术可行性 | ✅ 可行，但需要大量修改 |
| 实用性 | ⚠️ 仅限 Anthropic provider |
| 符合 Pi 哲学 | ❌ 不太符合，Pi 倾向于扩展而非核心修改 |
| ROI | ⚠️ 收益有限，因为 Pi 默认工具数量较少 |

### 4.2 建议方案

1. **短期**：使用 Pi 的 Skills 系统来指导模型选择合适的工具
2. **中期**：创建一个扩展来实现动态工具管理
3. **长期**：等待 Anthropic 将 tool search 功能稳定后，再考虑核心集成

### 4.3 实现优先级

```
高优先级（现在可做）：
├── 创建 tool-search 扩展（方案 B）
└── 使用 Skills 指导工具选择（方案 C）

中优先级（后续考虑）：
└── 动态工具激活命令（方案 D）

低优先级（暂不推荐）：
└── 核心架构修改（方案 A）
    ├── 需要 Anthropic 稳定 API
    ├── 其他 provider 不支持
    └── 不符合 Pi 最小化哲学
```

## 5. 附录：Anthropic Tool Search API 参考

### 5.1 工具定义

```typescript
interface BetaToolSearchToolBm25_20251119 {
    name: 'tool_search_tool_bm25';
    type: 'tool_search_tool_bm25_20251119' | 'tool_search_tool_bm25';
    defer_loading?: boolean;
}

interface BetaToolSearchToolRegex20251119 {
    name: 'tool_search_tool_regex';
    type: 'tool_search_tool_regex_20251119' | 'tool_search_tool_regex';
    defer_loading?: boolean;
}
```

### 5.2 搜索结果

```typescript
interface BetaToolSearchToolSearchResultBlock {
    tool_references: Array<BetaToolReferenceBlock>;
    type: 'tool_search_tool_search_result';
}

interface BetaToolReferenceBlock {
    tool_name: string;
    type: 'tool_reference';
}
```

### 5.3 使用示例

```typescript
// 发送请求时
const response = await client.beta.messages.create({
    model: 'claude-sonnet-4-5',
    tools: [
        { type: 'tool_search_tool_bm25' },  // 内置搜索工具
        { 
            name: 'my_tool',
            type: 'custom',
            defer_loading: true  // 延迟加载
        }
    ]
});

// 模型会先调用 tool_search，获取 tool_reference
// 然后只有被引用的工具才会被加载
```

---

**报告日期**: 2026-03-05
**Pi 版本**: 0.52.12
**Anthropic SDK 版本**: 0.73.0