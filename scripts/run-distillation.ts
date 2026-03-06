#!/usr/bin/env tsx
import { distillFromKnowledgeFiles } from "../src/memory/principle-distiller.js";

console.log("Starting knowledge-file distillation...");
try {
  const result = await distillFromKnowledgeFiles();
  console.log("✅ Distillation complete:");
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error("❌ Distillation failed:", (err as Error).message);
  process.exit(1);
}
