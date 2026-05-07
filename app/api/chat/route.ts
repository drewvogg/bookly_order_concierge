import { NextResponse } from "next/server";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import type { ChatStreamEvent, ConversationState } from "@/lib/agent/types";

function encodeStreamEvent(event: ChatStreamEvent) {
  return `${JSON.stringify(event)}\n`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message?: string;
      state?: ConversationState;
    };

    if (!body.message?.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const message = body.message.trim();
    const encoder = new TextEncoder();
    const mode = process.env.LLM_MODE === "live" ? "live" : "demo";

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: ChatStreamEvent) => {
          controller.enqueue(encoder.encode(encodeStreamEvent(event)));
        };

        try {
          send({ type: "mode", mode });
          const result = await runAgentTurn({
            message,
            state: body.state,
            callbacks: {
              onProgress: (message) => send({ type: "progress", message }),
              onTraceEvent: (event) => send({ type: "trace_event", event })
            }
          });

          send({ type: "final", mode, state: result.state });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unexpected chat error";
          send({ type: "error", error: message });
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected chat error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
