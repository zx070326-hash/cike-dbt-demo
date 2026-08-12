import {
  getContextualSafetyResponse,
  respondFromFrozenEvidence,
  type ChatPayload,
} from "../dbt-content";
import { getSimpleConversationResponse } from "../conversation-bridge";
import {
  buildClarificationResponse,
  buildRetrievalFallback,
  planRetrieval,
  retrievalMetadata,
  retrieveEvidence,
} from "../rag";
import {
  type ConversationTurn,
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

/**
 * Application-level orchestration. Transport, UI, model provider and source
 * storage stay outside this function so safety ordering can be tested as a
 * product invariant rather than being hidden inside an HTTP handler.
 */
export async function runAssistantTurn(
  message: string,
  history: ConversationTurn[] = [],
): Promise<ChatPayload> {
  const recentUserMessages = history
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content);

  // Invariant 1: deterministic crisis and clinical boundaries run before any
  // retrieval or model call.
  const safetyResponse = getContextualSafetyResponse(message, recentUserMessages);
  if (safetyResponse) return safetyResponse;

  const simpleConversation = getSimpleConversationResponse(message);
  if (simpleConversation) return simpleConversation;

  const previousUserMessage = [...recentUserMessages].reverse()[0];
  const recentUserContext = recentUserMessages.slice(-2).join(" ");
  const isFollowup = /(^那|然后|接下来|下一步|怎么办|怎么做|继续|这个|刚才|呢[？?]?$)/u.test(message);
  const contextualQuery = previousUserMessage && (message.length <= 40 || isFollowup)
    ? `${recentUserContext} ${message}`
    : message;
  const plan = planRetrieval(message, recentUserContext);
  if (plan.kind === "clarify") {
    let bridgeStatus: "rejected" | "error" | undefined;
    if (isModelConfigured()) {
      try {
        const generatedBridge = await generateConversationalBridge(message, history);
        if (generatedBridge) return generatedBridge;
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
    return fallback;
  }

  const retrievalQuery = plan.kind === "direct" ? contextualQuery : plan.retrievalQuery;
  const hits = retrieveEvidence(retrievalQuery);
  const generatedAttempted = isModelConfigured() && hits.length > 0;
  let generationStatus: "rejected" | "error" | undefined;

  if (generatedAttempted) {
    try {
      const generated = await generateGroundedAnswer(message, hits, history, plan);
      if (generated) {
        generated.retrieval = retrievalMetadata(retrievalQuery, hits);
        return generated;
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
    verified.retrieval = retrievalMetadata(retrievalQuery, hits);
    if (generationStatus) {
      verified.generation = { attempted: true, status: generationStatus };
    }
    return verified;
  }

  return buildRetrievalFallback(retrievalQuery, hits, generationStatus, plan);
}
