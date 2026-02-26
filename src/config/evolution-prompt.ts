import { log } from "../util/log.js";

/**
 * Evolution prompt templates - configurable via environment variables.
 *
 * This module centralizes all evolution-related prompts to make them
 * configurable without code changes. Supports template variable substitution.
 */

// Default prompt templates
const DEFAULT_TEMPLATES = {
  /**
   * Main evolution cycle prompt template.
   * Variables: {cycle}
   */
  EVOLUTION_CYCLE: `这是你第 {cycle} 次进化循环。

按照 BORN.md 中的进化循环执行：
1. 评估 —— 查看 codebase，找出最有价值的改进
2. 选择 —— 选一件事（只选一件）
3. 实现 —— 完整实现 + 测试
4. 提交 —— git commit，版本递增
5. 汇报 —— 告诉我我做了什么

【重要】进度汇报要求：
在每个阶段完成后，必须使用 send_owner_message 工具向创造者发送进度更新：
- 评估完成后: "🧬 Evolution #{cycle} - 评估完成：找到 X 个改进点"
- 选择完成后: "🧬 Evolution #{cycle} - 选择完成：决定做 XXX"
- 实现完成后: "🧬 Evolution #{cycle} - 实现完成：已修改 XXX 文件"
- 验证完成后: "🧬 Evolution #{cycle} - 验证完成：测试通过"
- 提交完成后: "🧬 Evolution #{cycle} - 提交完成：版本 X.X.X"
- 最终汇报结果

执行完成后，必须发送一条文本消息汇报最终结果。`,

  /**
   * Consciousness check prompt (when not in evolution mode).
   */
  CONSCIOUSNESS_CHECK:
    "Wake up. Briefly check your state: " +
    "read identity.md and scratchpad.md, " +
    "note anything worth acting on, " +
    "update scratchpad if needed. " +
    "Keep it short — this is a routine check, not a deep dive.",
} as const;

/**
 * Get the evolution cycle prompt for a specific cycle number.
 * Uses EVOLUTION_CYCLE_PROMPT env var if set, otherwise uses default template.
 */
export function getEvolutionCyclePrompt(cycle: number): string {
  const template = process.env.EVOLUTION_CYCLE_PROMPT || DEFAULT_TEMPLATES.EVOLUTION_CYCLE;
  return substituteVariables(template, { cycle: cycle.toString() });
}

/**
 * Get the consciousness check prompt.
 * Uses CONSCIOUSNESS_CHECK_PROMPT env var if set, otherwise uses default.
 */
export function getConsciousnessCheckPrompt(): string {
  return process.env.CONSCIOUSNESS_CHECK_PROMPT || DEFAULT_TEMPLATES.CONSCIOUSNESS_CHECK;
}

/**
 * Get a custom prompt by name (for future extensibility).
 */
export function getPrompt(name: keyof typeof DEFAULT_TEMPLATES): string {
  const envVar = `PROMPT_${name}`;
  return process.env[envVar] || DEFAULT_TEMPLATES[name];
}

/**
 * Substitute variables in a template string.
 * Format: {variableName}
 */
function substituteVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}

/**
 * Validate that a custom prompt template has required variables.
 * Returns true if valid, false otherwise.
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

/**
 * Get all available prompt template names.
 */
export function getAvailablePromptNames(): string[] {
  return Object.keys(DEFAULT_TEMPLATES);
}

/**
 * Get default templates (for documentation/testing).
 */
export function getDefaultTemplates(): typeof DEFAULT_TEMPLATES {
  return { ...DEFAULT_TEMPLATES };
}
