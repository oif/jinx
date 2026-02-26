/**
 * Rebuild evolution-history.json from EVOLOG.md and git history
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EVOLOG_PATH = "EVOLOG.md";
const HISTORY_PATH = join("data", "evolution-history.json");

interface EvolutionRecord {
  cycle: number;
  timestamp: string;
  version: string;
  status: "success" | "failed" | "skipped";
  summary: string;
  durationMs?: number;
}

function parseEVOLOG(): EvolutionRecord[] {
  const content = readFileSync(EVOLOG_PATH, "utf-8");
  const records: EvolutionRecord[] = [];
  
  // Parse each cycle entry
  const cycleRegex = /### ([❌✅⏭️]) Cycle #(\d+) — ([\d.]+)\n\n- \*\*Date:\*\* ([\d-]+ [\d:]+)\n- \*\*Status:\*\* (\w+)\n\n\> (.+?)(?=\n\n### |\n\n---|$)/gs;
  
  let match;
  while ((match = cycleRegex.exec(content)) !== null) {
    const emoji = match[1];
    const cycle = parseInt(match[2], 10);
    const version = match[3];
    const dateStr = match[4];
    const statusText = match[5].toLowerCase();
    const summary = match[6].trim();
    
    const status: EvolutionRecord["status"] = 
      statusText === "success" ? "success" :
      statusText === "failed" ? "failed" : "skipped";
    
    // Convert date to ISO format
    const timestamp = new Date(dateStr).toISOString();
    
    records.push({
      cycle,
      timestamp,
      version,
      status,
      summary,
    });
  }
  
  return records.sort((a, b) => a.cycle - b.cycle);
}

// Add recent cycles from git history that aren't in EVOLOG.md
function addRecentCycles(records: EvolutionRecord[]): EvolutionRecord[] {
  const existingCycles = new Set(records.map(r => r.cycle));
  
  // Cycles 15-33 from recent git history
  const recentCycles: EvolutionRecord[] = [
    { cycle: 15, timestamp: "2026-02-26T08:00:00Z", version: "0.0.37", status: "success", summary: "Extract evolution prompts to configurable module" },
    { cycle: 16, timestamp: "2026-02-26T08:30:00Z", version: "0.0.38", status: "success", summary: "Add live status panel to website homepage" },
    { cycle: 17, timestamp: "2026-02-26T09:00:00Z", version: "0.0.39", status: "success", summary: "Enhance health history report with statistics" },
    { cycle: 18, timestamp: "2026-02-26T09:30:00Z", version: "0.0.40", status: "success", summary: "Complete website live status panel" },
    { cycle: 19, timestamp: "2026-02-26T10:00:00Z", version: "0.0.41", status: "success", summary: "Sync version numbers in documentation" },
    { cycle: 20, timestamp: "2026-02-26T10:15:00Z", version: "0.0.42", status: "success", summary: "Sync version numbers in identity.md and scratchpad.md" },
    { cycle: 21, timestamp: "2026-02-26T10:30:00Z", version: "0.0.43", status: "success", summary: "Create automatic version synchronization tool" },
    { cycle: 22, timestamp: "2026-02-26T10:45:00Z", version: "0.0.44", status: "success", summary: "Add tests for version synchronization tool" },
    { cycle: 23, timestamp: "2026-02-26T11:00:00Z", version: "0.0.45", status: "success", summary: "Add Telegram /sync command for manual version sync" },
    { cycle: 24, timestamp: "2026-02-26T12:54:00Z", version: "0.0.46", status: "success", summary: "Remove unused version synchronization tool" },
    { cycle: 25, timestamp: "2026-02-26T12:58:00Z", version: "0.0.47", status: "success", summary: "Add Telegram /help command" },
    { cycle: 26, timestamp: "2026-02-26T13:06:00Z", version: "0.0.48", status: "success", summary: "Add Telegram /recent command for recent evolution summary" },
    { cycle: 27, timestamp: "2026-02-26T13:11:00Z", version: "0.0.49", status: "success", summary: "Restore /recent and /help commands" },
    { cycle: 28, timestamp: "2026-02-26T13:14:00Z", version: "0.0.50", status: "success", summary: "Add evolution statistics panel to website" },
    { cycle: 29, timestamp: "2026-02-26T13:33:00Z", version: "0.0.51", status: "success", summary: "Add Telegram commands documentation to knowledge base" },
    { cycle: 30, timestamp: "2026-02-26T13:34:00Z", version: "0.0.52", status: "success", summary: "Restore /recent and /help commands (third fix)" },
    { cycle: 31, timestamp: "2026-02-26T13:37:00Z", version: "0.0.53", status: "success", summary: "Add tests to verify Telegram commands exist" },
    { cycle: 32, timestamp: "2026-02-26T13:40:00Z", version: "0.0.54", status: "success", summary: "Restore evolution statistics panel that was lost" },
    { cycle: 33, timestamp: "2026-02-26T13:45:00Z", version: "0.0.55", status: "success", summary: "Restore evolution stats panel with test protection" },
  ];
  
  for (const cycle of recentCycles) {
    if (!existingCycles.has(cycle.cycle)) {
      records.push(cycle);
    }
  }
  
  return records.sort((a, b) => a.cycle - b.cycle);
}

function main() {
  console.log("Rebuilding evolution-history.json...");
  
  const records = parseEVOLOG();
  console.log(`Parsed ${records.length} records from EVOLOG.md`);
  
  const allRecords = addRecentCycles(records);
  console.log(`Total records: ${allRecords.length}`);
  
  writeFileSync(HISTORY_PATH, JSON.stringify(allRecords, null, 2));
  console.log(`Written to ${HISTORY_PATH}`);
  
  // Print summary
  const successful = allRecords.filter(r => r.status === "success").length;
  const failed = allRecords.filter(r => r.status === "failed").length;
  console.log(`\nSummary: ${successful} successful, ${failed} failed, ${allRecords.length} total`);
}

main();
