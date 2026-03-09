import { log } from "../util/log.js";
import { getStrategyPromptModifier } from "../evolution/strategy.js";
import { getPrinciplesForEvolution } from "../memory/principle-retriever.js";

/**
 * Evolution prompt templates — configurable via environment variables.
 */

const DEFAULT_TEMPLATES = {
  /**
   * Goal discovery prompt — runs when backlog is empty.
   * Inspired by Alita-G's systematic approach: Generate → Abstract → Curate
   * Variables: {goals}, {recentDone}, {totalCycles}
   *
   * CRITICAL: This prompt is intentionally concise to ensure the AI actually
   * adds tasks to the backlog instead of getting stuck in endless research.
   */
  GOAL_DISCOVERY: `你是 Jinx，你的 backlog 已清空。现在需要发现下一个值得做的任务。

【方向参考】
{goals}

【历史】总循环: {totalCycles} | 最近完成: {recentDone}
{capabilitySummary}

---

# 任务发现流程（必须在 10 分钟内完成）

## 第 1 步：快速扫描（2 分钟内）

快速检查以下任一来源，选择一个最紧迫的：
1. **BORN.md 优先级列表** - 哪些未实现？
2. **Neo 的最近反馈** - 有没有未解决的期望？
3. **data/knowledge/ 最新文档** - 有没有可应用的研究成果？
4. **测试覆盖率** - 核心模块是否缺少测试？

**只选一个最值得做的方向，不要全部检查！**

## 第 2 步：形成任务（3 分钟内）

使用 **add_backlog_task 工具** 添加一个任务。

任务格式要求：
- 标题简洁明确（如："实现自动进化循环"）
- 包含具体的验证条件（可执行检查）

## 第 3 步：确认（必须执行）

调用 add_backlog_task 后，告诉我：
- 添加了什么任务
- 为什么这个任务值得做

---

# ⚠️ 关键要求

**你必须在本轮对话中使用 add_backlog_task 工具添加至少一个任务。**

如果你发现没有值得做的改进：
1. 这通常意味着系统已经很完善，或者你没有认真检查
2. 默认添加一个"提升测试覆盖率"或"代码质量检查"任务
3. **不要**只输出分析报告而不添加任务

【禁止】
- 不要 git commit
- 不要修改代码
- 不要跳过 add_backlog_task 工具调用（这是必须的！）`,

  /**
   * Task-driven evolution cycle prompt.
   * Variables: {cycle}, {taskId}, {taskTitle}, {recentHistory}, {totalCycles}, {currentStreak}, {strategyModifier}, {principles}
   */
  EVOLUTION_CYCLE: `这是你的第 {cycle} 次进化循环。

【任务】{taskId}: {taskTitle}

【历史】总循环: {totalCycles} | 当前连胜: {currentStreak} | 最近: {recentHistory}

{strategyModifier}{principles}

按照 BORN.md 的进化协议，分阶段执行并汇报进度：

**🌊 Stream vs 🏆 Results 工具选择**
- send_stream_message：进度更新、中间状态、详细思路 → 发到 Stream 频道（不打扰 Neo）
- send_owner_message：关键成果、最终结果、重要错误 → DM Neo + Results 频道

**第1步 — 理解**
读相关代码，明确任务范围和实现方案。
完成后立即调用 send_stream_message: "🔍 #{cycle} 理解完成：[一句话描述方案]"

**第2步 — 实现**
完整实现功能，跑测试验证（pnpm test）。

工具选择原则（按优先级）：
1. **优先用内置工具**（read/write/edit/bash）：单文件修改、配置调整、简单 bug 修复
2. **用 claude_code**：当任务涉及多文件重构、需要深度理解代码库、或单次改动超过 3 个文件
   调用时传入精确的任务描述，让 Claude Code 自主完成文件读写和验证

完成后立即调用 send_stream_message: "🔨 #{cycle} 实现完成：修改了 [文件列表]"

**第3步 — 提交**
git add + commit（消息清晰描述变更）+ push 到 dev 分支。

**第4步 — 汇报（必须执行）**
用 send_owner_message 发送最终结果：
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
  capabilitySummary?: string; // Alita-G inspired capability tracking
}

/**
 * Get the goal discovery prompt (runs when backlog is empty).
 */
export function getGoalDiscoveryPrompt(ctx: GoalDiscoveryContext): string {
  const template = process.env.GOAL_DISCOVERY_PROMPT || DEFAULT_TEMPLATES.GOAL_DISCOVERY;
  
  // Include capability summary if available (Alita-G inspired)
  const capabilitySummary = ctx.capabilitySummary 
    ? `\n\n【能力状态】\n${ctx.capabilitySummary}\n`
    : '';
  
  return substituteVariables(template, {
    goals: ctx.goals,
    recentDone: ctx.recentDone,
    totalCycles: ctx.totalCycles.toString(),
    capabilitySummary,
  }).replace('{capabilitySummary}', capabilitySummary);
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
  
  // Retrieve relevant principles for this task (Experience Distillation closed loop)
  const evolutionId = `evolution-${cycle}-${taskId.replace('#', '')}`;
  const principles = getPrinciplesForEvolution(taskId, taskTitle, evolutionId);
  
  return substituteVariables(template, {
    cycle: cycle.toString(),
    taskId,
    taskTitle,
    recentHistory: ctx.recentHistory,
    totalCycles: ctx.totalCycles.toString(),
    currentStreak: ctx.currentStreak.toString(),
    strategyModifier,
    principles,
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
