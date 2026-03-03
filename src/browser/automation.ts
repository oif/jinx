/**
 * Browser automation stubs.
 * Full implementation pending — referenced by tools.ts but not yet functional.
 * TODO: implement real browser automation or remove these tools.
 */

export interface ScreenshotOptions {
  url: string;
  fullPage?: boolean;
  width?: number;
  height?: number;
  selector?: string;
  waitFor?: string;
}

export interface ScreenshotResult {
  data: Buffer;
}

export interface PageInfo {
  url: string;
  title: string;
  description?: string;
  headings: string[];
  links: string[];
  content: string;
}

export interface InteractionResult {
  success: boolean;
  finalUrl: string;
  message: string;
}

export type InteractionAction = { type: "click" | "fill" | "wait"; selector: string; value?: string };

export async function takeScreenshot(_opts: ScreenshotOptions): Promise<ScreenshotResult> {
  return { data: Buffer.from("Browser automation not yet implemented.") };
}

export async function analyzePage(_url: string): Promise<PageInfo> {
  return {
    url: _url,
    title: "",
    description: "",
    headings: [],
    links: [],
    content: "Browser automation not yet implemented.",
  };
}

export async function testPageInteraction(
  _url: string,
  _actions: InteractionAction[],
): Promise<InteractionResult> {
  return {
    success: false,
    finalUrl: _url,
    message: "Browser automation not yet implemented.",
  };
}

export function formatPageInfo(info: PageInfo): string {
  return `URL: ${info.url}\nTitle: ${info.title}\n${info.content}`;
}