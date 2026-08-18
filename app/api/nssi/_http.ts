import { NextResponse } from "next/server";

export function participantToken(request: Request) {
  return request.headers.get("x-participant-token")?.trim() ?? "";
}

export function apiError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const status = code === "UNAUTHENTICATED" || code === "STAFF_UNAUTHENTICATED"
    ? 401
    : code === "PHASE1_ADULTS_ONLY"
      ? 403
      : /NOT_FOUND/u.test(code)
        ? 404
        : /INVALID|MISSING|REQUIRED|LOCKED|UNKNOWN|LIMIT/iu.test(code)
          ? 400
          : 500;
  const publicMessage = status === 500
    ? "服务暂时没有完成这次操作，请稍后重试。"
    : code;
  return NextResponse.json({ error: publicMessage, code }, { status });
}
