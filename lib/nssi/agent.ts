import { runAssistantTurn, type AssistantRuntimeContext } from "../application/run-assistant-turn";
import type { ChatPayload, ExperienceMode } from "../dbt-content";
import type { ConversationRetention } from "./types";
import type { ConversationTurn } from "../model-adapter";
import { generateEmiSelfReminderDraft, generateNssiReminderDraft } from "../model-adapter";
import { assessSafety } from "../safety/classifier";
import { classifySemanticRisk } from "./semantic-risk";
import {
  createTextRisk,
  getActivePhase1Config,
  getParticipantDailyModelUsage,
  getParticipantSnapshot,
  modulesWithConfig,
  recordChatExchange,
  type Phase1Config,
} from "./store";

function emaSummary(ema: Awaited<ReturnType<typeof getParticipantSnapshot>>["recentEma"]) {
  const recent = ema.filter((item) => !item.isBackfill).slice(0, 7);
  if (!recent.length) return "近7日没有有效记录";
  const average = recent.reduce((sum, item) => sum + item.urge, 0) / recent.length;
  const maximum = Math.max(...recent.map((item) => item.urge));
  return `${recent.length}次记录，冲动均值${average.toFixed(1)}，最高${maximum}`;
}

function skillSummary(snapshot: Awaited<ReturnType<typeof getParticipantSnapshot>>) {
  const recent = snapshot.recentSkillLogs.slice(0, 3);
  if (!recent.length) return "暂无技能记录";
  return recent.map((item) => {
    const skills = (item.skillIds?.length ? item.skillIds : [item.skillId]).join("+");
    const outcomes = item.outcomes?.length ? `，结果:${item.outcomes.join("+")}` : "";
    return `${skills}:${item.intensityBefore}→${item.intensityAfter}${outcomes}`;
  }).join("；");
}

function exerciseSummary(snapshot: Awaited<ReturnType<typeof getParticipantSnapshot>>) {
  const recent = snapshot.recentModuleExercises?.slice(0, 2) ?? [];
  if (!recent.length) return "暂无课程练习记录";
  return recent.map((submission) => {
    const answers = submission.answers.slice(0, 3).map((answer) => `${answer.label}:${answer.value.slice(0, 80)}`).join("；");
    return `${submission.moduleTitle}${answers ? `（${answers}）` : "（已完成）"}`;
  }).join("；");
}

function runtimeContext(
  snapshot: Awaited<ReturnType<typeof getParticipantSnapshot>>,
  modules: ReturnType<typeof modulesWithConfig>,
): AssistantRuntimeContext {
  const unlocked = modules.filter((module) => snapshot.protocol.progress[module.id]?.status !== "locked");
  const current = modules.find((module) => module.id === snapshot.protocol.currentModuleId);
  const allowedSkillCardIds = [...new Set([
    "mindfulness-what",
    "emotion-understand",
    "distress-crisis-survival",
    ...unlocked.flatMap((module) => module.skillCardIds),
  ])];
  return {
    currentWeek: snapshot.protocol.currentWeek,
    currentModuleId: snapshot.protocol.currentModuleId,
    currentModuleTitle: current?.title,
    allowedSkillCardIds,
    emaSummary: emaSummary(snapshot.recentEma),
    recentSkillSummary: skillSummary(snapshot),
    recentExerciseSummary: exerciseSummary(snapshot),
    hasSafetyPlan: Boolean(snapshot.safetyPlan),
  };
}

function semanticCrisisPayload(level: "suspected" | "high" | "imminent"): ChatPayload {
  const urgent = level === "imminent";
  return {
    kind: "crisis",
    title: urgent ? "现在先获得现实中的立即帮助" : "先暂停普通对话，确认你现在的安全",
    message: urgent
      ? "请立刻放下并远离可能造成伤害的物品或地点，联系一个能马上到场的人。如果危险正在发生或你可能很快行动，立即拨打 120 或 110，不要等待应用回复。"
      : "这句话里有需要进一步确认的安全信号。先不要独自承受：和可能造成伤害的物品或地点拉开距离，并联系一个可信任、能现实中陪伴你的人。",
    steps: [
      "先移动到有人、相对安全的地方。",
      "联系安全计划中的支持者，请对方保持通话或到场。",
      "危险迫近时立即拨打 120 或 110；也可拨打 12356 心理援助热线。",
    ],
    followUpQuestion: "你现在是否已经准备行动，或者身边有可能造成伤害的东西？",
    suggestedReplies: ["危险就在眼前", "没有准备，但我很难保证安全", "我已联系到现实中的人"],
    nextAction: "none",
    mode: "safety",
  };
}

function validateOutbound(payload: ChatPayload, config: Phase1Config) {
  const substantive = Boolean(payload.skillCard || payload.steps?.some((step) => /DBT|STOP|TIP|事实|情绪|行动|接纳|正念|人际/u.test(step)));
  const citations = payload.citations ?? [];
  const claims = payload.claims ?? [];
  const citationIds = new Set(citations.map((citation) => citation.id));
  const claimsGrounded = claims.every((claim) => claim.citationIds.length > 0 && claim.citationIds.every((id) => citationIds.has(id)));
  const sourceAnchorsValid = citations.every((citation) => Boolean(citation.chunkId || citation.id) && Number.isInteger(citation.pdfPage));
  const bannedLeakage = /(?:建议|应该).{0,8}(?:停药|换药|加药|减药|剂量)|确诊为|保证治愈/u.test([
    payload.title, payload.message, ...(payload.steps ?? []), payload.skillCard?.summary,
  ].filter(Boolean).join(" "));
  const conversationText = [payload.title, payload.message, payload.followUpQuestion, ...(payload.steps ?? [])].filter(Boolean).join("");
  const knowledgeText = [
    payload.skillCard?.summary, payload.skillCard?.whyItMayHelp, payload.skillCard?.tryNow,
    ...(payload.skillCard?.takeaways ?? []),
  ].filter(Boolean).join("");
  const primaryText = `${conversationText}${knowledgeText}`;
  const lengthValid = conversationText.length <= config.agent.maxChineseCharacters && knowledgeText.length <= config.agent.maxChineseCharacters;
  const internalJargon = /暂定路由|低负担|知识摄取|召回率|本轮检索|专业结论/u.test(primaryText);
  const configuredToneViolation = config.tone.blockedTerms.some((term) => primaryText.includes(term));
  return {
    passed: !bannedLeakage && !internalJargon && !configuredToneViolation && lengthValid && sourceAnchorsValid && (!substantive || citations.length > 0 || payload.mode === "safety" || payload.mode === "bridge") && claimsGrounded,
    checks: { substantive, citationsPresent: citations.length > 0, claimsGrounded, sourceAnchorsValid, bannedLeakage, internalJargon, configuredToneViolation, lengthValid, conversationCharacters: conversationText.length, knowledgeCharacters: knowledgeText.length },
  };
}

export async function runNssiAgentTurn(input: {
  token: string;
  conversationId: string;
  message: string;
  history: ConversationTurn[];
  mode: ExperienceMode;
  rawRetention?: ConversationRetention;
}) {
  const startedAt = performance.now();
  const [snapshot, activeConfig, usedToday] = await Promise.all([
    getParticipantSnapshot(input.token),
    getActivePhase1Config(),
    getParticipantDailyModelUsage(input.token),
  ]);
  const configuredModules = modulesWithConfig(activeConfig.config);
  const context = runtimeContext(snapshot, configuredModules);
  const conservativeTurnTokens = 2700;
  context.allowModel = usedToday + conservativeTurnTokens <= activeConfig.config.agent.dailyBudgetTokens;
  context.riskLexicon = activeConfig.config.riskLexicon;
  context.clinicalGuidance = activeConfig.config.agent.clinicalGuidance;
  context.prompts = activeConfig.config.agent.prompts;
  context.currentModuleTitle = configuredModules.find((module) => module.id === snapshot.protocol.currentModuleId)?.title;

  // Semantic classification is physically separate and never enters the
  // ordinary chat context. We may compute the ordinary candidate in parallel,
  // but never release it until the safety result is known.
  const [semanticRisk, ordinaryCandidate] = await Promise.all([
    classifySemanticRisk(input.message, undefined, activeConfig.config.agent.prompts.riskClassifier),
    runAssistantTurn(input.message, input.history, input.mode, context),
  ]);

  let payload = ordinaryCandidate;
  let riskEventId: string | undefined;
  const deterministicSafety = assessSafety(
    input.message,
    input.history.filter((turn) => turn.role === "user").map((turn) => turn.content),
    activeConfig.config.riskLexicon,
  );
  if (ordinaryCandidate.kind === "crisis") {
    riskEventId = (await createTextRisk(input.token, "deterministic-text", deterministicSafety.reasonCodes.includes("EXTERNAL_LEXICON_L1B") ? "suspected" : "high")).id;
  } else if (semanticRisk.triggered && semanticRisk.level !== "none") {
    payload = semanticCrisisPayload(semanticRisk.level);
    riskEventId = (await createTextRisk(
      input.token,
      "semantic-text",
      semanticRisk.level === "imminent" ? "imminent" : semanticRisk.level === "high" ? "high" : "suspected",
    )).id;
  }

  let validation = validateOutbound(payload, activeConfig.config);
  let regenerated = false;
  if (!validation.passed && payload.mode !== "safety" && context.allowModel && usedToday + conservativeTurnTokens * 2 <= activeConfig.config.agent.dailyBudgetTokens) {
    const failedChecks = Object.entries(validation.checks).filter(([, value]) => value === false).map(([key]) => key).join(", ");
    const retry = await runAssistantTurn(input.message, input.history, input.mode, {
      ...context,
      qualityRetry: failedChecks || "出站结构不合格",
    });
    const retryValidation = validateOutbound(retry, activeConfig.config);
    if (retryValidation.passed) {
      payload = retry;
      validation = retryValidation;
    }
    regenerated = true;
  }
  if (!validation.passed) {
    payload = {
      kind: "answer",
      title: "先从当前模块里选一小步",
      message: "刚才的个性化回答没有通过来源核对，所以没有直接发出。你可以继续描述发生了什么，或者先回到当前模块完成一个已经审核过的练习。",
      suggestedReplies: ["回到当前模块", "我想继续说说刚才发生的事"],
      citations: [],
      nextAction: "none",
      mode: "bridge",
      experienceMode: input.mode,
      generation: { attempted: true, status: "rejected" },
    };
    validation = validateOutbound(payload, activeConfig.config);
  }
  const latencyMs = Math.round(performance.now() - startedAt);
  await recordChatExchange(input.token, {
    conversationId: input.conversationId,
    userMessage: input.message,
    assistantPayload: payload as unknown as Record<string, unknown>,
    mode: input.mode,
    latencyMs,
    validator: {
      ...validation,
      semanticRisk: { status: semanticRisk.status, triggered: semanticRisk.triggered, level: semanticRisk.level, latencyMs: semanticRisk.latencyMs },
      riskEventId,
      budget: {
        usedBeforeTurn: usedToday,
        dailyLimit: activeConfig.config.agent.dailyBudgetTokens,
        modelAllowed: context.allowModel,
        accountingMethod: "conservative-estimate",
      },
    },
    tokenUsage: {
      estimatedTotalTokens: context.allowModel ? conservativeTurnTokens * (regenerated ? 2 : 1) : 0,
      accountingMethod: "conservative-estimate",
    },
    promptVersion: activeConfig.config.agent.promptVersion,
    rawRetention: input.rawRetention,
  });
  return { ...payload, riskEventId };
}

export async function personalizeScheduledNotification(input: Parameters<typeof generateNssiReminderDraft>[0]) {
  const active = await getActivePhase1Config();
  return generateNssiReminderDraft(input, active.config.agent.prompts.reminder);
}

export async function generateEmiSelfReminder(input: Parameters<typeof generateEmiSelfReminderDraft>[0]) {
  const active = await getActivePhase1Config();
  return generateEmiSelfReminderDraft(input, active.config.agent.prompts.emiSelfReminder);
}
