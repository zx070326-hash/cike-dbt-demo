import { NextResponse } from "next/server";
import { auditStaffAccess, authorizeStaff, getConversationAudit } from "../../../../../lib/nssi/store";
import { apiError } from "../../_http";

export async function GET(request: Request) {
  try {
    authorizeStaff(request, "coach");
    const userId = new URL(request.url).searchParams.get("userId") ?? undefined;
    await auditStaffAccess({ actorId: "coach-web", actorRole: "coach", eventType: "coach.conversation_audit_viewed", targetType: "user", targetId: userId });
    return NextResponse.json({ messages: await getConversationAudit(userId) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
