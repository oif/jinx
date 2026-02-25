import { execSync } from "node:child_process";
import { log } from "../util/log.js";

const REPO_DIR = process.cwd();
const DEV_BRANCH = "dev";
const MAIN_BRANCH = "main";

function git(cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd: REPO_DIR,
    encoding: "utf-8",
    timeout: 60_000,
  }).trim();
}

/**
 * Get current HEAD SHA.
 */
export function getCurrentSha(): string {
  try {
    return git("rev-parse HEAD");
  } catch {
    return "unknown";
  }
}

/**
 * Get current branch name.
 */
export function getCurrentBranch(): string {
  try {
    return git("rev-parse --abbrev-ref HEAD");
  } catch {
    return "unknown";
  }
}

/**
 * Ensure we're on the dev branch. Create it from main if it doesn't exist.
 */
export function ensureDevBranch(): void {
  const current = getCurrentBranch();
  if (current === DEV_BRANCH) return;

  try {
    // Try to switch to dev
    git(`checkout ${DEV_BRANCH}`);
  } catch {
    // dev doesn't exist — create from current branch
    log.info(`Creating ${DEV_BRANCH} branch`);
    git(`checkout -b ${DEV_BRANCH}`);
  }
}

/**
 * Pull latest code from origin/dev.
 * Returns true if successful, false if failed.
 */
export function safePull(): boolean {
  try {
    // Stash any uncommitted changes
    const hasChanges = git("status --porcelain").length > 0;
    if (hasChanges) {
      git("stash");
    }

    git(`pull --rebase origin ${DEV_BRANCH}`);

    if (hasChanges) {
      try {
        git("stash pop");
      } catch {
        log.warn("Stash pop failed — changes may be lost");
        git("stash drop");
      }
    }

    log.info("Pull successful", { sha: getCurrentSha() });
    return true;
  } catch (e) {
    const err = e as Error;
    log.error("Pull failed", { error: err.message });
    return false;
  }
}

/**
 * Rollback to main branch. Used when dev is broken.
 */
export function rollbackToMain(): boolean {
  try {
    git("checkout -- ."); // Discard uncommitted changes
    git(`checkout ${MAIN_BRANCH}`);
    git(`pull origin ${MAIN_BRANCH}`);
    log.warn("Rolled back to main branch", { sha: getCurrentSha() });
    return true;
  } catch (e) {
    const err = e as Error;
    log.error("Rollback to main failed", { error: err.message });
    return false;
  }
}

/**
 * Verify that import works after pulling new code.
 * This is the "import test" — if it fails, we know the code is broken.
 */
export function verifyImport(): boolean {
  try {
    execSync("node -e \"import('./dist/main.js')\"", {
      cwd: REPO_DIR,
      encoding: "utf-8",
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Rebuild the project (npm install + tsc).
 */
export function rebuild(): boolean {
  try {
    execSync("npm install --omit=dev && npm run build", {
      cwd: REPO_DIR,
      encoding: "utf-8",
      timeout: 120_000,
      stdio: "pipe",
    });
    log.info("Rebuild successful");
    return true;
  } catch (e) {
    const err = e as Error;
    log.error("Rebuild failed", { error: err.message });
    return false;
  }
}
