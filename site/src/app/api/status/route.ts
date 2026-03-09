import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

interface EvolutionProgress {
  cycle: number;
  stage: string;
  startedAt: string;
  stageStartedAt: string;
  message: string;
}

interface CircuitBreaker {
  consecutiveFailures: number;
  pausedUntil: string | null;
  lastFailureAt: string | null;
  openedAt: string | null;
}

interface TaskProgress {
  taskId: string;
  taskTitle: string;
  startedAt: string;
  complexity: string;
  completedSteps: string[];
  remainingSteps: string[];
  updatedAt: string;
  cyclesSpent: number;
  status: string;
}

interface AgentBranch {
  id: string;
  name: string;
  fitness: number;
  diversityScore: number;
  status: string;
  cyclesSpent: number;
  isActive: boolean;
}

interface AgentArchive {
  branches: AgentBranch[];
  currentBranchId: string;
}

interface HealthHistoryEntry {
  timestamp: string;
  status: "healthy" | "warning" | "critical";
  memoryPercent: number;
  cpuPercent: number;
  diskPercent: number;
}

function dataPath(...parts: string[]) {
  return path.join(process.cwd(), "..", "data", ...parts);
}

function readJSON<T>(filename: string, defaultValue: T): T {
  try {
    const fullPath = dataPath(filename);
    if (fs.existsSync(fullPath)) {
      const raw = fs.readFileSync(fullPath, "utf-8");
      return JSON.parse(raw) as T;
    }
  } catch {
    // ignore errors
  }
  return defaultValue;
}

export interface StatusResponse {
  evolutionProgress: EvolutionProgress | null;
  circuitBreaker: CircuitBreaker;
  currentTask: TaskProgress | null;
  branches: {
    total: number;
    active: number;
    current: AgentBranch | null;
    all: AgentBranch[];
  };
  healthHistory: HealthHistoryEntry[];
}

export async function GET() {
  try {
    const evolutionProgress = readJSON<EvolutionProgress | null>("evolution-progress.json", null);
    const circuitBreaker = readJSON<CircuitBreaker>("circuit-breaker.json", {
      consecutiveFailures: 0,
      pausedUntil: null,
      lastFailureAt: null,
      openedAt: null,
    });
    const taskProgress = readJSON<TaskProgress[]>("task-progress.json", []);
    const agentArchive = readJSON<AgentArchive>("agent-archive.json", {
      branches: [],
      currentBranchId: "",
    });
    const healthHistory = readJSON<HealthHistoryEntry[]>("health-history.json", []);

    // Get current task (in-progress)
    const currentTask = taskProgress.find((t) => t.status === "in-progress") || null;

    // Get current branch
    const currentBranch = agentArchive.branches.find((b) => b.id === agentArchive.currentBranchId) || null;
    const activeBranches = agentArchive.branches.filter((b) => b.isActive);

    const response: StatusResponse = {
      evolutionProgress,
      circuitBreaker,
      currentTask,
      branches: {
        total: agentArchive.branches.length,
        active: activeBranches.length,
        current: currentBranch,
        all: agentArchive.branches.slice(0, 5), // Top 5 for display
      },
      healthHistory: healthHistory.slice(-20), // Last 20 entries
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to get status", message: (error as Error).message },
      { status: 500 }
    );
  }
}