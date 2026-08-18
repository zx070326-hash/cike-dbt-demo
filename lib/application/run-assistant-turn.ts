import {
  getContextualSafetyResponse,
  respondFromFrozenEvidence,
  sourceCitations,
  type ChatPayload,
  type ExperienceMode,
} from "../dbt-content";
import { buildConversationDecision } from "../conversation/session-decision";
import { getSimpleConversationResponse } from "../conversation-bridge";
import {
  buildCompanionFallback,
  companionRetrievalQuery,
} from "../companion-mode";
import {
  buildClarificationResponse,
  buildRetrievalFallback,
  hitToCitation,
  planRetrieval,
  retrievalMetadata,
  retrieveEvidence,
  normalizeSourceCitation,
  type RetrievalPlan,
} from "../rag";
import { assessSafety } from "../safety/classifier";
import type { ExternalRiskLexicon } from "../safety/classifier";
import {
  type ConversationTurn,
  generateCompanionAnswer,
  generateConversationalBridge,
  generateGroundedAnswer,
  isModelConfigured,
} from "../model-adapter";

export function normalizeHistory(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { role: "user" | "assistant"; content: string } => (
      typeof item === "object" && item !== null &&
      ["user", "assistant"].includes(String((item as { role?: unknown }).role)) &&
      typeof (item as { content?: unknown }).content === "string"
    ))
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 800) }))
    .filter((item) => item.content)
    .slice(-6);
}

export type AssistantRuntimeContext = {
  currentWeek?: number;
  currentModuleId?: string;
  currentModuleTitle?: string;
  allowedSkillCardIds?: string[];
  emaSummary?: string;
  recentSkillSummary?: string;
  hasSafetyPlan?: boolean;
  allowModel?: boolean;
  qualityRetry?: string;
  clinicalGuidance?: string;
  riskLexicon?: ExternalRiskLexicon;
};

function comparisonText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function bigrams(value: string) {
  const normalized = comparisonText(value);
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    result.add(normalized.slice(index, index + 2));
  }
  return result;
}

function payloadText(payload: ChatPayload) {
  return [
    payload.title,
    payload.message,
    payload.followUpQuestion,
    payload.skillCard?.title,
    payload.skillCard?.summary,
    payload.skillCard?.whyItMayHelp,
    payload.skillCard?.tryNow,
    ...(payload.skillCard?.takeaways ?? []),
    ...(payload.steps ?? []),
  ].filter(Boolean).join(" ");
}

const protocolGatedSkillNames: Array<[string, RegExp]> = [
  ["emotion-check-facts", /核对事实/u],
  ["emotion-opposite-action", /相反行为|相反行动/u],
  ["emotion-problem-solving", /问题解决/u],
  ["distress-radical-acceptance", /全然接纳|彻底接纳/u],
  ["interpersonal-dear-man", /DEAR\s*MAN|DEARMAN/iu],
  ["interpersonal-give", /\bGIVE\b/iu],
  ["interpersonal-fast", /\bFAST\b/iu],
  ["behavior-chain", /行为链|链式分析|链锁分析/u],
];

function violatesProtocolSkillBoundary(
  payload: ChatPayload,
  allowedSkills?: ReadonlySet<string>,
) {
  if (!allowedSkills?.size) return false;
  const visible = payloadText(payload);
  return protocolGatedSkillNames.some(([skillId, pattern]) => (
    !allowedSkills.has(skillId) && pattern.test(visible)
  ));
}

function similarity(left: string, right: string) {
  const leftSet = bigrams(left);
  const rightSet = bigrams(right);
  if (!leftSet.size || !rightSet.size) return 0;
  let overlap = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) overlap += 1;
  }
  const containment = overlap / Math.min(leftSet.size, rightSet.size);
  const union = leftSet.size + rightSet.size - overlap;
  return Math.max(containment, union ? overlap / union : 0);
}

function advanceRepeatedAnswer(
  message: string,
  history: ConversationTurn[],
  payload: ChatPayload,
): ChatPayload {
  if (payload.mode === "safety") return payload;
  const previousAssistant = [...history].reverse().find((turn) => turn.role === "assistant")?.content;
  if (!previousAssistant) return payload;
  const previousNormalized = comparisonText(previousAssistant);
  const repeatsTitle = comparisonText(payload.title).length > 5 &&
    previousNormalized.includes(comparisonText(payload.title));
  const repeatsQuestion = Boolean(payload.followUpQuestion) &&
    previousNormalized.includes(comparisonText(payload.followUpQuestion ?? ""));
  if (similarity(payloadText(payload), previousAssistant) < 0.56 && !(repeatsTitle && repeatsQuestion)) {
    return payload;
  }

  if (payload.kind === "refusal") {
    return {
      ...payload,
      title: "我换个方式确认你真正想处理的部分",
      message:
        "刚才的回答没有接住你的需要。如果你是在说一件事带给你的情绪、冲动或关系困扰，可以只说最明显的一部分；如果是其他知识问题，这个体验版仍然无法可靠回答。",
      followUpQuestion: "你更想处理这件事带来的感受、接下来的行为，还是与某个人的关系？",
      suggestedReplies: ["先处理现在的感受", "我担心自己会冲动行动", "这是和一段关系有关"],
    };
  }

  if (payload.experienceMode === "companion") {
    if (/脑子.{0,4}乱|情绪.{0,3}强|冷静不下来|想先缓|还是.{0,4}(乱|难受)/u.test(message)) {
      return {
        ...payload,
        title: "先看看，刚才有没有哪怕一点变化",
        message:
          "你还是很乱，说明刚才那一步可能还不够，或者现在的情绪确实很强。我们先不重复同一套说明，也不急着往下分析。",
        followUpQuestion: "刚才停下来以后，是完全没有变化，短暂松了一点，还是反而更难受了？",
        steps: undefined,
        suggestedReplies: ["完全没有变化", "短暂松了一点", "反而更难受了"],
      };
    }
    if (/放不下|舍不得|忘不了|离不开|还是喜欢|总想[他她]/u.test(message)) {
      return {
        ...payload,
        title: "先不催自己放下，我们往里看一点",
        message:
          "刚才我们已经看过这段关系发生了什么。你现在还放不下，下一步不需要再重复分析对方，而是弄清这份舍不得在保护什么。",
        followUpQuestion: "如果真的放下，你最害怕一起失去的是什么？",
        steps: undefined,
        suggestedReplies: ["我怕失去曾经的感觉", "我怕以后遇不到了", "我怕承认这段关系结束了"],
      };
    }
    return {
      ...payload,
      title: "我们换个角度，继续往下走",
      message: "前面的内容先不用再重复。现在只抓住最卡住你的那一小部分，就会更容易找到贴合的书中方法。",
      followUpQuestion: "此刻更难的是接受已经发生的事、停不住脑中的想法，还是不知道下一步怎么做？",
      steps: undefined,
      suggestedReplies: ["难在接受已经发生的事", "脑中的想法停不下来", "我不知道下一步怎么做"],
    };
  }

  if (/放不下|舍不得|忘不了|离不开|还是喜欢|总想[他她]/u.test(message)) {
    return {
      ...payload,
      title: "放不下的时候，先看看自己究竟舍不得什么",
      message:
        "刚才我们已经看过这段关系的事实和底线了。你现在说“放不下”，说明下一步不是再重复分析对方，而是把舍不得的部分说清楚。你舍不得的可能是这个人、曾经被在意的感觉，或对未来的期待；不用马上选对答案，先找最接近的一项。",
      steps: [
        "完成一句：我最舍不得的是……",
        "再完成一句：如果真的放下，我最害怕失去的是……",
        "最后写下：即使还舍不得，今天我也愿意为自己守住……",
      ],
      suggestedReplies: [
        "我最舍不得的是……",
        "我最怕失去的是……",
        "我想先守住的底线是……",
      ],
      nextAction: "none",
    };
  }

  return {
    ...payload,
    title: "先抓住你现在最卡住的那一点",
    message:
      "前面的方向先不用再重复。你重复了刚才的感受，说明上一轮可能还没有接住最重要的部分；这次我们只选一个更小的入口。",
    followUpQuestion: "此刻最让你过不去的，是已经发生的事实、脑中反复出现的解释，还是不知道下一步该怎么做？",
    steps: undefined,
    suggestedReplies: [
      "最难接受的是已经发生的事",
      "我一直被一个想法困住",
      "我不知道下一步怎么做",
    ],
    nextAction: "none",
  };
}

function applyConversationDecisionToPlan(
  message: string,
  recentUserContext: string,
  basePlan: RetrievalPlan,
  route: string,
  reasonCodes: string[],
  allowedSkills?: ReadonlySet<string>,
): RetrievalPlan {
  const context = `${recentUserContext} ${message}`.trim();
  const allowed = (skillId: string) => !allowedSkills?.size || allowedSkills.has(skillId);
  const removeLockedSkillNames = (value: string) => value
    .replace(/核对事实/gu, "")
    .replace(/相反行为|相反行动/gu, "")
    .replace(/问题解决/gu, "")
    .replace(/全然接纳|彻底接纳/gu, "")
    .replace(/DEAR\s*MAN|DEARMAN|GIVE|FAST/giu, "")
    .replace(/行为链|链式分析|链锁分析/gu, "")
    .trim();
  const observeFirst = (): RetrievalPlan => ({
    kind: "guided",
    route: "direct",
    // Do not leave the name of a locked skill in the retrieval query. Merely
    // filtering the final hits is insufficient because a source paragraph can
    // be tagged to both an unlocked and a future skill.
    retrievalQuery: `${removeLockedSkillNames(context)} 正念 观察 描述 当前体验 身体感觉 行动冲动`,
    label: "先观察和描述现在的体验",
  });

  // A named skill is authoritative only inside the protocol content boundary.
  // The protocol engine, not the model or retriever, decides that boundary.
  if (basePlan.kind === "direct") {
    const namedSkillAllowed =
      (!/核对事实/u.test(message) || allowed("emotion-check-facts")) &&
      (!/相反行为|相反行动/u.test(message) || allowed("emotion-opposite-action")) &&
      (!/问题解决/u.test(message) || allowed("emotion-problem-solving")) &&
      (!/全然接纳|彻底接纳/u.test(message) || allowed("distress-radical-acceptance")) &&
      (!/DEAR\s*MAN|DEARMAN/iu.test(message) || allowed("interpersonal-dear-man")) &&
      (!/GIVE/iu.test(message) || allowed("interpersonal-give")) &&
      (!/FAST/iu.test(message) || allowed("interpersonal-fast")) &&
      (!/行为链|链式分析|链锁分析/u.test(message) || allowed("behavior-chain"));
    return namedSkillAllowed ? basePlan : observeFirst();
  }
  if (reasonCodes.includes("USER_NAMED_SKILL")) {
    return {
      kind: "direct",
      route: "direct",
      retrievalQuery: context,
      label: "用户指定的 DBT 技能",
    };
  }

  if (reasonCodes.includes("USER_REQUESTED_LISTENING")) {
    return {
      kind: "clarify",
      route: "clarify",
      retrievalQuery: message,
      label: "先听用户说，不急着教授技能",
    };
  }

  if (route === "behavior-chain") {
    if (!allowed("behavior-chain")) return observeFirst();
    return {
      kind: "guided",
      route: "behavior-chain",
      retrievalQuery: `${context} 行为链 链式分析 脆弱因素 促发事件 问题行为 连接点 后果 STOP`,
      label: "从具体问题行为回看行为链",
    };
  }
  if (route === "distress-survival") {
    return {
      kind: "guided",
      route: "distress-survival",
      retrievalQuery: `${context} 痛苦耐受 危机生存 STOP 退后一步 观察 冲动 行动`,
      label: "先稳定再分析",
    };
  }
  if (route === "emotion-facts") {
    if (!allowed("emotion-check-facts")) return observeFirst();
    return {
      kind: "guided",
      route: "emotion-facts",
      retrievalQuery: `${context} 核对事实 诱发事件 解释 假设 证据 威胁 预测`,
      label: "区分事实、解释与预测",
    };
  }
  if (route === "acceptance") {
    if (!allowed("distress-radical-acceptance")) return {
      kind: "guided", route: "distress-survival",
      retrievalQuery: `${context} 痛苦耐受 危机生存 STOP 观察 冲动`,
      label: "先稳定再分析",
    };
    return {
      kind: "guided",
      route: "acceptance",
      retrievalQuery: `${context} 痛苦耐受 全然接纳 接纳现实 转念 我愿意`,
      label: "面对当前改变不了的事实",
      situation: basePlan.situation,
    };
  }
  if (route === "interpersonal") {
    if (!allowed("interpersonal-dear-man") && !allowed("interpersonal-give") && !allowed("interpersonal-fast")) return observeFirst();
    return {
      kind: "guided",
      route: "interpersonal",
      retrievalQuery: `${context} 人际效能 人际关系目标 关系效能 自尊效能 DEAR MAN GIVE FAST`,
      label: "澄清人际目标与表达方式",
      situation: basePlan.situation,
    };
  }
  return basePlan;
}

/**
 * Application-level orchestration. Transport, UI, model provider and source
 * storage stay outside this function so safety ordering can be tested as a
 * product invariant rather than being hidden inside an HTTP handler.
 */
export async function runAssistantTurn(
  message: string,
  history: ConversationTurn[] = [],
  experienceMode: ExperienceMode = "deep-read",
  runtimeContext: AssistantRuntimeContext = {},
): Promise<ChatPayload> {
  const allowedSkills = runtimeContext.allowedSkillCardIds?.length
    ? new Set(runtimeContext.allowedSkillCardIds)
    : undefined;
  const recentUserMessages = history
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content);

  const safety = assessSafety(message, recentUserMessages, runtimeContext.riskLexicon);
  const { state: sessionState, decision } = buildConversationDecision(message, history, safety);
  const finish = (payload: ChatPayload): ChatPayload => {
    const advanced = advanceRepeatedAnswer(message, history, payload);
    const citations = (advanced.citations ?? advanced.citationIds
      ?.map((id) => sourceCitations[id])
      .filter((citation) => Boolean(citation)))
      ?.map((citation) => normalizeSourceCitation(citation, message));
    return {
      ...advanced,
      citations,
      experienceMode: advanced.experienceMode ?? experienceMode,
      sessionState,
      decision,
    };
  };

  // Invariant 1: deterministic crisis and clinical boundaries run before any
  // retrieval or model call.
  const safetyResponse = getContextualSafetyResponse(message, recentUserMessages, runtimeContext.riskLexicon);
  if (safetyResponse) return finish(safetyResponse);

  const simpleConversation = getSimpleConversationResponse(message);
  if (simpleConversation) {
    return finish(simpleConversation);
  }

  const previousUserMessage = [...recentUserMessages].reverse()[0];
  const recentUserContext = recentUserMessages.slice(-2).join(" ");
  const isFollowup = /(^那|然后|接下来|下一步|怎么办|怎么做|继续|这个|刚才|呢[？?]?$)/u.test(message);
  const contextualQuery = previousUserMessage && (message.length <= 40 || isFollowup)
    ? `${recentUserContext} ${message}`
    : message;
  const basePlan = planRetrieval(
    message,
    recentUserContext,
    decision.inputUnderstanding,
  );
  let plan = applyConversationDecisionToPlan(
    message,
    recentUserContext,
    basePlan,
    decision.route,
    decision.reasonCodes,
    allowedSkills,
  );
  if (
    plan.kind === "out-of-scope" &&
    sessionState.lastIntervention &&
    (sessionState.responseToIntervention === "no-change" || sessionState.responseToIntervention === "worse")
  ) {
    plan = sessionState.lastIntervention === "STOP"
      ? {
          kind: "guided",
          route: "distress-survival",
          retrievalQuery: `${recentUserContext} ${message} STOP 痛苦耐受 危机生存`,
          label: "检查刚才稳定方法的效果",
        }
      : sessionState.lastIntervention === "核对事实"
        ? {
            kind: "guided",
            route: "emotion-facts",
            retrievalQuery: `${recentUserContext} ${message} 核对事实 解释 假设 证据`,
            label: "检查刚才核对事实的效果",
          }
        : {
            kind: "direct",
            route: "direct",
            retrievalQuery: `${recentUserContext} ${message} ${sessionState.lastIntervention}`,
            label: "检查刚才技能的效果",
          };
  }
  if (basePlan.kind === "direct") decision.route = "direct";
  else decision.route = plan.route;
  if (plan.kind === "out-of-scope") {
    decision.requiresClarification = false;
    return finish(buildRetrievalFallback(plan.retrievalQuery, [], undefined, plan));
  }

  if (experienceMode === "companion") {
    const retrievalQuery = companionRetrievalQuery(contextualQuery, plan);
    const hits = retrieveEvidence(retrievalQuery, 6, { allowedSkillCardIds: allowedSkills });
    if (
      sessionState.lastIntervention &&
      (sessionState.responseToIntervention === "no-change" || sessionState.responseToIntervention === "worse")
    ) {
      const fallback = buildCompanionFallback(message, hits, plan);
      return finish({
        ...fallback,
        title: sessionState.responseToIntervention === "worse"
          ? "刚才反而更难受了，我们先确认安全"
          : "刚才没有变化，我们先不重复同一步",
        message: sessionState.responseToIntervention === "worse"
          ? "谢谢你告诉我效果变差了。先暂停刚才的方法，不急着继续练；我们先确认此刻有没有伤害自己或他人的危险，再决定换方法还是联系现实中的帮助。"
          : "你已经试过了，但没有变化。我们先不重复同一个方法，也不把这当成你做错了；下一步只需要判断，是换一种稳定方式，还是先把最难受的部分说清楚。",
        followUpQuestion: sessionState.responseToIntervention === "worse"
          ? "你现在有伤害自己或他人的念头，或者已经难以保证安全吗？"
          : "此刻你更想换一种方式缓下来，还是先说说最难受的部分？",
        suggestedReplies: sessionState.responseToIntervention === "worse"
          ? ["有安全风险", "没有安全风险，但更难受了", "我能联系现实中的人"]
          : ["换一种稳定方式", "先说最难受的部分", "我想暂停一下"],
      });
    }
    let generationStatus: "rejected" | "error" | undefined;
    if (runtimeContext.allowModel !== false && isModelConfigured() && hits.length > 0) {
      try {
        const generated = await generateCompanionAnswer(message, hits, history, plan, runtimeContext);
        if (generated && !violatesProtocolSkillBoundary(generated, allowedSkills)) {
          generated.retrieval = retrievalMetadata(retrievalQuery, hits);
          return finish(generated);
        }
        generationStatus = "rejected";
        console.warn("[dbt-companion] falling back: generated companion failed schema or grounding checks");
      } catch (error) {
        generationStatus = "error";
        const reason = error instanceof Error ? error.message : "unknown_model_error";
        console.warn(`[dbt-companion] falling back: ${reason.slice(0, 120)}`);
      }
    }
    const guideQuery = basePlan.kind === "direct" && plan.label === "先观察和描述现在的体验"
      ? plan.retrievalQuery
      : message;
    return finish(buildCompanionFallback(guideQuery, hits, plan, generationStatus));
  }

  if (plan.kind === "clarify") {
    let bridgeStatus: "rejected" | "error" | undefined;
    if (runtimeContext.allowModel !== false && isModelConfigured()) {
      try {
        const generatedBridge = await generateConversationalBridge(message, history);
        if (generatedBridge) return finish(generatedBridge);
        bridgeStatus = "rejected";
        console.warn("[dbt-bridge] falling back: generated bridge failed schema or boundary checks");
      } catch (error) {
        bridgeStatus = "error";
        const reason = error instanceof Error ? error.message : "unknown_model_error";
        console.warn(`[dbt-bridge] falling back: ${reason.slice(0, 120)}`);
      }
    }
    const fallback = buildClarificationResponse();
    if (bridgeStatus) {
      fallback.generation = { attempted: true, status: bridgeStatus };
    }
    return finish(fallback);
  }

  const retrievalQuery = plan.kind === "direct" ? contextualQuery : plan.retrievalQuery;
  const hits = retrieveEvidence(retrievalQuery, 6, { allowedSkillCardIds: allowedSkills });

  // Relationship distress is easy for a model to over-route into a named
  // communication skill before the user has said they want to communicate.
  // Keep the first response deterministic and evidence-linked: validate the
  // mixed feelings, separate facts from interpretations, and clarify the
  // user's relationship and self-respect goals. A later explicit request to
  // talk, ask or refuse can still route to DEAR MAN.
  if (plan.situation === "relationship-distress" || plan.situation === "relationship-attachment") {
    return finish(buildRetrievalFallback(retrievalQuery, hits, undefined, plan));
  }

  const generatedAttempted = runtimeContext.allowModel !== false && isModelConfigured() && hits.length > 0;
  let generationStatus: "rejected" | "error" | undefined;

  if (generatedAttempted) {
    try {
      const generated = await generateGroundedAnswer(message, hits, history, plan, runtimeContext);
      if (generated && !violatesProtocolSkillBoundary(generated, allowedSkills)) {
        generated.retrieval = retrievalMetadata(retrievalQuery, hits);
        return finish(generated);
      }
      generationStatus = "rejected";
      console.warn("[dbt-model] falling back: generated answer failed schema or grounding verification");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown_model_error";
      generationStatus = "error";
      console.warn(`[dbt-model] falling back: ${reason.slice(0, 120)}`);
    }
  }

  const topSection = hits[0]?.page.section ?? "";
  const verifiedSkill = plan.kind === "direct" && /核对事实/u.test(topSection)
    ? "核对事实"
    : plan.kind === "direct" && /相反行为|问题解决/u.test(message)
      ? message
      : null;
  if (verifiedSkill) {
    const verified = respondFromFrozenEvidence(verifiedSkill);
    // Frozen copy controls wording, but provenance always comes from the
    // current retrieval result. Legacy hand-authored citation IDs are never
    // allowed to bypass the source-exact citation contract.
    verified.citations = hits.slice(0, 4).map(hitToCitation);
    verified.retrieval = retrievalMetadata(retrievalQuery, hits);
    if (generationStatus) {
      verified.generation = { attempted: true, status: generationStatus };
    }
    return finish(verified);
  }

  return finish(buildRetrievalFallback(retrievalQuery, hits, generationStatus, plan));
}
