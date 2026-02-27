/**
 * Web search functionality for Jinx
 * Supports multiple search providers: Brave Search, Serper (Google)
 */

import { log } from "../util/log.js";

// ── Types ──────────────────────────────────────────────────────────

export interface SearchOptions {
  query: string;
  count?: number;
  offset?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  source?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  totalResults?: number;
  query: string;
  provider: string;
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

  // Try providers in order of preference
  const errors: string[] = [];

  // Try Brave first if API key is available
  if (process.env.BRAVE_API_KEY) {
    try {
      const result = await searchBrave(options);
      log.info("Brave search completed", { results: result.results.length });
      return result;
    } catch (e) {
      const error = e as Error;
      log.warn("Brave search failed", { error: error.message });
      errors.push(`Brave: ${error.message}`);
    }
  }

  // Fallback to Serper if available
  if (process.env.SERPER_API_KEY) {
    try {
      const result = await searchSerper(options);
      log.info("Serper search completed", { results: result.results.length });
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
      "No search provider configured. Set BRAVE_API_KEY or SERPER_API_KEY environment variable."
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
    lines.push(`   ${result.description}`);
    lines.push("");
  }

  if (response.totalResults !== undefined) {
    lines.push(`---`);
    lines.push(`Total results: ${response.totalResults}`);
  }

  return lines.join("\n");
}

// ── Fetch and Summarize ────────────────────────────────────────────

import * as cheerio from "cheerio";
import TurndownService from "turndown";

async function fetchWebpageContent(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Jinx Bot / pi-coding-agent (Linux x86_64)",
        "Accept": "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    $("script, style, nav, footer, header, noscript, iframe, svg").remove();

    let mainHtml = "";
    if ($("main").length > 0) {
      mainHtml = $("main").html() || "";
    } else if ($("article").length > 0) {
      mainHtml = $("article").html() || "";
    } else if ($("#content, .content, .main").length > 0) {
      mainHtml = $("#content, .content, .main").html() || "";
    } else {
      mainHtml = $("body").html() || "";
    }

    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });

    return turndown.turndown(mainHtml).slice(0, 500);
  } catch {
    return null;
  }
}

export async function searchAndFetch(
  query: string,
  maxResults: number = 3
): Promise<string> {
  const searchResponse = await webSearch({ query, count: maxResults });

  if (searchResponse.results.length === 0) {
    return `No search results found for "${query}".`;
  }

  const lines: string[] = [
    `🔍 Search Results for "${searchResponse.query}"`,
    "",
  ];

  for (const result of searchResponse.results) {
    lines.push(`## ${result.title}`);
    lines.push(`URL: ${result.url}`);
    lines.push("");

    const content = await fetchWebpageContent(result.url);
    if (content) {
      lines.push(`Summary: ${content.replace(/\n/g, " ")}...`);
    } else {
      lines.push(`Description: ${result.description}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}
