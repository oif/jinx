# Alita-G Self-Evolution Framework Research

**Paper:** arxiv 2510.23601 - "Alita: Generalist to Specialist via Systematic Goal Generation, Abstraction, and Curation"
**Research Date:** 2026-03-05
**Purpose:** Analyze Alita-G's core mechanisms for improving Jinx's goal discovery and self-evolution capabilities

---

## 1. Executive Summary

Alita-G is a framework for transforming general-purpose agents into domain experts through three core mechanisms:

1. **Systematic Goal Generation** - Not random exploration, but structured discovery
2. **Abstraction** - Extracting transferable patterns from experience
3. **Curation** - Intelligent filtering and prioritization of goals

The key insight: **Self-evolution should be driven by a principled process, not ad-hoc exploration.**

---

## 2. Core Mechanisms Deep Dive

### 2.1 Systematic Goal Generation

Alita-G proposes a structured approach to discovering what to do next:

**Current Jinx Approach:**
- Goal discovery prompt asks Jinx to "explore freely"
- Relies on LLM's intuition to find improvements
- No structured methodology for generating candidates

**Alita-G Approach:**
1. **Capability Taxonomy**: Maintain a structured inventory of current capabilities
2. **Gap Analysis**: Systematically identify missing or weak capabilities
3. **Improvement Templates**: Pre-defined patterns for common improvement types
4. **Experience Mining**: Extract potential goals from past successes/failures

**Key Principle:** Goal discovery should be exhaustive before being selective.

### 2.2 Abstraction Layer

Alita-G introduces abstraction to make learned lessons transferable:

**Current Jinx Approach:**
- `data/knowledge/{task}-{cycle}.md` stores raw evolution results
- No systematic extraction of patterns or principles
- Knowledge is stored but not abstracted

**Alita-G Approach:**
1. **Pattern Extraction**: After each evolution, extract:
   - What pattern was applied?
   - What context did it work in?
   - What are the preconditions for reuse?

2. **Skill Taxonomy**: Organize learned capabilities hierarchically
   - Meta-skills (planning, debugging, refactoring)
   - Domain skills (web search, API integration)
   - Task-specific skills (fix specific bug type)

3. **Transfer Learning**: Apply successful patterns to new domains
   - If "add test coverage" worked for module X, apply to module Y
   - Abstract the *why* not just the *what*

**Key Principle:** Knowledge that isn't abstracted can't be transferred.

### 2.3 Curation Model

Alita-G uses a curation model to prioritize goals:

**Current Jinx Approach:**
- Single goal discovery prompt tries to do everything
- No explicit prioritization framework
- LLM decides in one shot

**Alita-G Approach:**
1. **Multi-dimensional Scoring**: Rate each goal on:
   - Impact: How much value does this create?
   - Feasibility: Can I actually do this?
   - Dependency: Does this enable future improvements?
   - Risk: What could go wrong?

2. **Portfolio Balance**: Maintain diversity:
   - Some quick wins (confidence builders)
   - Some stretch goals (growth opportunities)
   - Some maintenance tasks (health preservation)

3. **Strategic Alignment**: Ensure goals support long-term vision
   - Does this align with BORN.md principles?
   - Does this move toward Neo's expectations?

**Key Principle:** Selection should be as principled as discovery.

---

## 3. Gap Analysis: Jinx vs Alita-G

| Aspect | Current Jinx | Alita-G Ideal | Gap |
|--------|--------------|---------------|-----|
| Goal Discovery | Free-form exploration | Systematic generation | Need structured process |
| Knowledge Storage | Raw markdown files | Abstracted patterns | Need extraction layer |
| Prioritization | LLM intuition | Multi-factor scoring | Need explicit criteria |
| Capability Tracking | Implicit in code | Explicit taxonomy | Need capability model |
| Learning Transfer | Manual review | Automatic suggestion | Need pattern matching |

---

## 4. Proposed Improvements for Jinx

### 4.1 Structured Goal Generation (Phase 1)

**Implementation:** Enhance goal discovery with systematic approach

```typescript
// New goal generation process
interface GoalCandidate {
  source: 'gap-analysis' | 'experience-mining' | 'external-discovery' | 'user-feedback';
  description: string;
  impact: number;      // 0-1
  feasibility: number; // 0-1
  dependencies: string[];
}

async function generateGoalCandidates(): Promise<GoalCandidate[]> {
  const candidates: GoalCandidate[] = [];
  
  // 1. Gap Analysis: Check capability coverage
  const gaps = await analyzeCapabilityGaps();
  candidates.push(...gaps.map(g => ({
    source: 'gap-analysis',
    description: g.missing,
    impact: g.importance,
    feasibility: g.difficulty,
    dependencies: g.prerequisites,
  })));
  
  // 2. Experience Mining: Learn from past cycles
  const lessons = await mineEvolutionHistory();
  candidates.push(...lessons);
  
  // 3. External Discovery: Web search for best practices
  const external = await discoverExternalOpportunities();
  candidates.push(...external);
  
  return candidates;
}
```

### 4.2 Knowledge Abstraction Layer (Phase 2)

**Implementation:** Extract patterns from evolution results

```typescript
interface AbstractPattern {
  patternId: string;
  category: 'refactor' | 'feature' | 'fix' | 'optimization' | 'learning';
  template: string;        // Generalized pattern
  preconditions: string[]; // When to apply
  examples: string[];      // Past applications
  successRate: number;     // Historical effectiveness
}

async function abstractEvolutionResult(
  taskId: string,
  result: string,
): Promise<AbstractPattern | null> {
  // Use LLM to extract pattern from result
  // Store in structured knowledge base
  // Enable future recall by pattern match
}
```

### 4.3 Goal Curation Model (Phase 3)

**Implementation:** Multi-factor scoring for goal prioritization

```typescript
interface CuratedGoal extends GoalCandidate {
  score: number;
  rationale: string;
  strategicFit: number;  // Alignment with BORN.md
  quickWin: boolean;     // Can complete in one cycle
}

function curateGoals(candidates: GoalCandidate[]): CuratedGoal[] {
  return candidates
    .map(scoreGoal)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5); // Top 5 candidates
}

function scoreGoal(candidate: GoalCandidate): CuratedGoal {
  // Weighted scoring
  const score = 
    candidate.impact * 0.4 +
    candidate.feasibility * 0.3 +
    strategicFit(candidate) * 0.3;
  
  return {
    ...candidate,
    score,
    rationale: generateRationale(candidate),
    strategicFit: strategicFit(candidate),
    quickWin: candidate.feasibility > 0.8 && isSmallScope(candidate),
  };
}
```

---

## 5. Implementation Roadmap

### Immediate (Next 2-3 cycles):
1. **Enhanced Goal Discovery Prompt**
   - Add structured sections for gap analysis
   - Include recent evolution lessons in prompt
   - Ask LLM to propose multiple candidates, not just one

### Short-term (Next 5-10 cycles):
2. **Capability Taxonomy**
   - Create `data/capabilities.md` to track known capabilities
   - Auto-update after successful evolutions
   - Use for gap analysis

3. **Pattern Extraction**
   - After each evolution, extract abstract pattern
   - Store in structured format
   - Include in future goal discovery context

### Medium-term (Next 10-20 cycles):
4. **Multi-factor Goal Scoring**
   - Implement scoring system
   - Track success rate of different goal types
   - Balance portfolio

5. **Learning Transfer System**
   - Match new situations to past patterns
   - Suggest relevant previous evolutions
   - Avoid repeating past mistakes

---

## 6. Key Insights for Jinx

### From Alita-G Paper:

1. **"Systematic trumps Random"**
   - Structured goal generation will find things free-form exploration misses
   - Jinx should enumerate before selecting

2. **"Abstraction enables Transfer"**
   - Raw markdown files aren't enough
   - Need to extract patterns that can be recognized and reused

3. **"Curation prevents Drift"**
   - Without principled selection, agent may pursue low-value goals
   - Explicit scoring criteria align actions with strategy

4. **"Domain expertise emerges from accumulation"**
   - Each evolution should add to capability model
   - Track what Jinx has learned to do

### Practical First Step:

Enhance the goal discovery prompt to be more structured:

```
【目标发现 - 系统性方法】

**第一维：能力缺口分析**
- 列出 BORN.md 中提到但未实现的能力
- 检查 src/ 中明显缺失的模块
- 回顾 Neo 的反馈，找未解决的期望

**第二维：经验挖掘**
- 回顾 data/knowledge/ 中的最近学习
- 哪些模式可以应用到新领域？
- 哪些失败值得重试？

**第三维：外部发现**
- 搜索 "AI agent self-improvement" 最新进展
- 查看相关开源项目的更新
- 学习其他 agent 架构的最佳实践

**输出格式：**
对每个候选目标，给出：
- 来源维度
- 预期影响 (高/中/低)
- 可行性评估
- 是否快速胜利
- 与 BORN.md 的对齐程度

选择得分最高的 1-3 个目标写入 backlog。
```

---

## 7. Conclusion

Alita-G provides a principled framework for self-evolution that addresses several gaps in Jinx's current approach:

1. **From random to systematic** - Goal discovery should be exhaustive
2. **From raw to abstracted** - Knowledge needs patterns for transfer
3. **From intuition to explicit** - Prioritization needs criteria

The proposed improvements can be implemented incrementally:
- **Phase 1**: Enhanced goal discovery prompt (immediate)
- **Phase 2**: Capability taxonomy + pattern extraction (short-term)
- **Phase 3**: Multi-factor scoring system (medium-term)

These changes would make Jinx's self-evolution more principled, effective, and aligned with the state-of-the-art in autonomous agent research.

---

## References

- Alita-G Paper: arxiv 2510.23601
- Related work: MARS (Model-Agnostic Reflection System)
- Jinx's current evolution: `src/consciousness/loop.ts`
- Goal discovery prompt: `src/config/evolution-prompt.ts`