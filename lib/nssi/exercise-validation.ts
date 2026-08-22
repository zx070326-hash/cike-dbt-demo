import type { LearningFeedback, ProtocolModule } from "./types";

export type SanitizedExercisePayload = Record<string, string | string[] | number>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/gu, "").trim().slice(0, maxLength);
}

export function validateModuleExercisePayload(
  module: ProtocolModule,
  input: unknown,
): SanitizedExercisePayload {
  if (!isRecord(input)) throw new Error("EXERCISE_PAYLOAD_INVALID");

  // Module 3 is completed through the versioned safety-plan editor. Only the
  // resulting version reference is accepted here; arbitrary client answers
  // can never mark this protocol module complete.
  if (module.id === "module-03") {
    const version = Number(input.safetyPlanVersion);
    if (!Number.isInteger(version) || version < 1) throw new Error("SAFETY_PLAN_REQUIRED");
    return { safetyPlanVersion: version };
  }

  const result: SanitizedExercisePayload = {};
  for (const field of module.exercise.fields) {
    if (field.kind === "multi-select") {
      const raw = input[field.id];
      const selected: string[] = Array.isArray(raw)
        ? [...new Set(raw.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
        : [];
      if (selected.some((item) => !field.options?.includes(item))) throw new Error(`EXERCISE_OPTION_INVALID:${field.id}`);
      if (selected.length > Math.min(field.options?.length ?? 8, 8)) throw new Error(`EXERCISE_SELECTION_LIMIT:${field.id}`);
      if (field.required && !selected.length) throw new Error(`EXERCISE_REQUIRED:${field.id}`);
      if (selected.length) result[field.id] = selected;
      continue;
    }

    const value = cleanText(input[field.id], field.kind === "textarea" ? 1200 : 300);
    if (field.required && !value) throw new Error(`EXERCISE_REQUIRED:${field.id}`);
    if (field.kind === "scale" && value && !field.options?.includes(value)) throw new Error(`EXERCISE_SCALE_INVALID:${field.id}`);
    if (value) result[field.id] = value;
  }
  return result;
}

export function buildLearningFeedback(module: ProtocolModule): LearningFeedback {
  const primarySkill = module.skillCardIds[0];
  if (module.id === "module-01") return {
    moduleId: module.id,
    title: "支持地图已经有了第一版",
    reflection: "下一步不用继续补得很完整。先把支持者和求助路径留在容易找到的位置。",
    suggestedSkillIds: module.skillCardIds,
    nextSteps: ["chat", "ema"],
  };
  if (module.id === "module-03") return {
    moduleId: module.id,
    title: "安全计划已经连接到求助入口",
    reflection: "趁现在相对平稳，可以试着确认一次：联系人号码能否直接拨通，计划里的第一步是否足够具体。",
    suggestedSkillIds: module.skillCardIds,
    nextSteps: ["practice", "chat"],
  };
  return {
    moduleId: module.id,
    title: "你已经把知识写进了自己的情境",
    reflection: primarySkill
      ? "现在最有价值的不是再读一遍，而是在合适的时候练一次，并记录练习前后发生了什么。"
      : "可以先回看刚写下的内容，再选择一个今天做得到的小动作。",
    suggestedSkillIds: module.skillCardIds.slice(0, 3),
    nextSteps: ["practice", "chat", "ema"],
  };
}
