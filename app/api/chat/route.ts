import { NextResponse } from "next/server";
import {
  normalizeHistory,
  runAssistantTurn,
} from "../../../lib/application/run-assistant-turn";
import type { ExperienceMode } from "../../../lib/dbt-content";

export async function POST(request: Request) {
  let body: { message?: unknown; history?: unknown; experienceMode?: unknown };

  try {
    body = (await request.json()) as { message?: unknown; history?: unknown; experienceMode?: unknown };
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }

  if (typeof body.message !== "string" || !body.message.trim()) {
    return NextResponse.json({ error: "请输入内容" }, { status: 400 });
  }
  if (body.message.length > 1000) {
    return NextResponse.json({ error: "单次输入请控制在 1000 字以内" }, { status: 400 });
  }

  const payload = await runAssistantTurn(
    body.message.trim(),
    normalizeHistory(body.history),
    (body.experienceMode === "companion" ? "companion" : "deep-read") as ExperienceMode,
  );
  return NextResponse.json(payload);
}
