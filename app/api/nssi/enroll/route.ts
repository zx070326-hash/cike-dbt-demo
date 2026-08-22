import { NextResponse } from "next/server";
import { enrollParticipant } from "../../../../lib/nssi/store";
import { apiError } from "../_http";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.accepted !== true) return NextResponse.json({ error: "CONSENT_REQUIRED" }, { status: 400 });
    const result = await enrollParticipant({
      ageDeclaredAdult: body.ageDeclaredAdult === true,
      timezone: typeof body.timezone === "string" ? body.timezone.slice(0, 80) : "Asia/Shanghai",
      policyVersion: "nssi-participant-consent-0.1",
      monitoringDisclosureVersion: "nssi-monitoring-disclosure-0.1",
    });
    return NextResponse.json(result, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
