import { describe, it, expect } from "vitest";
import {
  formatIssueList,
  formatPRList,
  formatPRAnalysis,
  formatRepoStats,
  type GitHubIssue,
  type GitHubPullRequest,
  type PRAnalysis,
  type RepoStats,
} from "../src/github/enhanced.js";

describe("github enhanced tools", () => {
  describe("formatIssueList", () => {
    it("formats empty issue list", () => {
      expect(formatIssueList([])).toBe("No issues found.");
    });

    it("formats issues correctly", () => {
      const issues: GitHubIssue[] = [
        {
          number: 1,
          title: "Test Issue",
          state: "open",
          body: "Test body",
          user: { login: "testuser" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
          closed_at: null,
          labels: [{ name: "bug", color: "ff0000" }],
          assignees: [{ login: "assignee" }],
          comments: 3,
          html_url: "https://github.com/owner/repo/issues/1",
        },
      ];

      const result = formatIssueList(issues);
      expect(result).toContain("Test Issue");
      expect(result).toContain("#1");
      expect(result).toContain("[bug]");
      expect(result).toContain("@assignee");
      expect(result).toContain("3 comments");
      expect(result).toContain("https://github.com/owner/repo/issues/1");
    });

    it("handles issues without labels or assignees", () => {
      const issues: GitHubIssue[] = [
        {
          number: 2,
          title: "Simple Issue",
          state: "open",
          body: "",
          user: { login: "user" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          closed_at: null,
          labels: [],
          assignees: [],
          comments: 0,
          html_url: "https://github.com/owner/repo/issues/2",
        },
      ];

      const result = formatIssueList(issues);
      expect(result).toContain("Simple Issue");
      expect(result).toContain("#2");
    });
  });

  describe("formatPRList", () => {
    it("formats empty PR list", () => {
      expect(formatPRList([])).toBe("No pull requests found.");
    });

    it("formats PRs correctly", () => {
      const prs: GitHubPullRequest[] = [
        {
          number: 42,
          title: "Feature PR",
          state: "open",
          body: "PR description",
          user: { login: "contributor" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
          head: { ref: "feature", sha: "abc123" },
          base: { ref: "main", sha: "def456" },
          labels: [{ name: "enhancement" }],
          assignees: [],
          draft: false,
          merged: false,
          mergeable: true,
          additions: 100,
          deletions: 20,
          changed_files: 5,
          html_url: "https://github.com/owner/repo/pull/42",
        },
      ];

      const result = formatPRList(prs);
      expect(result).toContain("Feature PR");
      expect(result).toContain("#42");
      expect(result).toContain("feature → main");
      expect(result).toContain("+100/-20");
      expect(result).toContain("https://github.com/owner/repo/pull/42");
    });

    it("marks draft PRs", () => {
      const prs: GitHubPullRequest[] = [
        {
          number: 43,
          title: "Draft PR",
          state: "open",
          body: "",
          user: { login: "user" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          head: { ref: "draft", sha: "abc" },
          base: { ref: "main", sha: "def" },
          labels: [],
          assignees: [],
          draft: true,
          merged: false,
          mergeable: null,
          additions: 10,
          deletions: 5,
          changed_files: 2,
          html_url: "https://github.com/owner/repo/pull/43",
        },
      ];

      const result = formatPRList(prs);
      expect(result).toContain("[DRAFT]");
    });

    it("marks merged PRs", () => {
      const prs: GitHubPullRequest[] = [
        {
          number: 44,
          title: "Merged PR",
          state: "closed",
          body: "",
          user: { login: "user" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
          head: { ref: "feature", sha: "abc" },
          base: { ref: "main", sha: "def" },
          labels: [],
          assignees: [],
          draft: false,
          merged: true,
          mergeable: null,
          additions: 50,
          deletions: 10,
          changed_files: 3,
          html_url: "https://github.com/owner/repo/pull/44",
        },
      ];

      const result = formatPRList(prs);
      expect(result).toContain("[MERGED]");
    });
  });

  describe("formatPRAnalysis", () => {
    it("formats PR analysis correctly", () => {
      const analysis: PRAnalysis = {
        pr: {
          number: 1,
          title: "Test PR",
          state: "open",
          body: "",
          user: { login: "user" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          head: { ref: "feat", sha: "abc" },
          base: { ref: "main", sha: "def" },
          labels: [],
          assignees: [],
          draft: false,
          merged: false,
          mergeable: true,
          additions: 100,
          deletions: 20,
          changed_files: 5,
          html_url: "https://github.com/owner/repo/pull/1",
        },
        files: [
          { filename: "src/main.ts", status: "modified", additions: 50, deletions: 10, changes: 60 },
          { filename: "src/utils.ts", status: "added", additions: 30, deletions: 0, changes: 30 },
        ],
        totalAdditions: 80,
        totalDeletions: 10,
        filesChanged: 2,
        riskAssessment: "low",
        suggestions: ["Good change", "Add tests"],
      };

      const result = formatPRAnalysis(analysis);
      expect(result).toContain("PR Analysis: #1 - Test PR");
      expect(result).toContain("Files changed: 2");
      expect(result).toContain("Additions: +80");
      expect(result).toContain("Deletions: -10");
      expect(result).toContain("Risk: LOW");
      expect(result).toContain("Good change");
      expect(result).toContain("Add tests");
      expect(result).toContain("src/main.ts");
      expect(result).toContain("src/utils.ts");
    });

    it("truncates file list when there are many files", () => {
      const analysis: PRAnalysis = {
        pr: {
          number: 2,
          title: "Big PR",
          state: "open",
          body: "",
          user: { login: "user" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          head: { ref: "feat", sha: "abc" },
          base: { ref: "main", sha: "def" },
          labels: [],
          assignees: [],
          draft: false,
          merged: false,
          mergeable: null,
          additions: 1000,
          deletions: 500,
          changed_files: 15,
          html_url: "https://github.com/owner/repo/pull/2",
        },
        files: Array(15).fill(null).map((_, i) => ({
          filename: `file${i}.ts`,
          status: "modified" as const,
          additions: 10,
          deletions: 5,
          changes: 15,
        })),
        totalAdditions: 150,
        totalDeletions: 75,
        filesChanged: 15,
        riskAssessment: "high",
        suggestions: ["Break into smaller PRs"],
      };

      const result = formatPRAnalysis(analysis);
      expect(result).toContain("... and 5 more files");
    });
  });

  describe("formatRepoStats", () => {
    it("formats repository statistics", () => {
      const stats: RepoStats = {
        stars: 100,
        forks: 25,
        openIssues: 10,
        language: "TypeScript",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-02-01T00:00:00Z",
        size: 10240, // 10 MB in KB
      };

      const result = formatRepoStats(stats);
      expect(result).toContain("Repository Statistics");
      expect(result).toContain("Stars: 100");
      expect(result).toContain("Forks: 25");
      expect(result).toContain("Open Issues: 10");
      expect(result).toContain("Language: TypeScript");
      expect(result).toContain("Size: 10.00 MB");
      expect(result).toContain("Created:");
      expect(result).toContain("Last Updated:");
    });
  });
});
