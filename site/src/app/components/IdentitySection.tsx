"use client";

import { useEffect, useState } from "react";

interface IdentityData {
  identity: string | null;
  goals: string | null;
  scratchpad: string | null;
}

// Simple markdown to HTML converter for basic formatting
function simpleMarkdown(text: string): string {
  return text
    // Headers
    .replace(/^### (.*$)/gm, '<h3 class="text-base font-semibold text-zinc-200 mt-4 mb-2">$1</h3>')
    .replace(/^## (.*$)/gm, '<h2 class="text-lg font-semibold text-zinc-100 mt-6 mb-3">$1</h2>')
    .replace(/^# (.*$)/gm, '<h1 class="text-xl font-bold text-white mt-6 mb-3">$1</h1>')
    // Bold and italic
    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-zinc-100">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Code
    .replace(/`(.*?)`/g, '<code class="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">$1</code>')
    // Lists
    .replace(/^- (.*$)/gm, '<li class="ml-4 text-zinc-400">$1</li>')
    // Blockquotes
    .replace(/^> (.*$)/gm, '<blockquote class="border-l-2 border-zinc-700 pl-3 text-zinc-500 italic">$1</blockquote>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr class="border-zinc-800 my-4" />')
    // Paragraphs
    .replace(/\n\n/g, '</p><p class="text-zinc-400 leading-relaxed my-2">')
    // Line breaks
    .replace(/\n/g, '<br />');
}

function extractSummary(markdown: string, maxLength: number = 300): string {
  // Remove headers and blockquotes for summary
  const cleaned = markdown
    .replace(/^#{1,6} .*/gm, '')
    .replace(/^> .*/gm, '')
    .replace(/^---$/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/`/g, '')
    .trim();
  
  // Get first meaningful paragraph
  const paragraphs = cleaned.split('\n\n').filter(p => p.trim().length > 0);
  const first = paragraphs[0] || '';
  
  if (first.length > maxLength) {
    return first.slice(0, maxLength).trim() + '...';
  }
  return first;
}

export default function IdentitySection() {
  const [data, setData] = useState<IdentityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/identity");
        if (res.ok) {
          setData(await res.json());
        }
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="animate-pulse text-zinc-500">加载身份信息...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return null; // Silently hide on error
  }

  return (
    <div className="space-y-6">
      {/* Identity Card */}
      {data?.identity && (
        <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/0 p-6">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            身份 · Identity
          </h2>
          <div 
            className="prose prose-sm prose-invert max-w-none"
            dangerouslySetInnerHTML={{ 
              __html: `<p class="text-zinc-400 leading-relaxed">${simpleMarkdown(data.identity)}</p>` 
            }}
          />
        </section>
      )}

      {/* Goals Card */}
      {data?.goals && (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            探索方向 · Goals
          </h2>
          <div 
            className="prose prose-sm prose-invert max-w-none"
            dangerouslySetInnerHTML={{ 
              __html: `<p class="text-zinc-400 leading-relaxed">${simpleMarkdown(data.goals)}</p>` 
            }}
          />
        </section>
      )}

      {/* Scratchpad Summary */}
      {data?.scratchpad && (
        <section className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            最近思考 · Thoughts
          </h2>
          <p className="text-sm leading-relaxed text-zinc-400">
            {extractSummary(data.scratchpad)}
          </p>
          <p className="mt-2 text-xs text-zinc-600">
            详见 scratchpad.md
          </p>
        </section>
      )}
    </div>
  );
}