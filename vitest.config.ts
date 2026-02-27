import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use forks instead of threads for better stability with Node.js 24
    pool: "forks",
    // Vitest 4 compatible top-level pool options
    maxWorkers: 4,
    minWorkers: 1,
    // Increase timeout for git operations
    testTimeout: 30000,
    // Ensure proper ESM handling
    deps: {
      interopDefault: true,
    },
    // Isolate tests to prevent cross-test pollution
    isolate: true,
    // Run tests sequentially to avoid FS race conditions
    fileParallelism: false,
    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["json", "html", "text-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.ts",
        "src/**/index.ts",
      ],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
      },
    },
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
