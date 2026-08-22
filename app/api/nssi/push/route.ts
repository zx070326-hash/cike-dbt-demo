import { NextResponse } from "next/server";
import { pushDeliveryConfig, registerPushSubscription, removePushSubscription } from "../../../../lib/nssi/store";
import { apiError, participantToken } from "../_http";

export async function GET() {
  const config = pushDeliveryConfig();
  return NextResponse.json(config, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return NextResponse.json(await registerPushSubscription(
      participantToken(request),
      body.subscription,
      request.headers.get("user-agent") ?? undefined,
    ), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return NextResponse.json(await removePushSubscription(participantToken(request), String(body.endpoint ?? "")));
  } catch (error) {
    return apiError(error);
  }
}
