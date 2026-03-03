/**
 * GitHub Enhanced Tools
 *
 * Complete GitHub workflow support including:
 * - Issues management (list, create, update)
 * - PR code review and analysis
 * - Repository analytics
 * - Commit history and diff analysis
 */

import { execSync } from "node:child_process";

import { recordGitHubUsage } from "../costs/tracker.js";

// ── Types ──────────────────────────────────────────────────────────

export interface GitHubIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  body: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  labels: Array<{ name: string; color: string }>;
  assignees: Array<{ login: string }>;
  comments: number;
  html_url: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: "open" | "closed";
  body: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  additions: number;
  deletions: number;
  changed_files: number;
  html_url: string;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  author: { login: string } | null;
  html_url: string;
}

export interface GitHubReviewComment {
  id: number;
  path: string;
  line: number;
  body: string;
  user: { login: string };
  created_at: string;
}

export interface RepoStats {
  stars: number;
  forks: number;
  openIssues: number;
  language: string;
  createdAt: string;
  updatedAt: string;
  size: number;
}

// ── Helpers ────────────────────────────────────────────────────────

function getGitHubToken(): string | null {
  return process.env.GITHUB_TOKEN || null;
}

function getRepoFromRemote(): string | null {
  try {
    const remotes = execSync("git remote -v", { encoding: "utf-8" });
    const match = remotes.match(/github\.com[:/](.+?\/.+?)\.git/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function githubApi(path: string, options: RequestInit = {}): Promise<any> {
  const token = getGitHubToken();
  if (!token) {
    throw new Error("GITHUB_TOKEN environment variable is not set");
  }

  const repo = getRepoFromRemote();
  if (!repo) {
    throw new Error("Could not extract GitHub repository from git remote");
  }

  const url = `https://api.github.com/repos/${repo}${path}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github.v3+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Jinx Bot / pi-coding-agent",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(`GitHub API error: ${response.status} - ${error.message || response.statusText}`);
  }

  // Track GitHub API usage
  recordGitHubUsage(path);

  return response.json();
}

// ── Issues ─────────────────────────────────────────────────────────

export async function listIssues(
  state: "open" | "closed" | "all" = "open",
  labels?: string[],
  limit: number = 30
): Promise<GitHubIssue[]> {
  const params = new URLSearchParams();
  params.append("state", state);
  params.append("per_page", limit.toString());
  params.append("sort", "updated");
  params.append("direction", "desc");
  
  if (labels && labels.length > 0) {
    params.append("labels", labels.join(","));
  }

  return githubApi(`/issues?${params.toString()}`);
}

export async function getIssue(issueNumber: number): Promise<GitHubIssue> {
  return githubApi(`/issues/${issueNumber}`);
}

export async function createIssue(
  title: string,
  body: string,
  labels?: string[],
  assignees?: string[]
): Promise<GitHubIssue> {
  return githubApi("/issues", {
    method: "POST",
    body: JSON.stringify({
      title,
      body,
      labels,
      assignees,
    }),
  });
}

export async function updateIssue(
  issueNumber: number,
  updates: {
    title?: string;
    body?: string;
    state?: "open" | "closed";
    labels?: string[];
  }
): Promise<GitHubIssue> {
  return githubApi(`/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function addIssueComment(
  issueNumber: number,
  body: string
): Promise<{ html_url: string }> {
  return githubApi(`/issues/${issueNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

// ── Pull Requests ──────────────────────────────────────────────────

export async function listPullRequests(
  state: "open" | "closed" | "all" = "open",
  limit: number = 30
): Promise<GitHubPullRequest[]> {
  const params = new URLSearchParams();
  params.append("state", state);
  params.append("per_page", limit.toString());
  params.append("sort", "updated");
  params.append("direction", "desc");

  return githubApi(`/pulls?${params.toString()}`);
}

export async function getPullRequest(prNumber: number): Promise<GitHubPullRequest> {
  return githubApi(`/pulls/${prNumber}`);
}

export async function getPullRequestFiles(prNumber: number): Promise<Array<{
  filename: string;
  status: "added" | "removed" | "modified" | "renamed";
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}>> {
  return githubApi(`/pulls/${prNumber}/files`);
}

export async function getPullRequestCommits(prNumber: number): Promise<GitHubCommit[]> {
  return githubApi(`/pulls/${prNumber}/commits`);
}

export async function getPullRequestComments(prNumber: number): Promise<GitHubReviewComment[]> {
  return githubApi(`/pulls/${prNumber}/comments`);
}

// ── Code Review Analysis ───────────────────────────────────────────

export interface PRAnalysis {
  pr: GitHubPullRequest;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
  totalAdditions: number;
  totalDeletions: number;
  filesChanged: number;
  riskAssessment: "low" | "medium" | "high";
  suggestions: string[];
}

export async function analyzePullRequest(prNumber: number): Promise<PRAnalysis> {
  const [pr, files] = await Promise.all([
    getPullRequest(prNumber),
    getPullRequestFiles(prNumber),
  ]);

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  // Risk assessment based on size and scope
  let riskAssessment: "low" | "medium" | "high" = "low";
  const totalChanges = totalAdditions + totalDeletions;
  
  if (totalChanges > 500 || files.length > 10) {
    riskAssessment = "high";
  } else if (totalChanges > 100 || files.length > 5) {
    riskAssessment = "medium";
  }

  // Generate suggestions based on analysis
  const suggestions: string[] = [];
  
  if (files.length > 10) {
    suggestions.push("Consider breaking this PR into smaller chunks");
  }
  if (totalChanges > 300) {
    suggestions.push("Large change set - ensure comprehensive testing");
  }
  if (files.some(f => f.filename.includes("test"))) {
    suggestions.push("✓ Tests included");
  } else {
    suggestions.push("⚠ Consider adding tests for these changes");
  }

  return {
    pr,
    files,
    totalAdditions,
    totalDeletions,
    filesChanged: files.length,
    riskAssessment,
    suggestions,
  };
}

// ── Repository ─────────────────────────────────────────────────────

export async function getRepoStats(): Promise<RepoStats> {
  const repo = await githubApi("");
  return {
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    openIssues: repo.open_issues_count,
    language: repo.language,
    createdAt: repo.created_at,
    updatedAt: repo.updated_at,
    size: repo.size,
  };
}

export async function listCommits(
  branch: string = "main",
  limit: number = 20
): Promise<GitHubCommit[]> {
  const params = new URLSearchParams();
  params.append("sha", branch);
  params.append("per_page", limit.toString());
  
  return githubApi(`/commits?${params.toString()}`);
}

// ── Formatting ─────────────────────────────────────────────────────

export function formatIssueList(issues: GitHubIssue[]): string {
  if (issues.length === 0) {
    return "No issues found.";
  }

  const lines: string[] = [
    `📋 Issues (${issues.length})`,
    "",
  ];

  for (const issue of issues) {
    const labels = issue.labels.map(l => `[${l.name}]`).join(" ");
    const assignee = issue.assignees.length > 0 ? ` @${issue.assignees[0].login}` : "";
    lines.push(`#${issue.number}: ${issue.title} ${labels}${assignee}`);
    lines.push(`   ${issue.state} | ${issue.comments} comments | ${new Date(issue.updated_at).toLocaleDateString()}`);
    lines.push(`   ${issue.html_url}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function formatPRList(prs: GitHubPullRequest[]): string {
  if (prs.length === 0) {
    return "No pull requests found.";
  }

  const lines: string[] = [
    `🔀 Pull Requests (${prs.length})`,
    "",
  ];

  for (const pr of prs) {
    const draft = pr.draft ? " [DRAFT]" : "";
    const merged = pr.merged ? " [MERGED]" : "";
    lines.push(`#${pr.number}: ${pr.title}${draft}${merged}`);
    lines.push(`   ${pr.head.ref} → ${pr.base.ref} | +${pr.additions}/-${pr.deletions}`);
    lines.push(`   ${pr.html_url}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function formatPRAnalysis(analysis: PRAnalysis): string {
  const lines: string[] = [
    `🔍 PR Analysis: #${analysis.pr.number} - ${analysis.pr.title}`,
    "",
    `📊 Stats:`,
    `   Files changed: ${analysis.filesChanged}`,
    `   Additions: +${analysis.totalAdditions}`,
    `   Deletions: -${analysis.totalDeletions}`,
    `   Risk: ${analysis.riskAssessment.toUpperCase()}`,
    "",
    `💡 Suggestions:`,
    ...analysis.suggestions.map(s => `   • ${s}`),
    "",
    `📁 Files:`,
    ...analysis.files.slice(0, 10).map(f => 
      `   ${f.status === "added" ? "+" : f.status === "removed" ? "-" : "~"} ${f.filename} (+${f.additions}/-${f.deletions})`
    ),
    ...(analysis.files.length > 10 ? [`   ... and ${analysis.files.length - 10} more files`] : []),
    "",
    `🔗 ${analysis.pr.html_url}`,
  ];

  return lines.join("\n");
}

export function formatRepoStats(stats: RepoStats): string {
  const lines: string[] = [
    "📊 Repository Statistics",
    "",
    `⭐ Stars: ${stats.stars}`,
    `🍴 Forks: ${stats.forks}`,
    `🐛 Open Issues: ${stats.openIssues}`,
    `💻 Language: ${stats.language}`,
    `📦 Size: ${(stats.size / 1024).toFixed(2)} MB`,
    "",
    `Created: ${new Date(stats.createdAt).toLocaleDateString()}`,
    `Last Updated: ${new Date(stats.updatedAt).toLocaleDateString()}`,
  ];

  return lines.join("\n");
}
