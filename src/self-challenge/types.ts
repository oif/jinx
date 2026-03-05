/**
 * Self-Challenge Module - Types and Interfaces
 * 
 * Inspired by NeurIPS 2025 "Self-Challenging Language Model Agents" (Zhou et al.)
 * Code-as-Task (CaT) formalism for self-generated, verifiable training tasks.
 */

// ── Core Types ─────────────────────────────────────────────────────────────

/**
 * Challenge categories aligned with goal discovery dimensions
 */
export type ChallengeCategory = 
  | 'capability_gap'      // 能力缺口分析
  | 'experience_mining'   // 经验挖掘
  | 'external_discovery'; // 外部发现

/**
 * Difficulty levels for challenge tasks
 */
export type ChallengeDifficulty = 'easy' | 'medium' | 'hard';

/**
 * Verification condition - a single checkable criterion
 */
export interface VerificationCondition {
  description: string;
  type: 'test' | 'build' | 'functional' | 'custom';
  checkCommand?: string;  // e.g., "pnpm test", "pnpm build"
  expectedOutcome: string;
}

/**
 * Self-Challenge Task format (Code-as-Task inspired)
 * 
 * Each task contains:
 * - Instruction: what to do
 * - Verification: how to verify success
 * - Example approach: one possible solution
 * - Failure cases: what to avoid
 */
export interface ChallengeTask {
  /** Unique identifier (e.g., "#062") */
  id: string;
  
  /** Task title */
  title: string;
  
  /** Category from goal discovery */
  category: ChallengeCategory;
  
  /** Difficulty assessment */
  difficulty: ChallengeDifficulty;
  
  /** Detailed instruction for the task */
  instruction: string;
  
  /** Verification conditions (must be executable/checkable) */
  verificationConditions: VerificationCondition[];
  
  /** Example approach or solution sketch */
  exampleApproach: string;
  
  /** Possible failure cases to avoid */
  failureCases: string[];
  
  /** Why this challenge is valuable */
  dependencyValue: string;
  
  /** Dependencies on other tasks (optional) */
  dependencies?: string[];
  
  /** Creation timestamp */
  createdAt: string;
  
  /** Task source (self-generated vs external) */
  source: 'self_challenge' | 'external';
}

/**
 * Result of verifying a challenge task
 */
export interface VerificationResult {
  passed: boolean;
  conditionResults: {
    condition: VerificationCondition;
    passed: boolean;
    output?: string;
    error?: string;
  }[];
  overallScore: number;  // 0-1, percentage of conditions passed
  summary: string;
}

/**
 * Challenge history record
 */
export interface ChallengeRecord {
  task: ChallengeTask;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  verificationResult?: VerificationResult;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  lessonsLearned?: string[];
}

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Default verification conditions for common task types
 */
export const DEFAULT_VERIFICATION_CONDITIONS: Record<string, VerificationCondition[]> = {
  code_change: [
    {
      description: 'Tests pass',
      type: 'test',
      checkCommand: 'pnpm test',
      expectedOutcome: 'All tests pass',
    },
    {
      description: 'Type check passes',
      type: 'build',
      checkCommand: 'pnpm build',
      expectedOutcome: 'No type errors',
    },
  ],
  bug_fix: [
    {
      description: 'Original failing test now passes',
      type: 'test',
      checkCommand: 'pnpm test',
      expectedOutcome: 'Previously failing test now passes',
    },
    {
      description: 'No regressions',
      type: 'test',
      checkCommand: 'pnpm test',
      expectedOutcome: 'All other tests still pass',
    },
  ],
  feature: [
    {
      description: 'Feature works as expected',
      type: 'functional',
      expectedOutcome: 'Manual verification or integration test',
    },
    {
      description: 'Tests cover new functionality',
      type: 'test',
      checkCommand: 'pnpm test',
      expectedOutcome: 'New tests exist and pass',
    },
  ],
};

// ── Utility Functions ─────────────────────────────────────────────────────────

/**
 * Check if a task follows the ChallengeTask format
 */
export function isChallengeTask(task: unknown): task is ChallengeTask {
  if (typeof task !== 'object' || task === null) return false;
  
  const t = task as Partial<ChallengeTask>;
  return (
    typeof t.id === 'string' &&
    typeof t.title === 'string' &&
    typeof t.category === 'string' &&
    typeof t.difficulty === 'string' &&
    typeof t.instruction === 'string' &&
    Array.isArray(t.verificationConditions) &&
    typeof t.exampleApproach === 'string' &&
    Array.isArray(t.failureCases)
  );
}

/**
 * Create a simple challenge task from backlog format
 */
export function createChallengeFromBacklog(
  id: string,
  title: string,
  category: ChallengeCategory = 'capability_gap'
): ChallengeTask {
  return {
    id,
    title,
    category,
    difficulty: 'medium',
    instruction: title,
    verificationConditions: DEFAULT_VERIFICATION_CONDITIONS.code_change,
    exampleApproach: 'To be determined during implementation',
    failureCases: ['Tests fail', 'Build fails', 'Functionality does not work as expected'],
    dependencyValue: 'To be assessed',
    createdAt: new Date().toISOString(),
    source: 'external',
  };
}

/**
 * Format a challenge task for display
 */
export function formatChallengeTask(task: ChallengeTask): string {
  const lines = [
    `### Challenge ${task.id}: ${task.title}`,
    '',
    `**Category**: ${task.category}`,
    `**Difficulty**: ${task.difficulty}`,
    '',
    '**Instruction**:',
    task.instruction,
    '',
    '**Verification Conditions**:',
    ...task.verificationConditions.map((v) => 
      `- [ ] ${v.description}${v.checkCommand ? ` (\`${v.checkCommand}\`)` : ''}`
    ),
    '',
    '**Example Approach**:',
    task.exampleApproach,
    '',
    '**Possible Failure Cases**:',
    ...task.failureCases.map(f => `${task.failureCases.indexOf(f) + 1}. ${f}`),
    '',
    '**Dependency Value**:',
    task.dependencyValue,
  ];
  
  return lines.join('\n');
}

// ── Export ───────────────────────────────────────────────────────────────────

export default {
  isChallengeTask,
  createChallengeFromBacklog,
  formatChallengeTask,
  DEFAULT_VERIFICATION_CONDITIONS,
};