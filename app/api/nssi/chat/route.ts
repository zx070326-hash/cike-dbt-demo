import { NextResponse } from "next/server";
import { normalizeHistory } from "../../../../lib/application/run-assistant-turn";
import type { ExperienceMode } from "../../../../lib/dbt-content";
import type { ConversationRetention } from "../../../../lib/nssi/types";
import { runNssiAgentTurn } from "../../../../lib/nssi/agent";
import { apiError, participantToken } from "../_http";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return NextResponse.json({ error: "MESSAGE_REQUIRED" }, { status: 400 });
    if (message.length > 1000) return NextResponse.json({ error: "MESSAGE_TOO_LONG" }, { status: 400 });
    const mode = body.experienceMode === "deep-read" ? "deep-read" : "companion";
    const token = participantToken(request);
    const input = {
      token,
      conversationId: typeof body.conversationId === "string" ? body.conversationId.slice(0, 100) : crypto.randomUUID(),
      message,
      history: normalizeHistory(body.history),
      mode: mode as ExperienceMode,
      rawRetention: (["summary-only", "7-days", "30-days", "keep"] as const).includes(body.rawRetention as ConversationRetention)
        ? body.rawRetention as ConversationRetention
        : "summary-only" as const,
    };
    if (request.headers.get("accept")?.includes("text/event-stream")) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: string, value: unknown) => controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`),
          );
          // This first byte is deliberately deterministic. We never stream
          // unvalidated model text; the complete answer is released only after
          // safety, grounding and protocol-boundary validation has finished.
          send("status", { message: "正在完成安全检查并核对书内依据" });
          void runNssiAgentTurn(input)
            .then((payload) => send("result", payload))
            .catch(() => send("error", { error: "回答没有送达，请稍后再试。" }))
            .finally(() => controller.close());
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store, no-transform",
          connection: "keep-alive",
          vary: "accept",
        },
      });
    }
    const payload = await runNssiAgentTurn(input);
    return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
