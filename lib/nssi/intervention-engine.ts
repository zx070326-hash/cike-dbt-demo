import type { EmaRecord, RiskEvent, RiskLevel, RiskSource, SkillLog } from "./types";

export type EmaSubmission = Omit<EmaRecord, "id" | "submittedAt" | "riskEvaluation"> & {
  id?: string;
  submittedAt?: string;
};

export type EmiDecision = {
  trigger: boolean;
  level: RiskLevel | null;
  intervention: "none" | "stop" | "self-reminder" | "safety-plan" | "crisis";
  fallbackTemplateId: string | null;
  reasonCodes: string[];
  suggestedSkillId?: string;
};

export function validateEma(input: EmaSubmission) {
  if (!Number.isInteger(input.urge) || input.urge < 0 || input.urge > 10) {
    throw new Error("EMA urge must be an integer from 0 to 10");
  }
  if (!input.localDate || Number.isNaN(Date.parse(`${input.localDate}T00:00:00Z`))) {
    throw new Error("EMA localDate must be YYYY-MM-DD");
  }
  if (input.moods.length > 6 || input.skills.length > 8) throw new Error("EMA selection limit exceeded");
  if ((input.note?.length ?? 0) > 300) throw new Error("EMA note must be at most 300 characters");
  if (input.completionDurationMs !== undefined && (!Number.isInteger(input.completionDurationMs) || input.completionDurationMs < 0 || input.completionDurationMs > 30 * 60 * 1000)) {
    throw new Error("EMA completion duration invalid");
  }
}

export function decideEmaIntervention(
  input: Pick<EmaRecord, "urge" | "isBackfill">,
  threshold = 7,
  semanticTriggered = false,
): EmiDecision {
  if (input.isBackfill) {
    return { trigger: false, level: null, intervention: "none", fallbackTemplateId: null, reasonCodes: ["BACKFILL_EXCLUDED"] };
  }
  if (semanticTriggered || input.urge >= 9) {
    return {
      trigger: true,
      level: "high",
      intervention: "safety-plan",
      fallbackTemplateId: "emi-high-safety-plan-v1",
      reasonCodes: semanticTriggered ? ["SEMANTIC_RISK"] : ["EMA_URGE_9_10"],
    };
  }
  if (input.urge >= threshold) {
    return {
      trigger: true,
      level: "suspected",
      intervention: "stop",
      fallbackTemplateId: "emi-threshold-stop-v1",
      reasonCodes: ["EMA_THRESHOLD"],
    };
  }
  return { trigger: false, level: null, intervention: "none", fallbackTemplateId: null, reasonCodes: ["BELOW_THRESHOLD"] };
}

export function createRiskEvent(
  userId: string,
  sources: RiskSource[],
  level: RiskLevel,
  at = new Date().toISOString(),
): RiskEvent {
  return {
    id: crypto.randomUUID(),
    userId,
    sources: [...new Set(sources)],
    level,
    status: "open",
    createdAt: new Date(at).toISOString(),
    notificationDeadlineAt: new Date(Date.parse(at) + 60_000).toISOString(),
  };
}

export function effectiveSkills(logs: SkillLog[], minUses = 2) {
  const grouped = new Map<string, { uses: number; totalChange: number }>();
  for (const log of logs) {
    const current = grouped.get(log.skillId) ?? { uses: 0, totalChange: 0 };
    current.uses += 1;
    current.totalChange += log.intensityBefore - log.intensityAfter;
    grouped.set(log.skillId, current);
  }
  return [...grouped.entries()]
    .filter(([, value]) => value.uses >= minUses)
    .map(([skillId, value]) => ({
      skillId,
      uses: value.uses,
      averageIntensityChange: Math.round((value.totalChange / value.uses) * 10) / 10,
    }))
    .sort((left, right) => right.averageIntensityChange - left.averageIntensityChange || right.uses - left.uses);
}
