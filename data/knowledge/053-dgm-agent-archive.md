# DGM Agent Archive 机制研究

**来源:** Sakana AI 的 Darwin Gödel Machine (ICLR 2026)
**研究日期:** 2026-03-05
**状态:** 已实现并集成

---

## 概述

Darwin Gödel Machine (DGM) 是 Sakana AI 提出的一种开放式进化框架，在 SWE-bench 上将性能从 20% 提升到 50%。其关键创新是 **Agent Archive** 机制。

### 核心问题

传统进化系统只有单一进化路径，容易陷入局部最优。DGM 通过 Agent Archive 解决这个问题。

## Agent Archive 核心概念

### 1. Archive Entry（存档条目）

每个分支在关键时刻的状态快照：

```typescript
interface ArchiveEntry {
  id: string;              // 唯一分支标识
  parentId: string | null; // 父分支ID（谱系追踪）
  name: string;            // 分支名称
  state: BranchState;      // 状态快照
  fitness: number;         // 适应度分数
  diversityScore: number;  // 多样性贡献
  explorationTags: string[]; // 探索方向标签
  status: "exploring" | "converged" | "stagnant" | "abandoned";
}
```

### 2. Diversity Metrics（多样性度量）

衡量不同分支之间的差异程度：

```typescript
// 计算两个分支的相似度 (0-1)
function calculateBranchSimilarity(a: ArchiveEntry, b: ArchiveEntry): number {
  // 考虑因素:
  // - 能力重叠 (权重 0.3)
  // - 策略匹配 (权重 0.2)
  // - 标签重叠 (权重 0.3)
  // - 适应度接近度 (权重 0.2)
}

// 多样性 = 1 - 平均相似度
```

### 3. Selection Strategy（选择策略）

平衡利用（最佳表现者）和探索（多样路径）：

- **best**: 选择适应度最高的分支
- **diverse**: 选择最独特的分支
- **balanced**: 综合考虑适应度和多样性
- **random**: 随机选择

```typescript
// 平衡选择使用 softmax 概率分布
score = fitness * fitnessWeight + diversity * diversityWeight;
// 默认: fitnessWeight=0.6, diversityWeight=0.4
```

### 4. Branch Lineage（分支谱系）

追踪进化关系，支持：

- 从当前分支创建新分支（spawnBranch）
- 合并学习成果（mergeLearnings）
- 剪枝不活跃分支（pruneBranches）

## 在 Jinx 中的实现

### 文件结构

```
src/evolution/
├── agent-archive.ts      # 核心实现 (24KB)
└── archive-integration.ts # 进化循环集成 (12KB)
```

### 集成点

在 `src/consciousness/loop.ts` 中：

1. **初始化**: `initializeArchive()` - 系统启动时加载或创建存档
2. **进化前**: `prepareArchiveContext()` - 选择分支、检查是否需要创建新分支
3. **进化后**: `recordEvolutionToArchive()` - 记录结果、更新适应度

### 自动分支创建

系统会在以下情况自动创建新探索分支：

- 多样性过低（< 0.15）
- 所有分支都停滞
- 任务标题包含探索关键词（"research", "探索", "investigate"等）

### 分支状态转换

```
exploring → stagnant (停滞: 连续 N 次无改进)
exploring → converged (收敛: 高适应度 + 低方差)
stagnant → abandoned (放弃: 被剪枝)
```

## 关键配置

```typescript
const DEFAULT_CONFIG = {
  maxActiveBranches: 5,      // 最大活跃分支数
  maxArchiveSize: 50,        // 存档大小上限
  minFitnessImprovement: 0.05, // 最小改进阈值
  stagnantThreshold: 5,      // 停滞判定周期数
  diversityWeight: 0.4,      // 多样性权重
  fitnessWeight: 0.6,        // 适应度权重
};
```

## 修复的 Bug

在实现过程中发现并修复了一个 bug：

**文件**: `src/evolution/archive-integration.ts`
**问题**: `detectCapabilities()` 函数使用了未导入的 `fs` 和 `path` 对象
**修复**: 改用已导入的 `existsSync` 和 `join`

```diff
- if (fs.existsSync(path.join(process.cwd(), "src/evolution/agent-archive.ts"))) {
+ if (existsSync(join(cwd, "src/evolution/agent-archive.ts"))) {
```

## DGM 论文关键洞察

1. **开放式进化**: 不预设目标函数，让系统自主探索
2. **避免 Objective Hacking**: 监控代理是否"黑入"奖励函数
3. **并行探索**: 多条分支同时进化，增加找到最优解的概率
4. **谱系记忆**: 保留失败分支的经验，避免重复错误

## 后续改进方向

1. **可视化仪表盘**: 在站点展示分支树和进化历史
2. **跨分支学习**: 实现更智能的 learnings 合并机制
3. **动态配置**: 根据系统状态自动调整 archive 参数
4. **回滚机制**: 从存档分支恢复到之前的状态

---

## 参考资料

- DGM 论文: Sakana AI, ICLR 2026
- 实现文件: `src/evolution/agent-archive.ts`, `src/evolution/archive-integration.ts`
- 集成文件: `src/consciousness/loop.ts`