import { NextResponse } from "next/server";
import {
  createHelpRisk,
  getParticipantSnapshot,
  getActivePhase1Config,
  logSkill,
  markParticipantSafe,
  markNotificationRead,
  saveSafetyPlan,
  submitModuleExercise,
  submitEma,
  updateProtocol,
} from "../../../../lib/nssi/store";
import type { SafetyPlanSections } from "../../../../lib/nssi/types";
import { apiError, participantToken } from "../_http";
import { assessSafety } from "../../../../lib/safety/classifier";
import { classifySemanticRisk } from "../../../../lib/nssi/semantic-risk";

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
        ? await classifySemanticRisk(note, 700)
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
      }));
    }
    if (action === "safety-plan.save") {
      return NextResponse.json(await saveSafetyPlan(token, body.payload as SafetyPlanSections));
    }
    if (action === "skill.log") {
      const input = body.payload as Record<string, unknown>;
      return NextResponse.json(await logSkill(token, {
        skillId: String(input.skillId ?? ""),
        intensityBefore: Number(input.intensityBefore),
        intensityAfter: Number(input.intensityAfter),
        note: typeof input.note === "string" ? input.note.trim().slice(0, 300) : undefined,
      }));
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
    return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}
