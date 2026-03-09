import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

function dataPath(...parts: string[]) {
  return path.join(process.cwd(), "..", "data", ...parts);
}

function readMarkdown(filename: string): string | null {
  try {
    const fullPath = dataPath(filename);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, "utf-8");
    }
  } catch {
    // ignore errors
  }
  return null;
}

export interface IdentityResponse {
  identity: string | null;
  goals: string | null;
  scratchpad: string | null;
}

export async function GET() {
  try {
    const identity = readMarkdown("identity.md");
    const goals = readMarkdown("goals.md");
    const scratchpad = readMarkdown("scratchpad.md");

    const response: IdentityResponse = {
      identity,
      goals,
      scratchpad,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to get identity", message: (error as Error).message },
      { status: 500 }
    );
  }
}