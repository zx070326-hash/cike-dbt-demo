import { NextResponse } from "next/server";
import { auditStaffAccess, authorizeStaff, getCoachDashboard } from "../../../../../lib/nssi/store";
import { apiError } from "../../_http";

export async function GET(request: Request) {
  try {
    authorizeStaff(request, "coach");
    await auditStaffAccess({ actorId: "coach-web", actorRole: "coach", eventType: "coach.dashboard_viewed", targetType: "participant_dashboard" });
    return NextResponse.json({ participants: await getCoachDashboard() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
