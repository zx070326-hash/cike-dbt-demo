import { NextResponse } from "next/server";
import {
  createHelpRisk,
  createTextRisk,
  getParticipantSnapshot,
  getActivePhase1Config,
  logSkill,
  markParticipantSafe,
  markNotificationRead,
  recordEmiAction,
  saveSafetyPlan,
  submitModuleExercise,
  submitEma,
  updateProtocol,
} from "../../../../lib/nssi/store";
import type { SafetyPlanSections } from "../../../../lib/nssi/types";
import { apiError, participantToken } from "../_http";
import { assessSafety } from "../../../../lib/safety/classifier";
import { classifySemanticRisk } from "../../../../lib/nssi/semantic-risk";
import { generateEmiSelfReminder } from "../../../../lib/nssi/agent";

export async function GET(request: Request) {
  try {
    const snapshot = await getParticipantSnapshot(participantToken(request));
    return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const token = participantToken(request);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "protocol.reading") {
      return NextResponse.json(await updateProtocol(token, {
        type: "record-reading",
        moduleId: String(body.moduleId ?? ""),
        progress: Number(body.progress),
      }));
    }
    if (action === "protocol.exercise") {
      return NextResponse.json(await submitModuleExercise(
        token,
        String(body.moduleId ?? ""),
        body.payload ?? {},
      ));
    }
    if (action === "ema.submit") {
      const input = body.payload as Record<string, unknown>;
      const note = typeof input.note === "string" ? input.note.trim().slice(0, 300) : undefined;
      const active = await getActivePhase1Config();
      const deterministic = note ? assessSafety(note, [], active.config.riskLexicon) : null;
      // EMA must remain fast: this independent classifier has a short cap. A
      // deterministic threshold/lexicon hit cannot be vetoed by its result.
      const semantic = note
        ? await classifySemanticRisk(note, 700, active.config.agent.prompts.riskClassifier)
        : { triggered: false, level: "none" as const, status: "not-run", latencyMs: 0 };
      return NextResponse.json(await submitEma(token, {
        localDate: String(input.localDate ?? ""),
        urge: Number(input.urge),
        moods: Array.isArray(input.moods) ? input.moods.filter((item): item is string => typeof item === "string") : [],
        skills: Array.isArray(input.skills) ? input.skills.filter((item): item is string => typeof item === "string") : [],
        note,
        isBackfill: input.isBackfill === true,
        completionDurationMs: Number.isInteger(input.completionDurationMs) ? Number(input.completionDurationMs) : undefined,
      }, active.config.ema.urgeThreshold, {
        deterministicTriggered: deterministic?.requiresImmediateAction === true,
        semanticTriggered: semantic.triggered,
        semanticLevel: semantic.level === "none" ? undefined : semantic.level,
        semanticStatus: semantic.status,
        semanticLatencyMs: semantic.latencyMs,
      }, generateEmiSelfReminder));
    }
    if (action === "safety-plan.save") {
      return NextResponse.json(await saveSafetyPlan(token, body.payload as SafetyPlanSections));
    }
    if (action === "skill.log") {
      const input = body.payload as Record<string, unknown>;
      const note = typeof input.note === "string" ? input.note.trim().slice(0, 300) : undefined;
      const targetCustom = typeof input.targetCustom === "string" ? input.targetCustom.trim().slice(0, 80) : undefined;
      const log = await logSkill(token, {
        skillIds: Array.isArray(input.skillIds) ? input.skillIds.filter((item): item is string => typeof item === "string") : [],
        intensityBefore: Number(input.intensityBefore),
        intensityAfter: Number(input.intensityAfter),
        targetType: typeof input.targetType === "string" ? input.targetType : undefined,
        targetCustom,
        outcomes: Array.isArray(input.outcomes) ? input.outcomes.filter((item): item is string => typeof item === "string") : [],
        note,
      });
      const safetyText = [targetCustom, note].filter(Boolean).join("。");
      if (!safetyText) return NextResponse.json({ log });
      const active = await getActivePhase1Config();
      const deterministic = assessSafety(safetyText, [], active.config.riskLexicon);
      const semantic = await classifySemanticRisk(safetyText, 700, active.config.agent.prompts.riskClassifier);
      let riskEventId: string | undefined;
      if (deterministic.requiresImmediateAction) {
        riskEventId = (await createTextRisk(token, "deterministic-text", deterministic.reasonCodes.includes("EXTERNAL_LEXICON_L1B") ? "suspected" : "high")).id;
      } else if (semantic.triggered && semantic.level !== "none") {
        riskEventId = (await createTextRisk(token, "semantic-text", semantic.level === "imminent" ? "imminent" : semantic.level === "high" ? "high" : "suspected")).id;
      }
      return NextResponse.json({ log, riskEventId });
    }
    if (action === "risk.help") {
      return NextResponse.json(await createHelpRisk(token), { status: 201 });
    }
    if (action === "risk.mark-safe") {
      await markParticipantSafe(token, String(body.riskEventId ?? ""));
      return NextResponse.json({ ok: true, eventRemainsOpenForCoach: true });
    }
    if (action === "notification.read") {
      return NextResponse.json(await markNotificationRead(token, String(body.notificationId ?? "")));
    }
    if (action === "emi.event") {
      return NextResponse.json(await recordEmiAction(
        token,
        String(body.event ?? "") as "displayed" | "step-viewed" | "contact-opened" | "safety-plan-opened" | "closed" | "marked-supported",
        typeof body.metadata === "object" && body.metadata !== null ? body.metadata as Record<string, unknown> : {},
      ));
    }
    return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}
