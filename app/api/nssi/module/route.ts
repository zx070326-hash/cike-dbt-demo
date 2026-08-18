import { NextResponse } from "next/server";
import { hitToCitation, retrieveEvidence } from "../../../../lib/rag";
import { getActivePhase1Config, modulesWithConfig } from "../../../../lib/nssi/store";

export async function GET(request: Request) {
  const moduleId = new URL(request.url).searchParams.get("moduleId") ?? "";
  const active = await getActivePhase1Config();
  const curriculumModule = modulesWithConfig(active.config).find((item) => item.id === moduleId);
  if (!curriculumModule) return NextResponse.json({ error: "MODULE_NOT_FOUND" }, { status: 404 });
  const allowed = new Set(curriculumModule.skillCardIds);
  const seen = new Set<string>();
  const citations = curriculumModule.sourceQueries
    .flatMap((query) => retrieveEvidence(query, 4, { allowedSkillCardIds: allowed }))
    .filter((hit) => {
      if (seen.has(hit.page.id)) return false;
      seen.add(hit.page.id);
      return true;
    })
    .slice(0, 6)
    .map(hitToCitation);
  return NextResponse.json({ module: curriculumModule, citations }, {
    headers: { "cache-control": "public, max-age=300" },
  });
}
