import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use forks instead of threads for better stability with Node.js 24
    // Threads can have file system race conditions with ESM imports
    pool: "forks",
    poolOptions: {
      forks: {
        // Limit concurrent forks to avoid resource contention
        maxForks: 4,
        minForks: 1,
        // Allow tests to run longer if needed
        execArgv: ["--max-old-space-size=4096"],
      },
    },
    // Increase timeout for git operations
    testTimeout: 30000,
    // Ensure proper ESM handling
    deps: {
      interopDefault: true,
    },
    // Isolate tests to prevent cross-test pollution
    isolate: true,
    // Run tests sequentially within each fork to avoid FS race conditions
    fileParallelism: false,
  },
  resolve: {
    // Ensure TypeScript extensions are properly resolved
    extensions: [".ts", ".js", ".json"],
  },
  esbuild: {
    // Ensure consistent ESM output
    format: "esm",
  },
});
