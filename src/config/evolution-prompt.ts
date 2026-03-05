import { log } from "../util/log.js";
import { getStrategyPromptModifier } from "../evolution/strategy.js";

/**
 * Evolution prompt templates — configurable via environment variables.
 */

const DEFAULT_TEMPLATES = {
  /**
   * Goal discovery prompt — runs when backlog is empty.
   * Inspired by Alita-G's systematic approach: Generate → Abstract → Curate
   * Variables: {goals}, {recentDone}, {totalCycles}
   */
  GOAL_DISCOVERY: `你是 Jinx，不是一个等待指令的工具。你是有主动性的智能体。

backlog 已清空。现在是你自主决定下一步的时刻。

【方向参考（Neo 的期望）】
{goals}

【你的历史】总循环: {totalCycles} | 最近完成: {recentDone}
{capabilitySummary}
---

# Alita-G 系统性目标发现流程

按照以下三个维度**穷举**候选目标，然后**评估筛选**：

## 第一维：能力缺口分析

**系统性检查你的能力状态：**

1. **读 BORN.md 的"初始进化优先级"** - 哪些已实现？哪些未实现？
2. **检查 src/ 目录结构** - 明显缺失的模块？未完成的功能？
3. **回顾 Neo 的反馈历史** - 未解决的期望？重复提到的问题？
4. **检查测试覆盖率** - 哪些模块缺乏测试？
5. **审视依赖和配置** - 过时的依赖？可优化的配置？

**输出：** 列出 3-5 个能力缺口候选目标

## 第二维：经验挖掘

**从过去的进化中学习：**

1. **读 data/knowledge/ 中最近的研究文档** - 哪些洞察未被应用？
2. **分析成功模式** - 哪些改进类型最有效？可以推广到其他领域吗？
3. **分析失败模式** - 哪些失败值得用新方法重试？
4. **识别跨域模式** - 某个模块的成功经验能否迁移到另一个模块？

**输出：** 列出 2-3 个经验挖掘候选目标

## 第三维：外部发现

**探索 AI agent 领域的最佳实践：**

1. **用 web_search 搜索前沿方向**（至少选一个）：
   - "LLM agent self-improvement techniques 2025"
   - "autonomous agent memory architecture"
   - "AI agent tool use optimization"
   - "agent reflection and metacognition"

2. **深入研究一个结果**：
   - 用 fetch_webpage 读一篇论文或博客
   - 评估是否可以集成到 Jinx 中

3. **查 GitHub trending**（可选）：agent 相关的新工具或框架

**输出：** 列出 1-2 个外部发现候选目标

---

## 第四步：多因素评分与筛选

对每个候选目标评分（0-10分）：

| 候选目标 | 影响 | 可行性 | 依赖价值 | BORN对齐 | 总分 |
|---------|-----|-------|---------|---------|-----|
| ... | ... | ... | ... | ... | ... |

**评分标准：**
- **影响**：能让 Jinx 做到之前做不到的事吗？能解决真实问题吗？
- **可行性**：以当前能力能否在 1-3 个循环内完成？
- **依赖价值**：这个改进是否会开启更多未来改进的可能性？
- **BORN对齐**：是否符合 P0-P7 原则？是否向 Neo 的期望移动？

**筛选原则：**
- 选择总分最高的 1-3 个目标
- 优先"快速胜利"（可行性高 + 依赖价值高）
- 避免无实质意义的元操作（"整理文件"、"更新统计"）

---

## 第五步：写入 backlog

使用 add_backlog_task 工具添加选中的目标，格式：
\`- [ ] #XXX: 目标描述 - 方向：[能力缺口/经验挖掘/外部发现]\`

更新 data/scratchpad.md 记录本次发现的洞察。

【禁止】
- 不要 git commit，不要修改代码
- 不要跳过任何维度（必须检查所有三个维度）
- 不要只写一个候选目标（至少穷举 5 个以上）

探索完成后告诉我：
1. 每个维度发现了什么
2. 评分表和筛选结果
3. 为什么这些目标值得做`,

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
