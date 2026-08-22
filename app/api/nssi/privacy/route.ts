import { NextResponse } from "next/server";
import { exportParticipantData, requestParticipantDeletion } from "../../../../lib/nssi/store";
import { apiError, participantToken } from "../_http";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await exportParticipantData(participantToken(request)), {
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="nssi-participant-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return NextResponse.json(await requestParticipantDeletion(
      participantToken(request),
      String(body.confirmation ?? ""),
    ));
  } catch (error) {
    return apiError(error);
  }
}
