import { NextResponse } from "next/server";
import { authorizeStaff, getCoachSafetyPlanHistory } from "../../../../../lib/nssi/store";
import { apiError } from "../../_http";

export async function GET(request: Request) {
  try {
    authorizeStaff(request, "coach");
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId")?.trim() ?? "";
    if (!userId) return NextResponse.json({ error: "USER_ID_REQUIRED" }, { status: 400 });
    const coachId = request.headers.get("x-staff-id")?.trim().slice(0, 80) || "coach-web";
    return NextResponse.json({ plans: await getCoachSafetyPlanHistory(userId, coachId) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
