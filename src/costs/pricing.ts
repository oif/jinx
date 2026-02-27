/**
 * API Pricing Configuration
 * 
 * Costs are in USD per request or per token
 * Last updated: 2024
 */

export interface ApiPricing {
  name: string;
  model?: string;
  costPerRequest?: number;  // Flat cost per API call
  costPerInputToken?: number;   // Cost per 1K tokens
  costPerOutputToken?: number;  // Cost per 1K tokens
  description: string;
}

// Claude Code pricing (approximate, based on Claude 3.5 Sonnet)
export const CLAUDE_PRICING: Record<string, ApiPricing> = {
  "claude-code": {
    name: "Claude Code",
    model: "claude-3-5-sonnet-20241022",
    costPerInputToken: 0.003,   // $3 per 1M input tokens
    costPerOutputToken: 0.015,  // $15 per 1M output tokens
    description: "Claude Code CLI tool usage (estimated based on typical token counts)",
  },
};

// Web Search API pricing
export const SEARCH_PRICING: Record<string, ApiPricing> = {
  exa: {
    name: "Exa AI Search",
    costPerRequest: 0.05,  // ~$0.05 per search (estimated based on typical usage)
    description: "Exa neural search API",
  },
  brave: {
    name: "Brave Search API",
    costPerRequest: 0.003,  // $3 per 1000 queries
    description: "Brave Search API (Pro plan)",
  },
  serper: {
    name: "Serper.dev (Google)",
    costPerRequest: 0.001,  // $1 per 1000 searches (Starter plan)
    description: "Serper.dev Google Search API",
  },
};

// GitHub API pricing
export const GITHUB_PRICING: ApiPricing = {
  name: "GitHub API",
  costPerRequest: 0,  // Free for public repos, limited for private
  description: "GitHub REST API (free tier: 5000 requests/hour)",
};

// Other external APIs
export const OTHER_PRICING: Record<string, ApiPricing> = {
  webpage_fetch: {
    name: "Webpage Fetch",
    costPerRequest: 0,
    description: "Direct HTTP fetch (no cost)",
  },
  telegram: {
    name: "Telegram Bot API",
    costPerRequest: 0,
    description: "Telegram Bot API (free)",
  },
};

/**
 * Estimate cost for a Claude Code session
 * Based on typical usage patterns
 */
export function estimateClaudeCost(
  inputTokens: number = 4000,   // Default: 4K input tokens
  outputTokens: number = 2000   // Default: 2K output tokens
): number {
  const pricing = CLAUDE_PRICING["claude-code"];
  const inputCost = (inputTokens / 1000) * (pricing.costPerInputToken || 0);
  const outputCost = (outputTokens / 1000) * (pricing.costPerOutputToken || 0);
  return inputCost + outputCost;
}

/**
 * Get cost for a search request by provider
 */
export function getSearchCost(provider: string): number {
  const pricing = SEARCH_PRICING[provider.toLowerCase()];
  return pricing?.costPerRequest || 0;
}

/**
 * Get human-readable pricing info
 */
export function formatPricingInfo(): string {
  const lines: string[] = [
    "💰 API Pricing Reference",
    "",
    "Claude Code (estimated):",
    `  Input: $${CLAUDE_PRICING["claude-code"].costPerInputToken}/1K tokens`,
    `  Output: $${CLAUDE_PRICING["claude-code"].costPerOutputToken}/1K tokens`,
    `  Typical request (~4K in, ~2K out): ~$0.04`,
    "",
    "Web Search:",
    ...Object.entries(SEARCH_PRICING).map(([key, p]) => 
      `  ${p.name}: $${p.costPerRequest}/request`
    ),
    "",
    "GitHub API: Free (5000 requests/hour limit)",
    "",
    "Note: Costs are estimates. Actual costs may vary based on usage patterns.",
  ];
  return lines.join("\n");
}
