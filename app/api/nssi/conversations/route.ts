import { NextResponse } from "next/server";
import {
  deleteConversationReview,
  getConversationDetail,
  listConversationReviews,
  updateConversationRetention,
  updateConversationReview,
} from "../../../../lib/nssi/store";
import type { ConversationRetention } from "../../../../lib/nssi/types";
import { apiError, participantToken } from "../_http";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId")?.trim();
    const token = participantToken(request);
    if (conversationId) return NextResponse.json(await getConversationDetail(token, conversationId), { headers: { "cache-control": "no-store" } });
    return NextResponse.json({ reviews: await listConversationReviews(token) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const token = participantToken(request);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (action === "retention.update") {
      return NextResponse.json(await updateConversationRetention(token, {
        conversationId: String(body.conversationId ?? ""),
        retention: String(body.retention ?? "summary-only") as ConversationRetention,
        transcript: body.transcript,
      }), { headers: { "cache-control": "no-store" } });
    }
    if (action === "review.update") {
      return NextResponse.json(await updateConversationReview(token, {
        conversationId: String(body.conversationId ?? ""),
        title: String(body.title ?? ""),
        userFocus: String(body.userFocus ?? ""),
      }), { headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return NextResponse.json(await deleteConversationReview(
      participantToken(request),
      String(body.conversationId ?? ""),
    ));
  } catch (error) {
    return apiError(error);
  }
}
