#!/usr/bin/env npx tsx
/**
 * Quick web search script for goal discovery
 */
import { webSearch, formatSearchResults } from "../src/search/web-search.js";

async function main() {
  const query = process.argv[2] || "AI agent framework 2025 best practices";
  console.log(`Searching: ${query}\n`);
  
  try {
    const result = await webSearch({ query, count: 10 });
    console.log(formatSearchResults(result));
  } catch (e) {
    console.error("Search failed:", (e as Error).message);
    process.exit(1);
  }
}

main();