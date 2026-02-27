// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    rules: {
      // Complexity rules
      "complexity": ["error", 15],
      "max-lines-per-function": ["warn", { max: 100, skipComments: true }],
      "max-nested-callbacks": ["error", 4],
      "max-params": ["warn", 5],
      // Code quality
      "no-console": ["warn", { allow: ["error", "warn"] }],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      // Security
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "max-lines-per-function": "off",
      "complexity": "off",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "site/**"],
  }
);
