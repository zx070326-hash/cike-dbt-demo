import { NextResponse } from "next/server";
import { hitToCitation, retrieveEvidence } from "../../../../lib/rag";
import { getActivePhase1Config, modulesWithConfig } from "../../../../lib/nssi/store";

function normalizedTitle(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

const roleWeight = { primary: 3, supporting: 2, "index-only": 1 } as const;
const typeWeight = { handout: 5, "trainer-note": 4, worksheet: 2, "source-page": 1, "front-matter": 0 } as const;

export async function GET(request: Request) {
  const moduleId = new URL(request.url).searchParams.get("moduleId") ?? "";
  const active = await getActivePhase1Config();
  const curriculumModule = modulesWithConfig(active.config).find((item) => item.id === moduleId);
  if (!curriculumModule) return NextResponse.json({ error: "MODULE_NOT_FOUND" }, { status: 404 });
  const seenPages = new Set<string>();
  const seenTitles = new Set<string>();
  const candidates = curriculumModule.sourceQueries
    .flatMap((query) => retrieveEvidence(query, 14, {
      presentation: "module",
    }))
    .filter((hit) => {
      if (seenPages.has(hit.page.id)) return false;
      seenPages.add(hit.page.id);
      return true;
    })
    .sort((left, right) => {
      const leftRole = roleWeight[left.displayRole ?? "supporting"];
      const rightRole = roleWeight[right.displayRole ?? "supporting"];
      const leftType = typeWeight[left.contentType ?? "source-page"];
      const rightType = typeWeight[right.contentType ?? "source-page"];
      return rightRole - leftRole || rightType - leftType || (right.displayScore ?? 0) - (left.displayScore ?? 0) || right.score - left.score;
    });
  const selected = [] as typeof candidates;
  const bySource = new Map<string, number>();
  for (const hit of candidates) {
    const title = normalizedTitle(hit.page.section);
    if (seenTitles.has(title)) continue;
    const sourceCount = bySource.get(hit.page.sourceId) ?? 0;
    if (sourceCount >= 2) continue;
    seenTitles.add(title);
    bySource.set(hit.page.sourceId, sourceCount + 1);
    selected.push(hit);
    if (selected.length >= 3) break;
  }
  for (const hit of candidates) {
    if (selected.length >= 3) break;
    const title = normalizedTitle(hit.page.section);
    if (selected.some((item) => item.page.id === hit.page.id) || seenTitles.has(title)) continue;
    seenTitles.add(title);
    selected.push(hit);
  }
  const citations = selected.map(hitToCitation);
  return NextResponse.json({ module: curriculumModule, citations }, {
    headers: { "cache-control": "no-store" },
  });
}
