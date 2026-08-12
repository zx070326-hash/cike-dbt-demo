import type { ChatPayload, SourceCitation } from "./dbt-content";
import { conversationStarterReplies } from "./conversation-bridge";
import type { RetrievalHit, RetrievalPlan } from "./rag";
import { hitToCitation } from "./rag";

type ModelConfig = {
  provider: "openai-compatible" | "anthropic";
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  verifyGrounding: boolean;
  isDeepSeek: boolean;
};

export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

function readConfig(): ModelConfig | null {
  if (process.env.DEMO_MODEL_MODE?.trim() === "retrieval") return null;
  const apiKey = process.env.MODEL_API_KEY?.trim();
  const model = process.env.MODEL_NAME?.trim();
  if (!apiKey || !model) return null;
  const provider = process.env.MODEL_PROVIDER === "anthropic" ? "anthropic" : "openai-compatible";
  const baseUrl =
    process.env.MODEL_BASE_URL?.replace(/\/$/, "") ||
    (provider === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1");
  const configuredTimeout = Number(process.env.MODEL_TIMEOUT_MS ?? 25_000);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.min(Math.max(configuredTimeout, 5_000), 60_000)
    : 25_000;
  return {
    provider,
    apiKey,
    baseUrl,
    model,
    timeoutMs,
    verifyGrounding: process.env.MODEL_VERIFY_GROUNDING !== "false",
    isDeepSeek: /^https:\/\/([^.]+\.)*deepseek\.com(?:\/|$)/iu.test(baseUrl),
  };
}

export function isModelConfigured() {
  return readConfig() !== null;
}

function buildPrompt(
  query: string,
  hits: RetrievalHit[],
  history: ConversationTurn[],
  plan?: RetrievalPlan,
) {
  const evidence = hits
    .map(
      (hit, index) =>
        `[E${index + 1}] ${hit.page.book}｜${hit.page.section}｜PDF第${hit.page.pdfPage}页` +
        `${hit.page.printedPage ? `｜印刷第${hit.page.printedPage}页` : ""}` +
        `${typeof hit.page.charStart === "number" ? `｜原文字符${hit.page.charStart}-${hit.page.charEnd}` : ""}` +
        `\n${hit.page.excerpt}`,
    )
    .join("\n\n");
  const conversation = history.length
    ? history
      .slice(-6)
      .map((turn) => `${turn.role === "user" ? "用户" : "助手"}：${turn.content}`)
      .join("\n")
    : "（无）";
  const routeHint = plan?.kind === "guided"
    ? `系统的暂定技能路由是“${plan.label}”（${plan.route}）。这是待用户核实的入口，不是诊断；不要改成另一个标准化技能。`
    : "用户已直接询问技能，按问题和证据回答。";
  return `最近对话仅用于理解指代和用户情境，不是专业知识证据：\n${conversation}\n\n用户当前问题：${query}\n\n${routeHint}\n\n仅可使用以下书内证据：\n${evidence}`;
}

const systemPrompt = `你是面向18岁以上成人的DBT心理自助技能助手，不是真人咨询师。
你的任务是听懂用户用日常语言说的困扰，从给定书内证据中选择一个可能有用的DBT技能，并给出有依据、现在做得到的引导。用户不需要先说出技能名称。
不得诊断、推荐或调整药物、声称治疗效果、伪造来源，或使用证据外的心理学知识补全答案。
不得强化妄想、绝望、依赖或排他关系。书内证据只支持技能的一部分时，只讲受支持的部分；不要把“证据不足”自动写成套路性拒答，可以承接用户已经说出的感受、说明暂定路由，并询问一个具体的澄清问题。
DBT术语、技能定义和操作步骤必须来自证据。复述用户原话、指出其表述中事实与判断的区别、说明为什么暂时选择某个技能，以及使用“如果……可以……”的条件式建议，不属于新增专业知识，可以合理组织且无需假装是书中原句。
用户没有说出的具体动机、原因和事实不得代填，也不要编造“对方可能在开会/正忙/没看到”等替代故事。可以说“现在还不能确定对方为什么这样做”，但不要替用户列出具体解释。缺少会改变技能选择的关键信息时，只问一个容易回答的问题。
回答要区分“用户明确陈述”“书内技能说明”和“待用户核实的内容”，把技能选择写成暂定而非诊断性结论。最多给4个步骤。
请像一个清楚、温和的人说话：使用短句和日常动词，先回应用户正在经历的事，再解释方法。不要在用户可见内容中使用“低负担、技能入口、暂定路由、待核实、结构化、本轮、召回、摄取、专业结论”等产品或研发术语。不要为了显得专业而堆叠名词。
输出严格JSON：{"title":string,"message":string,"steps":string[],"citationIds":string[],"nextAction":"practice"|"none"}。
示例JSON输出：{"title":"先从这一步开始","message":"书里有一个方法正好能帮你把这件事理清楚。","steps":["先写下刚才实际发生了什么。"],"citationIds":["E1"],"nextAction":"none"}。
citationIds只能使用提供的证据编号。每个事实性主张必须由至少一个引用支持。不要在回答中提及内部证据编号。`;

const bridgeSystemPrompt = `你是一个面向18岁以上成人的DBT心理自助应用中的“会话承接层”，不是真人咨询师。
用户刚刚用很概括的日常语言表达了情绪或困扰，还没有提供足够信息来选择技能。你的任务不是立刻教学，而是自然承接用户明确说出的感受，并邀请用户使用界面下方的固定入口选择下一步。
严格遵守：
1. 只复述或概括用户已经说出的感受，不猜测原因、经历、动机、疾病或严重程度。
2. 不使用DBT术语、技能名称、心理诊断、药物、疗效承诺或专业解释。
3. 不说“证据不足”“不属于范围”“作为AI”或任何内部系统语言。
4. 不提出问题，不询问持续时间、严重程度或影响；不要在正文中列出选项，系统会另行提供固定入口。
5. 不制造依赖，不说“我永远陪着你”“只有我懂你”等排他性语言。
6. 像一个清楚、温和的人说话，多用短句和日常词。不要使用“此刻、困扰、情境、承接、低负担、入口、方向、专业结论、待核实”等产品或咨询腔词语。结尾可以自然地说“先从下面选一句最接近的就好”。
7. 标题不超过24字，正文不超过120字。
输出严格JSON：{"title":string,"message":string}。`;

function extractJson<T>(value: string) {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned) as T;
}

async function callOpenAiCompatible(
  config: ModelConfig,
  prompt: string,
  instruction = systemPrompt,
  maxTokens = 900,
) {
  const providerOptions = config.isDeepSeek
    ? { thinking: { type: "disabled" } }
    : { temperature: 0.2 };
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      ...providerOptions,
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) throw new Error(`model_http_${response.status}`);
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(
  config: ModelConfig,
  prompt: string,
  instruction = systemPrompt,
  maxTokens = 900,
) {
  const response = await fetch(`${config.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      temperature: 0.2,
      system: instruction,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) throw new Error(`model_http_${response.status}`);
  const body = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  return body.content?.find((item) => item.type === "text")?.text ?? "";
}

async function verifyGrounding(
  config: ModelConfig,
  query: string,
  hits: RetrievalHit[],
  answer: { title: string; message: string; steps: string[] },
) {
  if (!config.verifyGrounding) return true;
  const evidence = hits
    .map((hit, index) => `[E${index + 1}] ${hit.page.excerpt}`)
    .join("\n\n");
  const prompt = `请核验候选回答中的DBT术语、技能定义和操作步骤是否与证据明确一致。允许忠实改写和压缩，不要求逐字相同；允许承接或概括用户明确说出的内容、把技能选择说明为暂定入口、区分事实与判断、使用条件式语言、邀请用户自行填写信息或选择低负担下一步。这些对话桥接语不需要逐字出现在书中。可以说“还存在多种待核对的解释”，但如果回答替用户编造了任何具体动机、具体原因或具体情境事实（如对方在开会、正忙、没看到），必须判为false。存在证据外专业知识、过度推断、诊断、用药或疗效承诺时也判为false。\n\n用户问题：${query}\n\n证据：\n${evidence}\n\n候选回答：\n${JSON.stringify(answer)}\n\n只输出JSON。示例JSON输出：{"supported":true,"unsupportedClaims":[]}`;
  const verificationInstruction = "你是保守的证据核验器。仅判断候选回答是否完全受给定证据支持。只输出JSON：{\"supported\":boolean,\"unsupportedClaims\":string[]}。";
  const raw = config.provider === "anthropic"
    ? await callAnthropic(config, prompt, verificationInstruction, 350)
    : await callOpenAiCompatible(config, prompt, verificationInstruction, 350);
  const parsed = extractJson<{ supported?: unknown; unsupportedClaims?: unknown }>(raw);
  return parsed.supported === true &&
    Array.isArray(parsed.unsupportedClaims) &&
    parsed.unsupportedClaims.length === 0;
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

const bridgeForbiddenPatterns = [
  /\bDBT\b|辩证行为|正念|STOP|TIP|TIPP|DEAR\s*MAN|行为链|核对事实/iu,
  /诊断|确诊|抑郁症|焦虑症|双相|人格障碍|药物|用药|剂量|治疗|疗效|治愈/u,
  /证据不足|不属于.{0,6}范围|作为.{0,4}AI|我永远陪|只有我/u,
  /什么时候开始|影响有多大|持续了多久|严重程度/u,
  /入口|会话承接|低负担|专业结论|待核实/u,
];

export async function generateConversationalBridge(
  query: string,
  history: ConversationTurn[] = [],
): Promise<ChatPayload | null> {
  const config = readConfig();
  if (!config) return null;
  const recentConversation = history.length
    ? history
      .slice(-4)
      .map((turn) => `${turn.role === "user" ? "用户" : "助手"}：${turn.content}`)
      .join("\n")
    : "（无）";
  const prompt = `最近对话只用于理解指代，不得据此推断用户没有说出的事实：\n${recentConversation}\n\n用户当前表达：${query}`;
  const raw = config.provider === "anthropic"
    ? await callAnthropic(config, prompt, bridgeSystemPrompt, 320)
    : await callOpenAiCompatible(config, prompt, bridgeSystemPrompt, 320);
  const parsed = extractJson<{
    title?: unknown;
    message?: unknown;
  }>(raw);
  const title = cleanText(parsed.title, 24);
  const message = cleanText(parsed.message, 120);
  const suggestedReplies = [...conversationStarterReplies];
  const combined = `${title} ${message} ${suggestedReplies.join(" ")}`;
  const questionCount = (message.match(/[？?]/gu) ?? []).length;
  const addsConcreteCause = /(?:因为|可能是|也许是|大概是).{1,24}(?:导致|所以|让你)/u.test(message);
  if (
    !title || !message || questionCount > 0 ||
    addsConcreteCause || bridgeForbiddenPatterns.some((pattern) => pattern.test(combined))
  ) {
    return null;
  }
  return {
    kind: "answer",
    title,
    message,
    suggestedReplies,
    citations: [],
    nextAction: "none",
    mode: "bridge",
    generation: { attempted: true, status: "accepted" },
  };
}

function addsUnstatedScenarioInference(
  query: string,
  answer: { title: string; message: string; steps: string[] },
) {
  if (!/[我俺本人]|领导|同事|伴侣|家人/u.test(query)) return false;
  const combined = `${answer.title} ${answer.message} ${answer.steps.join(" ")}`;
  const concreteDetails = [
    "在开会", "正在开会", "正忙", "正在忙", "没看到", "没有看到", "忘了回复",
    "故意不回", "故意忽视", "针对你", "讨厌你", "不在乎你",
  ];
  const inventedAlternative = /(领导|同事|朋友|家人|伴侣|他|她|对方).{0,6}(可能|也许|或许|大概).{0,8}(忙|开会|没看到|忘了|故意|讨厌|不在乎)/u;
  return concreteDetails.some((detail) => combined.includes(detail) && !query.includes(detail)) ||
    (inventedAlternative.test(combined) && !inventedAlternative.test(query));
}

function passesCoreSkillInvariants(
  userContext: string,
  answer: { title: string; message: string; steps: string[] },
  plan?: RetrievalPlan,
) {
  const response = `${answer.title} ${answer.message} ${answer.steps.join(" ")}`;
  const normalizedQuery = userContext.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
  if (normalizedQuery.includes("stop") || plan?.route === "distress-survival") {
    return [
      /\bSTOP\b/iu,
      /停止|停下来/u,
      /后退一步|退后一步|向后退|后退/u,
      /观察/u,
      /带着觉察行事|正念.{0,8}(继续|行动)|(?:继续|行动).{0,8}正念/u,
    ].every((pattern) => pattern.test(response));
  }
  if (normalizedQuery.includes("dearman") || plan?.route === "interpersonal") {
    return !/六个|6个/u.test(response) && [
      /描述/u, /表达/u, /明确|主张/u, /强化/u, /正念/u, /自信/u, /协商|谈判/u,
    ].every((pattern) => pattern.test(response));
  }
  if (plan?.route === "emotion-facts") {
    return /事实/u.test(response) && /解释|假设|预测|判断/u.test(response) && /核对|证据/u.test(response);
  }
  if (/正念/u.test(userContext)) {
    return [
      /观察/u, /描述/u, /参与/u, /不评判|非评判/u, /专一|一心一意/u, /有效/u,
    ].every((pattern) => pattern.test(response));
  }
  if (/痛苦耐受|痛苦忍受/u.test(userContext)) {
    return /危机生存/u.test(response) && /接纳现实|现实接纳/u.test(response);
  }
  if (/行为链|链式分析|链锁分析/u.test(userContext) || plan?.route === "behavior-chain") {
    return /问题行为/u.test(response) && /促发事件|诱发事件/u.test(response) && /后果/u.test(response);
  }
  return true;
}

export async function generateGroundedAnswer(
  query: string,
  hits: RetrievalHit[],
  history: ConversationTurn[] = [],
  plan?: RetrievalPlan,
): Promise<ChatPayload | null> {
  const config = readConfig();
  if (!config || !hits.length) return null;
  const prompt = buildPrompt(query, hits, history, plan);
  const raw = config.provider === "anthropic"
    ? await callAnthropic(config, prompt)
    : await callOpenAiCompatible(config, prompt);
  const parsed = extractJson<Partial<ChatPayload> & { citationIds?: string[] }>(raw);
  const allowed = new Map<string, SourceCitation>(
    hits.map((hit, index) => [`E${index + 1}`, hitToCitation(hit)]),
  );
  const requested = [...new Set((parsed.citationIds ?? []).filter((id) => allowed.has(id)))];
  const title = cleanText(parsed.title, 80);
  const message = cleanText(parsed.message, 900);
  if (!title || !message || !requested.length) return null;
  const steps = Array.isArray(parsed.steps)
    ? parsed.steps.map((step) => cleanText(step, 180)).filter(Boolean).slice(0, 4)
    : [];
  const visibleCopy = `${title} ${message} ${steps.join(" ")}`;
  if (/低负担|技能入口|暂定路由|待核实|结构化|本轮|召回|摄取|专业结论/u.test(visibleCopy)) return null;
  const userContext = [
    ...history.filter((turn) => turn.role === "user").slice(-3).map((turn) => turn.content),
    query,
  ].join("\n");
  if (addsUnstatedScenarioInference(userContext, { title, message, steps })) return null;
  if (!passesCoreSkillInvariants(userContext, { title, message, steps }, plan)) return null;
  const grounded = await verifyGrounding(config, userContext, hits, { title, message, steps });
  if (!grounded) return null;
  const supportsCheckFactsPractice = /核对事实|核对|事实|解释|假设|焦虑|担心/u.test(userContext);
  return {
    kind: "answer",
    title,
    message,
    steps,
    citations: requested.map((id) => allowed.get(id) as SourceCitation),
    nextAction: parsed.nextAction === "practice" && supportsCheckFactsPractice
      ? "practice"
      : "none",
    mode: "generated",
    generation: { attempted: true, status: "accepted" },
    retrieval: { query, resultCount: hits.length, corpusPages: 0 },
  };
}
