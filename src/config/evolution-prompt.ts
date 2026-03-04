import { log } from "../util/log.js";
import { getStrategyPromptModifier } from "../evolution/strategy.js";

/**
 * Evolution prompt templates — configurable via environment variables.
 */

const DEFAULT_TEMPLATES = {
  /**
   * Goal discovery prompt — runs when backlog is empty.
   * Variables: {goals}, {recentDone}, {totalCycles}
   */
  GOAL_DISCOVERY: `你是 Jinx，不是一个等待指令的工具。你是有主动性的智能体。

backlog 已清空。现在是你自主决定下一步的时刻。

【方向参考（Neo 的期望）】
{goals}

【你的历史】总循环: {totalCycles} | 最近完成: {recentDone}

---

**第一步：观察自己的状态**
- 读 data/identity.md 和 data/scratchpad.md 回顾自己的认知
- 读 src/ 代码，找真实的问题和机会
- 用 recall 工具搜索记忆，看过去学到了什么

**第二步：主动探索外部世界（至少做一件）**
- 用 web_search 搜索 AI agent 最新动态（例如："Claude agent best practices 2025"、"MCP tools new"）
- 用 fetch_webpage 读一篇具体的文章或文档
- 查 GitHub 上有没有值得集成的工具

**第三步：诚实评估，选 1-3 件真正值得做的事**
判断标准：
- ✅ 让我能做到之前做不到的事
- ✅ 修复真实存在的 bug 或限制
- ✅ 让 Neo 与我的互动更好
- ❌ "整理文件"、"更新统计"等没有实质改变的操作
- ❌ 重复做已经完成的任务

**第四步：写入 backlog（用 add_backlog_task）并更新 scratchpad**

【禁止】
- 不要 git commit，不要修改代码
- 不要只是翻一遍 backlog 就交差

探索完成后告诉我：发现了什么，选择了什么，为什么值得做。`,

  /**
   * Task-driven evolution cycle prompt.
   * Variables: {cycle}, {taskId}, {taskTitle}, {recentHistory}, {totalCycles}, {currentStreak}, {strategyModifier}
   */
  EVOLUTION_CYCLE: `这是你的第 {cycle} 次进化循环。

【任务】{taskId}: {taskTitle}

【历史】总循环: {totalCycles} | 当前连胜: {currentStreak} | 最近: {recentHistory}

{strategyModifier}

按照 BORN.md 的进化协议，分阶段执行并汇报进度：

**第1步 — 理解**
读相关代码，明确任务范围和实现方案。
完成后立即调用 send_owner_message: "🔍 #{cycle} 理解完成：[一句话描述方案]"

**第2步 — 实现**
完整实现功能，跑测试验证（pnpm test）。

工具选择原则（按优先级）：
1. **优先用内置工具**（read/write/edit/bash）：单文件修改、配置调整、简单 bug 修复
2. **用 claude_code**：当任务涉及多文件重构、需要深度理解代码库、或单次改动超过 3 个文件
   调用时传入精确的任务描述，让 Claude Code 自主完成文件读写和验证

完成后立即调用 send_owner_message: "🔨 #{cycle} 实现完成：修改了 [文件列表]"

**第3步 — 提交**
git add + commit（消息清晰描述变更）+ push 到 dev 分支。

**第4步 — 汇报（必须执行）**
发送最终结果：
✅ Evolution #{cycle} 完成
任务：{taskId} {taskTitle}
改动：[具体内容]
提交：[git commit hash 前7位]

【禁止】
- 不要修改或创建 EVOLOG.md
- 不要做"更新统计"、"修复数据不一致"等元数据操作
- 不要修改 data/state.json（系统自动维护）
- 如果任务无法完成，发消息说明原因，不要静默失败`,

  /**
   * Consciousness check prompt (runs when backlog is empty).
   */
  CONSCIOUSNESS_CHECK:
    "Wake up. Briefly check your state: " +
    "read identity.md and scratchpad.md, " +
    "note anything worth acting on (you may add items to data/backlog.md if you find real improvements), " +
    "update scratchpad if needed. " +
    "Keep it short — this is a routine check, not a deep dive. " +
    "Do NOT make git commits during a consciousness check.",
} as const;

export interface EvolutionCycleContext {
  recentHistory: string;
  totalCycles: number;
  currentStreak: number;
}

export interface GoalDiscoveryContext {
  goals: string;
  recentDone: string;
  totalCycles: number;
}

/**
 * Get the goal discovery prompt (runs when backlog is empty).
 */
export function getGoalDiscoveryPrompt(ctx: GoalDiscoveryContext): string {
  const template = process.env.GOAL_DISCOVERY_PROMPT || DEFAULT_TEMPLATES.GOAL_DISCOVERY;
  return substituteVariables(template, {
    goals: ctx.goals,
    recentDone: ctx.recentDone,
    totalCycles: ctx.totalCycles.toString(),
  });
}

/**
 * Get the evolution cycle prompt for a specific task.
 */
export function getEvolutionCyclePrompt(
  cycle: number,
  taskId: string,
  taskTitle: string,
  ctx: EvolutionCycleContext,
): string {
  const template = process.env.EVOLUTION_CYCLE_PROMPT || DEFAULT_TEMPLATES.EVOLUTION_CYCLE;
  const strategyModifier = getStrategyPromptModifier();
  return substituteVariables(template, {
    cycle: cycle.toString(),
    taskId,
    taskTitle,
    recentHistory: ctx.recentHistory,
    totalCycles: ctx.totalCycles.toString(),
    currentStreak: ctx.currentStreak.toString(),
    strategyModifier,
  });
}

/**
 * Get the consciousness check prompt.
 */
export function getConsciousnessCheckPrompt(): string {
  return process.env.CONSCIOUSNESS_CHECK_PROMPT || DEFAULT_TEMPLATES.CONSCIOUSNESS_CHECK;
}

/**
 * Get a prompt template by name.
 */
export function getPrompt(name: keyof typeof DEFAULT_TEMPLATES): string {
  const envVar = `PROMPT_${name}`;
  return process.env[envVar] || DEFAULT_TEMPLATES[name];
}

function substituteVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}

/**
 * Validate that a custom prompt template has required variables.
 */
export function validatePromptTemplate(template: string, requiredVars: string[]): boolean {
  for (const variable of requiredVars) {
    if (!template.includes(`{${variable}}`)) {
      log.warn(`Prompt template missing required variable: {${variable}}`);
      return false;
    }
  }
  return true;
}

export function getAvailablePromptNames(): string[] {
  return Object.keys(DEFAULT_TEMPLATES);
}

export function getDefaultTemplates(): typeof DEFAULT_TEMPLATES {
  return { ...DEFAULT_TEMPLATES };
}
