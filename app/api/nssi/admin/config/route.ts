import { NextResponse } from "next/server";
import {
  activateConfigVersion,
  authorizeStaff,
  createConfigDraft,
  defaultPhase1Config,
  listConfigVersions,
} from "../../../../../lib/nssi/store";
import { apiError } from "../../_http";

export async function GET(request: Request) {
  try {
    authorizeStaff(request, "admin");
    return NextResponse.json({ defaultConfig: defaultPhase1Config, versions: await listConfigVersions() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    authorizeStaff(request, "admin");
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "create-draft") {
      return NextResponse.json(await createConfigDraft({
        version: String(body.version ?? ""),
        config: body.config as Record<string, unknown>,
        evaluationReport: body.evaluationReport as Record<string, unknown> | undefined,
        createdBy: String(body.adminId ?? "admin-internal").slice(0, 80),
      }), { status: 201 });
    }
    if (body.action === "activate") {
      return NextResponse.json(await activateConfigVersion({
        id: String(body.id ?? ""),
        approvedBy: String(body.adminId ?? "admin-internal").slice(0, 80),
      }));
    }
    return NextResponse.json({ error: "UNKNOWN_CONFIG_ACTION" }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}
