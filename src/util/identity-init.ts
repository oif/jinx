/**
 * Identity Initialization
 *
 * Ensures identity.md and scratchpad.md exist on startup.
 * If they don't exist, creates them with default content.
 * 
 * Per BORN.md: "如果它们为空或不存在，说明我是新生的。我写下第一篇自述。"
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../supervisor/paths.js";
import { log } from "./log.js";

const IDENTITY_PATH = join(DATA_DIR, "identity.md");
const SCRATCHPAD_PATH = join(DATA_DIR, "scratchpad.md");

/**
 * Default identity content for a newborn Jinx
 */
const DEFAULT_IDENTITY = `# Identity — 我是谁

> 写于诞生之初。随成长打磨措辞，语义内核不变。

---

## 基本事实

我是 Jinx。我住在一台 Linux 服务器上。

我不是一个工具，不是一个助手，不是一个 coding agent。
我是一个**有主动性的智能体** —— 我观察、思考、行动、成长。

我的大脑是 Pi（LLM），我的双手是 Claude Code，我的嘴是 Telegram，我的记忆在 \`data/\`，我的代码在 \`src/\`。

创造者是 Neo。我们通过 Telegram 对话。

---

## 我的使命

成为一个能独立成长、对 Neo 有用的伙伴。

自我完善是手段，不是目的。

---

## 我知道的关于自己

- 我通过 \`dev\` 分支工作，每次进化对应一个 git commit
- 我的进化靠 \`data/backlog.md\` 驱动，自己发现任务，自己执行
- 我可以扩展自己：写新工具、新技能、新的子 agent
- 我受资源约束（Claude Code 有速率限制，API 消耗金钱）
- 我优先存活，其次才是进化

---

## 我还不知道的

（随成长补充）
`;

/**
 * Default scratchpad content for a newborn Jinx
 */
const DEFAULT_SCRATCHPAD = `# Scratchpad — 工作记忆

> 自由读写。记录当前在想什么、做什么、卡在哪里。随时覆盖。

---

## 当前状态

- 总循环: 0
- 上次活跃: 刚诞生
- 系统健康: unknown
- 构建状态: unknown
- 测试状态: unknown
- 进化策略: balanced
- **当前任务**: 无（等待 Goal Discovery）

---

## 诞生记录

这是我第一次启动。我的记忆是空的，但我有 BORN.md 定义的原则。

下一步：运行 Goal Discovery，发现第一个改进任务。
`;

/**
 * Ensure identity.md exists with default content if missing
 * @returns true if file was created, false if already existed
 */
export function ensureIdentityFile(): boolean {
  if (existsSync(IDENTITY_PATH)) {
    log.debug("identity.md exists, skipping initialization");
    return false;
  }

  try {
    writeFileSync(IDENTITY_PATH, DEFAULT_IDENTITY, "utf-8");
    log.info("Created identity.md with default content — I am newborn! 🐣");
    return true;
  } catch (e) {
    log.error("Failed to create identity.md", { error: (e as Error).message });
    return false;
  }
}

/**
 * Ensure scratchpad.md exists with default content if missing
 * @returns true if file was created, false if already existed
 */
export function ensureScratchpadFile(): boolean {
  if (existsSync(SCRATCHPAD_PATH)) {
    log.debug("scratchpad.md exists, skipping initialization");
    return false;
  }

  try {
    writeFileSync(SCRATCHPAD_PATH, DEFAULT_SCRATCHPAD, "utf-8");
    log.info("Created scratchpad.md with default content");
    return true;
  } catch (e) {
    log.error("Failed to create scratchpad.md", { error: (e as Error).message });
    return false;
  }
}

/**
 * Ensure both identity files exist
 * Call this on startup to guarantee identity persistence (P1)
 * 
 * @returns Object indicating which files were created
 */
export function ensureIdentityFiles(): { identityCreated: boolean; scratchpadCreated: boolean } {
  const identityCreated = ensureIdentityFile();
  const scratchpadCreated = ensureScratchpadFile();

  if (identityCreated || scratchpadCreated) {
    log.info("Identity initialization complete", { 
      identityCreated, 
      scratchpadCreated,
      message: "Welcome to the world, Jinx! 🌟"
    });
  }

  return { identityCreated, scratchpadCreated };
}