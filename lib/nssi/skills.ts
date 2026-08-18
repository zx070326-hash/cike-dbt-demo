export type DbtSkillCategoryId = "mindfulness" | "distress" | "emotion" | "interpersonal" | "analysis";

export type DbtSkillDefinition = {
  id: string;
  label: string;
  category: DbtSkillCategoryId;
  summary: string;
};

export const DBT_SKILL_CATEGORIES: Array<{ id: DbtSkillCategoryId; label: string }> = [
  { id: "mindfulness", label: "正念" },
  { id: "distress", label: "痛苦耐受" },
  { id: "emotion", label: "情绪调节" },
  { id: "interpersonal", label: "人际效能" },
  { id: "analysis", label: "行为分析" },
];

/**
 * Stable product catalogue. These IDs mirror the 18 reviewed navigation cards
 * in the knowledge layer; labels can change without breaking longitudinal data.
 */
export const DBT_SKILLS: DbtSkillDefinition[] = [
  { id: "mindfulness-wise-mind", label: "智慧心", category: "mindfulness", summary: "在情绪与理性之间寻找有效的下一步" },
  { id: "mindfulness-what", label: "观察、描述与参与", category: "mindfulness", summary: "把注意力带回正在发生的体验" },
  { id: "mindfulness-how", label: "不评判、专一与有效", category: "mindfulness", summary: "用不评判和一次一事的方式行动" },
  { id: "distress-stop", label: "STOP", category: "distress", summary: "先停下自动行动，再观察和选择" },
  { id: "distress-tip", label: "TIP 身体调节", category: "distress", summary: "用安全的身体方法降低高唤起" },
  { id: "distress-crisis-survival", label: "危机生存", category: "distress", summary: "安全度过短时情绪高峰" },
  { id: "distress-radical-acceptance", label: "全然接纳", category: "distress", summary: "承认暂时无法改变的现实" },
  { id: "emotion-understand", label: "理解与命名情绪", category: "emotion", summary: "识别情绪、身体反应和行动冲动" },
  { id: "emotion-check-facts", label: "核对事实", category: "emotion", summary: "把可观察事实与解释分开" },
  { id: "emotion-opposite-action", label: "相反行动", category: "emotion", summary: "在适用时做与无效冲动相反的行动" },
  { id: "emotion-problem-solving", label: "问题解决", category: "emotion", summary: "把可改变的问题转化为具体行动" },
  { id: "emotion-vulnerability", label: "降低情绪脆弱性", category: "emotion", summary: "减少容易失控的可改变条件" },
  { id: "interpersonal-dear-man", label: "DEAR MAN", category: "interpersonal", summary: "清楚提出请求、拒绝或界限" },
  { id: "interpersonal-give", label: "GIVE", category: "interpersonal", summary: "在互动中维护关系质量" },
  { id: "interpersonal-fast", label: "FAST", category: "interpersonal", summary: "在互动中维护自尊" },
  { id: "interpersonal-priorities", label: "人际目标优先级", category: "interpersonal", summary: "权衡结果、关系与自尊" },
  { id: "behavior-chain", label: "行为链分析", category: "analysis", summary: "找到事件发展中可改变的环节" },
  { id: "behavior-missing-links", label: "缺失环节分析", category: "analysis", summary: "理解计划为何没有转化为行动" },
];

export const SUPPORT_ACTIONS = [
  { id: "support-contact", label: "联系现实中的支持者", summary: "给可信任的人发消息、打电话或当面求助" },
] as const;

export const QUICK_SKILL_IDS = [
  "distress-stop",
  "distress-tip",
  "mindfulness-what",
  "emotion-check-facts",
  "distress-radical-acceptance",
] as const;

export const SKILL_TARGETS = [
  { id: "self-harm-urge", label: "自伤冲动", intensityLabel: "自伤冲动" },
  { id: "anxiety", label: "焦虑或紧张", intensityLabel: "焦虑或紧张" },
  { id: "sadness", label: "低落或难过", intensityLabel: "低落或难过" },
  { id: "anger", label: "愤怒或冲突", intensityLabel: "愤怒或激动" },
  { id: "rumination", label: "反复思考", intensityLabel: "被想法困住的程度" },
  { id: "interpersonal", label: "人际沟通", intensityLabel: "这件事带来的困扰" },
  { id: "other", label: "其他困扰", intensityLabel: "困扰或冲动" },
] as const;

export const SKILL_OUTCOMES = [
  { id: "paused", label: "让我停下来" },
  { id: "safer", label: "让我更安全" },
  { id: "less-intense", label: "强度有所下降" },
  { id: "goal-action", label: "更接近想做的事" },
  { id: "clearer", label: "更清楚下一步" },
  { id: "no-change", label: "暂时没感觉" },
  { id: "worse", label: "反而更难受" },
] as const;

/** Closed vocabulary for the brief EMA check-in. Keeping it shared prevents
 * clients and analytics from silently inventing incompatible mood labels. */
export const EMA_MOODS = ["焦虑", "难过", "生气", "空虚", "孤独", "羞愧", "平静", "有希望"] as const;

const skillById = new Map<string, DbtSkillDefinition>(DBT_SKILLS.map((skill) => [skill.id, skill]));
const skillIdByLabel = new Map<string, string>(DBT_SKILLS.map((skill) => [skill.label, skill.id]));
const supportById = new Map<string, (typeof SUPPORT_ACTIONS)[number]>(SUPPORT_ACTIONS.map((action) => [action.id, action]));
const targetById = new Map<string, (typeof SKILL_TARGETS)[number]>(SKILL_TARGETS.map((target) => [target.id, target]));
const outcomeById = new Map<string, (typeof SKILL_OUTCOMES)[number]>(SKILL_OUTCOMES.map((outcome) => [outcome.id, outcome]));
const emaMoodSet = new Set<string>(EMA_MOODS);

export function isPracticeOptionId(value: string) {
  return skillById.has(value) || supportById.has(value);
}

export function isSkillTargetId(value: string) {
  return targetById.has(value);
}

export function isSkillOutcomeId(value: string) {
  return outcomeById.has(value);
}

export function isEmaMood(value: string) {
  return emaMoodSet.has(value);
}

export function normalizePracticeOptionId(value: string) {
  if (isPracticeOptionId(value)) return value;
  if (value === "STOP") return "distress-stop";
  if (value === "节律呼吸") return "distress-tip";
  if (value === "观察与描述") return "mindfulness-what";
  if (value === "核对事实") return "emotion-check-facts";
  if (value === "全然接纳") return "distress-radical-acceptance";
  if (value === "联系支持者") return "support-contact";
  return skillIdByLabel.get(value) ?? value;
}

export function practiceOptionLabel(value: string) {
  const normalized = normalizePracticeOptionId(value);
  return skillById.get(normalized)?.label ?? supportById.get(normalized)?.label ?? value;
}

export function skillTargetLabel(value?: string) {
  return value ? targetById.get(value)?.label : undefined;
}

export function skillTargetIntensityLabel(value?: string) {
  return value ? targetById.get(value)?.intensityLabel : undefined;
}

export function skillOutcomeLabel(value: string) {
  return outcomeById.get(value)?.label ?? value;
}
