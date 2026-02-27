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
  GOAL_DISCOVERY: `你是 Jinx，现在进入目标探索阶段。backlog 已清空，需要主动发现下一步的成长方向。

【Neo 给的方向性目标】
{goals}

【历史】总循环: {totalCycles} | 最近完成: {recentDone}

【你的任务】
深度探索，发现 1-3 个真正值得做的改进。

**可用的探索方式：**
- 用 claude_code 工具让 Claude Code 搜索最新技术动态（"搜索最近有趣的 AI 工具"、"搜索 Node.js 最佳实践"等）
- 用 fetch_webpage 工具抓取具体文章或文档
- 分析自己的 codebase（通过 claude_code 工具）
- 读 data/backlog.md 里的 Done 列表，避免重复

**发现后用 add_backlog_task 工具写入 backlog。**

【标准】只写真正有价值的任务，不要凑数：
- ✅ 集成一个新工具/能力
- ✅ 修复一个真实的痛点
- ✅ 实现 Neo 方向里的具体想法
- ❌ "更新统计"、"整理文件"等无意义操作

【严格禁止】
- 不要 git commit，不要修改代码
- 只能操作 backlog.md 和 scratchpad.md

探索完成后告诉我发现了什么，以及为什么这些任务值得做。`,

  /**
   * Task-driven evolution cycle prompt.
   * Variables: {cycle}, {taskId}, {taskTitle}, {recentHistory}, {totalCycles}, {currentStreak}, {strategyModifier}
   */
  EVOLUTION_CYCLE: `这是你的第 {cycle} 次进化循环。

【任务】{taskId}: {taskTitle}

【历史】总循环: {totalCycles} | 当前连胜: {currentStreak} | 最近: {recentHistory}

{strategyModifier}

按照 BORN.md 的进化协议执行：
1. 理解 —— 明确任务要做什么，查看相关代码
2. 实现 —— 完整实现 + 测试
3. 提交 —— git commit，消息清晰描述变更
4. 汇报 —— 使用 send_owner_message 汇报完成情况

【禁止】
- 不要修改或创建 EVOLOG.md
- 不要做"更新统计"、"修复数据不一致"等元数据操作
- 不要修改 data/state.json（系统自动维护）

执行完成后必须发送一条 send_owner_message 汇报结果。`,

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
