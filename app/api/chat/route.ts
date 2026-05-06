import { NextResponse } from "next/server";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import type { ConversationState } from "@/lib/agent/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message?: string;
      state?: ConversationState;
    };

    if (!body.message?.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const result = await runAgentTurn({
      message: body.message.trim(),
      state: body.state
    });

    return NextResponse.json({
      mode: process.env.LLM_MODE === "live" ? "live" : "demo",
      ...result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected chat error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
