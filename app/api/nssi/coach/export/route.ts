import { authorizeStaff, exportCoachResearchCsv } from "../../../../../lib/nssi/store";
import { apiError } from "../../_http";

export async function GET(request: Request) {
  try {
    authorizeStaff(request, "coach");
    const userId = new URL(request.url).searchParams.get("userId") ?? "";
    const result = await exportCoachResearchCsv(userId, "coach-web");
    return new Response(result.csv, {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${result.filename}"`,
        "x-research-participant": result.participantCode,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
