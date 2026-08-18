import { NextResponse } from "next/server";
import { auditStaffAccess, authorizeStaff, listRiskEvents, updateRiskEventAsCoach } from "../../../../../lib/nssi/store";
import { apiError } from "../../_http";

export async function GET(request: Request) {
  try {
    authorizeStaff(request, "coach");
    await auditStaffAccess({ actorId: "coach-web", actorRole: "coach", eventType: "coach.risk_queue_viewed", targetType: "risk_queue" });
    return NextResponse.json({ risks: await listRiskEvents() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    authorizeStaff(request, "coach");
    const body = await request.json() as Record<string, unknown>;
    const action = body.action === "close" ? "close" : body.action === "acknowledge" ? "acknowledge" : null;
    if (!action) return NextResponse.json({ error: "INVALID_RISK_ACTION" }, { status: 400 });
    await updateRiskEventAsCoach({
      riskEventId: String(body.riskEventId ?? ""),
      coachId: String(body.coachId ?? "coach-internal").slice(0, 80),
      action,
      note: typeof body.note === "string" ? body.note.slice(0, 1000) : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
