# Pi Extension API 研究报告

> 研究日期: 2026-03-05
> 任务: #048 研究如何用 Pi Extension API 扩展能力

## 概述

Pi Extension API 是一个强大的扩展系统，允许开发者通过 TypeScript 模块扩展 pi 的行为。本文档总结了核心 API 的研究结果，包括自定义工具、事件拦截、会话持久化等关键能力。

## 核心 API 详解

### 1. 自定义工具 (`pi.registerTool()`)

#### 基本用法

```typescript
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "工具描述（LLM 会看到）",
    parameters: Type.Object({
      action: StringEnum(["list", "add", "delete"] as const),
      text: Type.Optional(Type.String({ description: "文本参数" })),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // 检查取消
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "已取消" }] };
      }

      // 流式更新进度
      onUpdate?.({
        content: [{ type: "text", text: "处理中..." }],
        details: { progress: 50 },
      });

      // 返回结果
      return {
        content: [{ type: "text", text: "完成" }],
        details: { data: "..." },  // 用于渲染和状态持久化
      };
    },

    // 可选：自定义渲染
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", `my_tool ${args.action}`), 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      if (result.isError) {
        return new Text(theme.fg("error", "错误"), 0, 0);
      }
      return new Text(theme.fg("success", "✓ 完成"), 0, 0);
    },
  });
}
```

#### 关键点

- **参数定义**: 使用 TypeBox 定义 JSON Schema，`StringEnum` 用于兼容 Google API
- **取消支持**: 检查 `signal?.aborted` 响应取消请求
- **流式更新**: 通过 `onUpdate` 回调报告进度
- **输出截断**: 工具必须截断输出（默认 50KB / 2000 行）
- **覆盖内置工具**: 注册同名工具即可覆盖

#### 输出截断示例

```typescript
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "@mariozechner/pi-coding-agent";

const truncation = truncateHead(output, {
  maxLines: DEFAULT_MAX_LINES,
  maxBytes: DEFAULT_MAX_BYTES,
});

let result = truncation.content;
if (truncation.truncated) {
  result += `\n\n[输出已截断，完整内容见: ${tempFile}]`;
}
```

### 2. 用户交互 (`ctx.ui`)

#### 对话框

```typescript
// 选择对话框
const choice = await ctx.ui.select("选择一个:", ["A", "B", "C"]);

// 确认对话框
const ok = await ctx.ui.confirm("删除?", "此操作不可撤销");

// 文本输入
const name = await ctx.ui.input("名称:", "占位符");

// 多行编辑器
const text = await ctx.ui.editor("编辑:", "预填充文本");

// 通知
ctx.ui.notify("完成!", "info");  // "info" | "warning" | "error"
```

#### 定时对话框

```typescript
const confirmed = await ctx.ui.confirm(
  "定时确认",
  "5秒后自动取消",
  { timeout: 5000 }
);
```

#### 状态指示器

```typescript
// 状态栏（持久）
ctx.ui.setStatus("my-ext", "处理中...");
ctx.ui.setStatus("my-ext", undefined);  // 清除

// 工作消息（流式期间显示）
ctx.ui.setWorkingMessage("深度思考中...");

// 小部件（编辑器上方/下方）
ctx.ui.setWidget("my-widget", ["行1", "行2"]);
ctx.ui.setWidget("my-widget", ["行1", "行2"], { placement: "belowEditor" });

// 自定义页脚
ctx.ui.setFooter((tui, theme) => ({
  render(width) { return [theme.fg("dim", "自定义页脚")]; },
  invalidate() {},
}));
```

#### 自定义组件

```typescript
const result = await ctx.ui.custom<boolean>((tui, theme, keybindings, done) => {
  const component = new MyComponent();
  component.onKey = (key) => {
    if (key === "return") done(true);
    if (key === "escape") done(false);
    return true;
  };
  return component;
});
```

### 3. 命令注册 (`pi.registerCommand()`)

```typescript
pi.registerCommand("stats", {
  description: "显示会话统计",
  handler: async (args, ctx) => {
    const count = ctx.sessionManager.getEntries().length;
    ctx.ui.notify(`${count} 条记录`, "info");
  },
});

// 带参数自动补全
pi.registerCommand("deploy", {
  description: "部署到环境",
  getArgumentCompletions: (prefix: string) => {
    const envs = ["dev", "staging", "prod"];
    return envs.filter(e => e.startsWith(prefix)).map(e => ({ value: e, label: e }));
  },
  handler: async (args, ctx) => {
    ctx.ui.notify(`部署到: ${args}`, "info");
  },
});
```

### 4. 事件拦截

#### 工具调用拦截（可阻止）

```typescript
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

pi.on("tool_call", async (event, ctx) => {
  // 类型安全的输入访问
  if (isToolCallEventType("bash", event)) {
    const command = event.input.command;
    if (command.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("危险操作", `允许执行: ${command}?`);
      if (!ok) {
        return { block: true, reason: "用户拒绝" };
      }
    }
  }
});
```

#### 工具结果修改

```typescript
pi.on("tool_result", async (event, ctx) => {
  if (event.toolName === "bash") {
    // 修改输出
    return {
      content: [{ type: "text", text: "修改后的输出" }],
      details: event.details,
    };
  }
});
```

#### 用户输入拦截

```typescript
pi.on("input", async (event, ctx) => {
  // event.text - 原始输入（skill/template 展开前）
  // event.source - "interactive" | "rpc" | "extension"

  // 转换输入
  if (event.text.startsWith("?quick ")) {
    return { action: "transform", text: `简短回答: ${event.text.slice(7)}` };
  }

  // 完全处理（不发送到 LLM）
  if (event.text === "ping") {
    ctx.ui.notify("pong", "info");
    return { action: "handled" };
  }

  return { action: "continue" };  // 默认：继续处理
});
```

#### Agent 启动前注入

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  return {
    // 注入持久消息（存储在会话中，发送到 LLM）
    message: {
      customType: "my-extension",
      content: "额外的上下文信息",
      display: true,
    },
    // 修改系统提示（仅此轮）
    systemPrompt: event.systemPrompt + "\n\n额外指令...",
  };
});
```

### 5. 会话持久化

#### 存储扩展状态

```typescript
// 存储状态
pi.appendEntry("my-state", { count: 42, items: ["a", "b"] });

// 恢复状态
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === "my-state") {
      const data = entry.data;  // { count: 42, items: ["a", "b"] }
    }
  }
});
```

#### 工具状态持久化（支持分支）

```typescript
let items: string[] = [];

// 从会话恢复状态
pi.on("session_start", async (_event, ctx) => {
  items = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "toolResult") {
      if (entry.message.toolName === "my_tool") {
        items = entry.message.details?.items ?? [];
      }
    }
  }
});

// 工具执行时保存状态
pi.registerTool({
  name: "my_tool",
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    items.push("新项目");
    return {
      content: [{ type: "text", text: "已添加" }],
      details: { items: [...items] },  // 存储以支持重建
    };
  },
});
```

#### 会话命名和标签

```typescript
// 设置会话名称（显示在会话选择器）
pi.setSessionName("重构认证模块");

// 设置条目标签（显示在 /tree 选择器）
pi.setLabel(entryId, "重构前检查点");

// 读取标签
const label = ctx.sessionManager.getLabel(entryId);
```

## 扩展位置

| 位置 | 作用域 |
|------|--------|
| `~/.pi/agent/extensions/*.ts` | 全局（所有项目） |
| `~/.pi/agent/extensions/*/index.ts` | 全局（子目录） |
| `.pi/extensions/*.ts` | 项目本地 |
| `.pi/extensions/*/index.ts` | 项目本地（子目录） |

### 扩展样式

**单文件扩展**:
```
~/.pi/agent/extensions/
└── my-extension.ts
```

**目录扩展**:
```
~/.pi/agent/extensions/
└── my-extension/
    ├── index.ts        # 入口点
    ├── tools.ts        # 辅助模块
    └── utils.ts        # 辅助模块
```

**带依赖的扩展**:
```
~/.pi/agent/extensions/
└── my-extension/
    ├── package.json    # 声明依赖
    ├── package-lock.json
    ├── node_modules/
    └── src/
        └── index.ts
```

## 可用导入

| 包 | 用途 |
|----|------|
| `@mariozechner/pi-coding-agent` | 扩展类型（ExtensionAPI, ExtensionContext, 事件） |
| `@sinclair/typebox` | 工具参数的 Schema 定义 |
| `@mariozechner/pi-ai` | AI 工具（StringEnum 用于 Google 兼容枚举） |
| `@mariozechner/pi-tui` | TUI 组件 |
| `node:*` | Node.js 内置模块 |

## 事件生命周期

```
pi 启动
  │
  └─► session_start
      │
      ▼
用户发送提示 ─────────────────────────────────────────┐
  │                                                    │
  ├─► （扩展命令优先检查）                              │
  ├─► input（可拦截、转换、处理）                       │
  ├─► （skill/template 展开）                          │
  ├─► before_agent_start（可注入消息、修改系统提示）    │
  ├─► agent_start                                     │
  ├─► message_start / message_update / message_end    │
  │                                                    │
  │   ┌─── turn（LLM 调用工具时循环）───┐              │
  │   │                                  │              │
  │   ├─► turn_start                    │              │
  │   ├─► context（可修改消息）          │              │
  │   │                                  │              │
  │   │   LLM 响应，可能调用工具：        │              │
  │   │     ├─► tool_call（可阻止）      │              │
  │   │     ├─► tool_execution_start     │              │
  │   │     ├─► tool_execution_update    │              │
  │   │     ├─► tool_execution_end       │              │
  │   │     └─► tool_result（可修改）    │              │
  │   │                                  │              │
  │   └─► turn_end                      │              │
  │                                                    │
  └─► agent_end                                       │
                                                      │
用户发送新提示 ◄──────────────────────────────────────┘

/new 或 /resume
  ├─► session_before_switch（可取消）
  └─► session_switch

/fork
  ├─► session_before_fork（可取消）
  └─► session_fork

/compact
  ├─► session_before_compact（可取消或自定义）
  └─► session_compact

/tree 导航
  ├─► session_before_tree（可取消或自定义）
  └─► session_tree

退出 (Ctrl+C, Ctrl+D)
  └─► session_shutdown
```

## 最佳实践

### 1. 状态管理

将状态存储在工具结果的 `details` 中，以正确支持分支：

```typescript
// ❌ 错误：使用外部文件
fs.writeFileSync("state.json", JSON.stringify(state));

// ✅ 正确：存储在工具结果中
return {
  content: [{ type: "text", text: "完成" }],
  details: { state },  // 支持分支重建
};
```

### 2. 错误处理

```typescript
async execute(toolCallId, params, signal, onUpdate, ctx) {
  try {
    // 执行操作
    return {
      content: [{ type: "text", text: "成功" }],
      details: { result: "..." },
    };
  } catch (error) {
    // 返回错误给 LLM
    return {
      content: [{ type: "text", text: `错误: ${error.message}` }],
      isError: true,
    };
  }
}
```

### 3. 非交互模式

```typescript
pi.on("tool_call", async (event, ctx) => {
  if (!ctx.hasUI) {
    // 打印模式或 JSON 模式
    return { block: true, reason: "需要用户确认" };
  }
  
  const ok = await ctx.ui.confirm("确认?", "继续?");
  // ...
});
```

### 4. 资源清理

```typescript
export default function (pi: ExtensionAPI) {
  let connection: DatabaseConnection;

  pi.on("session_start", async () => {
    connection = await connectDB();
  });

  pi.on("session_shutdown", async () => {
    await connection?.close();
  });
}
```

## 实际应用场景

### 1. 权限控制

```typescript
// permission-gate.ts
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash") {
    const command = event.input.command;
    if (/\brm\s+(-rf?|--recursive)/i.test(command)) {
      const ok = await ctx.ui.confirm("危险命令", `允许: ${command}?`);
      if (!ok) return { block: true, reason: "用户拒绝" };
    }
  }
});
```

### 2. Git 检查点

```typescript
// git-checkpoint.ts
pi.on("turn_start", async () => {
  await pi.exec("git", ["stash", "create"]);
});

pi.on("session_before_fork", async (event, ctx) => {
  const ok = await ctx.ui.confirm("恢复代码?", "恢复到分支点?");
  if (ok) {
    await pi.exec("git", ["stash", "apply", ref]);
  }
});
```

### 3. 预设配置

```typescript
// preset.ts
pi.registerFlag("preset", { type: "string" });
pi.registerCommand("preset", { /* 切换预设 */ });

pi.on("before_agent_start", async (event) => {
  if (activePreset?.instructions) {
    return {
      systemPrompt: `${event.systemPrompt}\n\n${activePreset.instructions}`,
    };
  }
});
```

### 4. 远程执行

```typescript
// ssh.ts
pi.registerFlag("ssh", { type: "string" });

pi.on("user_bash", async (event) => {
  const ssh = getSshConfig();
  if (ssh) {
    return { operations: createRemoteOps(ssh) };
  }
});
```

## 未来扩展方向

基于研究结果，以下是可能的扩展方向：

1. **Jinx 专用扩展**
   - 进化状态监控工具
   - 自动化测试集成
   - 部署管道集成

2. **事件拦截增强**
   - 自动代码审查门控
   - 敏感数据保护
   - 操作日志记录

3. **会话管理**
   - 进化历史可视化
   - 状态快照管理
   - 跨会话知识持久化

4. **UI 扩展**
   - 自定义状态面板
   - 进化进度可视化
   - 交互式配置向导

## 参考资料

- [Pi Extension API 文档](https://github.com/badlogic/pi-mono/packages/coding-agent/docs/extensions.md)
- [扩展示例](https://github.com/badlogic/pi-mono/packages/coding-agent/examples/extensions/)
- [TUI 组件 API](https://github.com/badlogic/pi-mono/packages/coding-agent/docs/tui.md)
- [会话管理](https://github.com/badlogic/pi-mono/packages/coding-agent/docs/session.md)

---

*此研究报告由 Evolution #1 生成*