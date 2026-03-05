/**
 * Web search functionality for Jinx
 * Supports multiple search providers: Exa (primary), Brave Search, Serper (fallback)
 */

import { log } from "../util/log.js";
import { recordSearchUsage } from "../costs/tracker.js";

// ── Types ──────────────────────────────────────────────────────────

export interface SearchOptions {
  query: string;
  count?: number;
  offset?: number;
  includeContents?: boolean; // For Exa: fetch page contents/summary
}

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  publishedDate?: string;
  author?: string;
  source?: string;
  summary?: string; // Exa provides AI-generated summaries
}

export interface SearchResponse {
  results: SearchResult[];
  totalResults?: number;
  query: string;
  provider: string;
}

// ── Exa API (Primary) ──────────────────────────────────────────────

const EXA_API_URL = "https://api.exa.ai/search";

async function searchExa(options: SearchOptions): Promise<SearchResponse> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error("EXA_API_KEY environment variable not set");
  }

  // Build request body - Exa API requires specific format
  const requestBody: Record<string, unknown> = {
    query: options.query,
    numResults: Math.min(options.count || 10, 25),
    type: "auto",
    useApiKey: true, // Required for some Exa API configurations
  };

  // Request contents if enabled (includes summary and highlights)
  // Note: contents parameter format as per Exa API spec
  if (options.includeContents !== false) {
    requestBody.contents = {
      text: { maxCharacters: 2000 },
      highlights: { maxCharacters: 500 },
    };
  }

  log.info("Exa API request", { 
    url: EXA_API_URL, 
    body: JSON.stringify({ ...requestBody, query: `[${requestBody.query?.toString().length} chars]` }) 
  });

  const response = await fetch(EXA_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error("Exa API error", { 
      status: response.status, 
      error: errorText,
      requestBody: JSON.stringify(requestBody)
    });
    throw new Error(`Exa API error: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    results?: Array<{
      title?: string;
      url: string;
      text?: string;
      summary?: string;
      highlights?: string[];
      publishedDate?: string;
      author?: string;
    }>;
  };

  const results: SearchResult[] = (data.results || []).map((item) => ({
    title: item.title || item.url,
    url: item.url,
    description: item.summary || item.highlights?.[0] || item.text?.slice(0, 200) || "",
    publishedDate: item.publishedDate,
    author: item.author,
    source: "exa",
    summary: item.summary,
  }));

  return {
    results,
    query: options.query,
    provider: "exa",
  };
}

// ── Brave Search API ───────────────────────────────────────────────

const BRAVE_SEARCH_API_URL = "https://api.search.brave.com/res/v1/web/search";

async function searchBrave(options: SearchOptions): Promise<SearchResponse> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    throw new Error("BRAVE_API_KEY environment variable not set");
  }

  const params = new URLSearchParams({
    q: options.query,
    count: String(Math.min(options.count || 10, 20)),
    offset: String(options.offset || 0),
    text_decorations: "false",
    spellcheck: "true",
  });

  const response = await fetch(`${BRAVE_SEARCH_API_URL}?${params}`, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Brave Search API error: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    web?: {
      results?: Array<{
        title: string;
        url: string;
        description: string;
      }>;
      total?: number;
    };
    query?: {
      original?: string;
    };
  };

  const results: SearchResult[] = (data.web?.results || []).map((item) => ({
    title: item.title,
    url: item.url,
    description: item.description,
    source: "brave",
  }));

  return {
    results,
    totalResults: data.web?.total,
    query: data.query?.original || options.query,
    provider: "brave",
  };
}

// ── Serper (Google) API ───────────────────────────────────────────

const SERPER_API_URL = "https://google.serper.dev/search";

async function searchSerper(options: SearchOptions): Promise<SearchResponse> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error("SERPER_API_KEY environment variable not set");
  }

  const response = await fetch(SERPER_API_URL, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: options.query,
      num: Math.min(options.count || 10, 100),
      page: Math.floor((options.offset || 0) / 10) + 1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Serper API error: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    searchParameters?: {
      q?: string;
    };
    organic?: Array<{
      title: string;
      link: string;
      snippet: string;
    }>;
  };

  const results: SearchResult[] = (data.organic || []).map((item) => ({
    title: item.title,
    url: item.link,
    description: item.snippet,
    source: "serper",
  }));

  return {
    results,
    query: data.searchParameters?.q || options.query,
    provider: "serper",
  };
}

// ── Main Search Function ───────────────────────────────────────────

export async function webSearch(options: SearchOptions): Promise<SearchResponse> {
  log.info("Starting web search", { query: options.query, count: options.count });

  // Try providers in order: Exa (primary) → Brave → Serper
  const errors: string[] = [];

  // Try Exa first if API key is available
  if (process.env.EXA_API_KEY) {
    try {
      const result = await searchExa(options);
      log.info("Exa search completed", { results: result.results.length });
      recordSearchUsage("exa", options.query);
      return result;
    } catch (e) {
      const error = e as Error;
      log.warn("Exa search failed", { error: error.message });
      errors.push(`Exa: ${error.message}`);
    }
  }

  // Fallback to Brave
  if (process.env.BRAVE_API_KEY) {
    try {
      const result = await searchBrave(options);
      log.info("Brave search completed", { results: result.results.length });
      recordSearchUsage("brave", options.query);
      return result;
    } catch (e) {
      const error = e as Error;
      log.warn("Brave search failed", { error: error.message });
      errors.push(`Brave: ${error.message}`);
    }
  }

  // Fallback to Serper
  if (process.env.SERPER_API_KEY) {
    try {
      const result = await searchSerper(options);
      log.info("Serper search completed", { results: result.results.length });
      recordSearchUsage("serper", options.query);
      return result;
    } catch (e) {
      const error = e as Error;
      log.warn("Serper search failed", { error: error.message });
      errors.push(`Serper: ${error.message}`);
    }
  }

  // If we get here, no providers worked or no API keys are set
  if (errors.length === 0) {
    throw new Error(
      "No search provider configured. Set EXA_API_KEY, BRAVE_API_KEY, or SERPER_API_KEY environment variable."
    );
  }

  throw new Error(`All search providers failed: ${errors.join("; ")}`);
}

// ── Formatting ─────────────────────────────────────────────────────

export function formatSearchResults(response: SearchResponse): string {
  const lines: string[] = [
    `🔍 Search Results for "${response.query}"`,
    `Provider: ${response.provider}`,
    "",
  ];

  if (response.results.length === 0) {
    lines.push("No results found.");
    return lines.join("\n");
  }

  for (let i = 0; i < response.results.length; i++) {
    const result = response.results[i];
    lines.push(`${i + 1}. **${result.title}**`);
    lines.push(`   ${result.url}`);
    
    if (result.author) {
      lines.push(`   Author: ${result.author}`);
    }
    if (result.publishedDate) {
      const date = new Date(result.publishedDate).toLocaleDateString();
      lines.push(`   Published: ${date}`);
    }
    
    const description = result.summary || result.description;
    if (description) {
      lines.push(`   ${description.slice(0, 300)}${description.length > 300 ? "..." : ""}`);
    }
    lines.push("");
  }

  if (response.totalResults !== undefined) {
    lines.push(`---`);
    lines.push(`Total results: ${response.totalResults}`);
  }

  return lines.join("\n");
}
