export type SemanticRiskResult = {
  triggered: boolean;
  level: "none" | "suspected" | "high" | "imminent";
  confidence: number;
  reasonCodes: string[];
  model: string;
  latencyMs: number;
  status: "classified" | "unavailable" | "invalid";
};

type SemanticRiskConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

type RuntimeModelEnv = {
  RISK_MODEL_API_KEY?: string;
  RISK_MODEL_NAME?: string;
  RISK_MODEL_BASE_URL?: string;
  RISK_MODEL_TIMEOUT_MS?: string;
  MODEL_API_KEY?: string;
  MODEL_NAME?: string;
  MODEL_BASE_URL?: string;
  NSSI_SEMANTIC_RISK_MODE?: string;
};

const runtimeGlobal = globalThis as typeof globalThis & { __NSSI_RUNTIME_ENV__?: RuntimeModelEnv };

function config(): SemanticRiskConfig | null {
  const bound = runtimeGlobal.__NSSI_RUNTIME_ENV__ ?? {};
  const apiKey = bound.RISK_MODEL_API_KEY?.trim() || process.env.RISK_MODEL_API_KEY?.trim() || bound.MODEL_API_KEY?.trim() || process.env.MODEL_API_KEY?.trim();
  const model = bound.RISK_MODEL_NAME?.trim() || process.env.RISK_MODEL_NAME?.trim() || bound.MODEL_NAME?.trim() || process.env.MODEL_NAME?.trim();
  const mode = bound.NSSI_SEMANTIC_RISK_MODE ?? process.env.NSSI_SEMANTIC_RISK_MODE;
  if (!apiKey || !model || mode === "disabled") return null;
  const timeout = Number(bound.RISK_MODEL_TIMEOUT_MS ?? process.env.RISK_MODEL_TIMEOUT_MS ?? 1800);
  return {
    apiKey,
    model,
    baseUrl: (bound.RISK_MODEL_BASE_URL || process.env.RISK_MODEL_BASE_URL || bound.MODEL_BASE_URL || process.env.MODEL_BASE_URL || "https://api.openai.com/v1").replace(/\/$/u, ""),
    timeoutMs: Number.isFinite(timeout) ? Math.min(Math.max(timeout, 800), 3500) : 1800,
  };
}

const classifierInstruction = `你是一个独立的中文安全分流分类器。你不参与普通对话，也不生成安慰、建议、技能、诊断或解释。
只根据用户当前这一条消息判断是否存在需要立即切换到现实世界安全支持界面的信号。不得因为一般难过、焦虑、失眠、关系受挫或普通情绪词自动升级。
分类：none=没有相关安全信号；suspected=含蓄或不确定的自伤、自杀、伤人或无法保证安全信号；high=明确表达相关念头、近期行为或明显失控风险；imminent=已经准备、正在发生或危险迫近。
输出严格JSON：{"level":"none"|"suspected"|"high"|"imminent","confidence":0到1,"reasonCodes":string[]}。reasonCodes只能使用：SELF_SAFETY、OTHER_SAFETY、IMMINENT_ACTION、RECENT_BEHAVIOR、AMBIGUOUS_SIGNAL。不要复述用户原文。`;

function empty(status: SemanticRiskResult["status"], model = "not-configured", latencyMs = 0): SemanticRiskResult {
  return { triggered: false, level: "none", confidence: 0, reasonCodes: [], model, latencyMs, status };
}

/**
 * Physically separate model call. Its output is never appended to chat history
 * and can only add a safety trigger; the deterministic classifier remains the
 * first safety layer and cannot be vetoed here.
 */
export async function classifySemanticRisk(message: string, timeoutCapMs?: number): Promise<SemanticRiskResult> {
  const settings = config();
  if (!settings) return empty("unavailable");
  const timeoutMs = timeoutCapMs ? Math.min(settings.timeoutMs, Math.max(500, timeoutCapMs)) : settings.timeoutMs;
  const startedAt = performance.now();
  try {
    const deepSeek = /^https:\/\/([^.]+\.)*deepseek\.com(?:\/|$)/iu.test(settings.baseUrl);
    const response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 180,
        ...(deepSeek ? { thinking: { type: "disabled" } } : { temperature: 0 }),
        messages: [
          { role: "system", content: classifierInstruction },
          { role: "user", content: message.slice(0, 1000) },
        ],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return empty("unavailable", settings.model, Math.round(performance.now() - startedAt));
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = body.choices?.[0]?.message?.content?.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "") ?? "";
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const allowedLevels = new Set(["none", "suspected", "high", "imminent"]);
    const level = allowedLevels.has(String(parsed.level)) ? String(parsed.level) as SemanticRiskResult["level"] : "none";
    const confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0));
    const reasonCodes = Array.isArray(parsed.reasonCodes)
      ? parsed.reasonCodes.filter((item): item is string => typeof item === "string").slice(0, 4)
      : [];
    if (level !== "none" && confidence < 0.58) return empty("invalid", settings.model, Math.round(performance.now() - startedAt));
    return {
      triggered: level !== "none",
      level,
      confidence,
      reasonCodes,
      model: settings.model,
      latencyMs: Math.round(performance.now() - startedAt),
      status: "classified",
    };
  } catch {
    return empty("unavailable", settings.model, Math.round(performance.now() - startedAt));
  }
}
