import rawIndex from "../data/rag/index-v1.json";
import type { ChatPayload, SourceCitation } from "./dbt-content";
import {
  knowledgeV2,
  wikiEvidenceBoosts,
  wikiExpansionTerms,
} from "./knowledge-v2";

type RagPage = {
  id: string;
  sourceId: string;
  sourceFile: string;
  book: string;
  section: string;
  pdfPage: number;
  printedPage: number | null;
  text: string;
  excerpt: string;
  ocrScore: number | null;
  renderDpi: number;
  pageId?: string;
  charStart?: number;
  charEnd?: number;
};

type RagIndex = {
  version: string;
  builtAt: string;
  quality: {
    pageCount: number;
    bySource: Record<string, number>;
    averageOcrScore: number | null;
    lowConfidencePageCount: number;
  };
  pages: RagPage[];
};

export type RetrievalHit = {
  page: RagPage;
  score: number;
  matchedTerms: string[];
};

export type RetrievalPlan = {
  kind: "direct" | "guided" | "clarify" | "out-of-scope";
  route:
    | "direct"
    | "emotion-facts"
    | "distress-survival"
    | "acceptance"
    | "interpersonal"
    | "behavior-chain"
    | "clarify"
    | "out-of-scope";
  retrievalQuery: string;
  label: string;
};

export const ragIndex = rawIndex as RagIndex;

export function retrievalMetadata(query: string, hits: RetrievalHit[]) {
  return {
    query,
    resultCount: hits.length,
    corpusPages: ragIndex.quality.pageCount,
    knowledgeVersion: knowledgeV2.schemaVersion,
    evidenceCharacters: hits.reduce((sum, hit) => sum + hit.page.excerpt.length, 0),
  };
}

const conceptGroups = [
  ["核对事实", "核对", "事实", "解释", "假设", "证据", "威胁", "焦虑", "担心", "预测", "没回复", "不回复", "是不是", "一定"],
  ["相反行为", "相反行动", "行动冲动", "改变情绪"],
  ["问题解决", "解决问题", "现实问题"],
  ["正念", "观察", "描述", "参与", "不评判", "一心一意", "有效"],
  ["STOP", "立即停止", "停止动作", "退后一步", "客观观察", "带着觉察行事"],
  ["痛苦耐受", "危机生存", "TIP", "TIPP", "接受现实", "彻底接纳"],
  ["情绪调节", "情绪", "脆弱性", "积累正向情绪", "ABC"],
  ["人际效能", "DEAR MAN", "DEARMAN", "GIVE", "FAST", "拒绝", "请求"],
  ["智慧心", "理性心", "情绪心"],
  ["行为链", "链式分析", "问题行为", "促发事件"],
];

const dbtScopeTerms = new Set(conceptGroups.map((group) => normalize(group[0])));
[
  "DBT", "辩证行为", "技能", "练习", "情绪", "痛苦", "危机", "冲动",
  "接纳", "人际", "关系", "请求", "拒绝", "正念", "行为", "应对",
  "焦虑", "担心", "愤怒", "羞耻", "内疚", "恐惧", "悲伤",
  "促发事件", "智慧心", "全然接纳", "危机生存", "相反行动", "行动冲动", "不评判",
  "假设", "观察", "描述", "参与", "专注",
  "利弊", "转移注意力", "自我安抚", "改善当下",
  "DEAR MAN", "DEARMAN", "GIVE", "FAST", "TIP", "TIPP", "STOP", "PLEASE", "ABC",
].forEach((term) => dbtScopeTerms.add(normalize(term)));

const explicitSkillTerms = [
  "DBT", "辩证行为", "核对事实", "相反行为", "相反行动", "问题解决",
  "正念", "痛苦耐受", "危机生存", "全然接纳", "彻底接纳", "情绪调节",
  "人际效能", "智慧心", "行为链", "链式分析", "链锁分析", "DEAR MAN",
  "DEARMAN", "GIVE", "FAST", "TIP", "TIPP", "STOP", "PLEASE", "ABC",
  "积累正向情绪", "积累正面情绪", "利弊分析", "转移注意力", "自我安抚", "改善当下",
];

const fuzzyPsychologicalTerms = [
  "难受", "烦躁", "崩溃", "压抑", "压力", "紧张", "心慌", "不安", "害怕",
  "焦虑", "担心", "恐惧", "悲伤", "愤怒", "生气", "羞耻", "内疚", "委屈",
  "情绪", "脑子很乱", "冷静不下来", "控制不住", "不知道怎么办", "撑不住",
  "反复想", "胡思乱想", "内耗", "纠结", "放不下", "接受不了", "抗拒",
  "冲动", "后悔", "失控", "吵架", "沟通", "表达", "边界", "关系", "伴侣",
];

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function includesAny(value: string, candidates: string[]) {
  const normalizedValue = normalize(value);
  return candidates.some((candidate) => normalizedValue.includes(normalize(candidate)));
}

/**
 * Maps ordinary, non-technical descriptions to a provisional DBT skill route.
 * This is a retrieval plan, not a diagnosis: when several routes remain equally
 * plausible we ask one small clarification instead of pretending certainty.
 */
export function planRetrieval(query: string, recentUserContext = ""): RetrievalPlan {
  const current = query.trim();
  const context = `${recentUserContext} ${current}`.trim();

  if (includesAny(current, explicitSkillTerms)) {
    return {
      kind: "direct",
      route: "direct",
      retrievalQuery: context,
      label: "用户指定的 DBT 技能",
    };
  }

  if (includesAny(context, [
    "吵架", "冲突", "沟通", "表达", "怎么说", "开口", "边界", "拒绝", "请求",
    "一说话就", "不知道怎么表达", "想处理一段关系",
  ])) {
    return {
      kind: "guided",
      route: "interpersonal",
      retrievalQuery: `${context} 人际效能 DEAR MAN GIVE FAST 请求 拒绝`,
      label: "人际表达与关系目标",
    };
  }

  if (includesAny(context, [
    "冲动后", "冲动了", "总是冲动", "反复做", "一再", "停不下来", "控制不住",
    "失控", "事后后悔", "又后悔", "拖延", "爆发", "问题行为",
  ])) {
    return {
      kind: "guided",
      route: "behavior-chain",
      retrievalQuery: `${context} 行为链 链式分析 脆弱因素 促发事件 问题行为 后果`,
      label: "反复行为的发生过程",
    };
  }

  if (includesAny(context, [
    "无法改变", "改变不了", "已经发生", "挽回不了", "接受不了", "不能接受",
    "不愿接受", "一直抗拒", "放不下", "耿耿于怀",
  ])) {
    return {
      kind: "guided",
      route: "acceptance",
      retrievalQuery: `${context} 痛苦耐受 接纳现实 全然接纳 转念 我愿意`,
      label: "面对暂时无法改变的事实",
    };
  }

  if (includesAny(context, [
    "肯定会", "一定会", "一定是", "是不是", "意味着", "搞砸", "最坏", "预测",
    "反复想", "胡思乱想", "内耗", "纠结", "想不通", "担心", "焦虑", "紧张",
  ])) {
    return {
      kind: "guided",
      route: "emotion-facts",
      retrievalQuery: `${context} 核对事实 情绪 解释 假设 证据 威胁 预测`,
      label: "情绪、解释与事实核对",
    };
  }

  if (includesAny(context, [
    "情绪很强", "先稳定", "冷静不下来", "快要崩溃", "情绪爆炸", "压倒",
    "脑子很乱", "喘不过气", "当下太难熬", "先撑过去",
  ])) {
    return {
      kind: "guided",
      route: "distress-survival",
      retrievalQuery: `${context} 痛苦耐受 危机生存 STOP 立即停止 停止动作 退后一步 客观观察 带着觉察行事`,
      label: "先暂停，避免冲动让情境变得更糟",
    };
  }

  if (includesAny(current, fuzzyPsychologicalTerms)) {
    return {
      kind: "clarify",
      route: "clarify",
      retrievalQuery: current,
      label: "需要确认当前目标",
    };
  }

  return {
    kind: "out-of-scope",
    route: "out-of-scope",
    retrievalQuery: current,
    label: "当前 DBT 自助范围之外",
  };
}

export function buildClarificationResponse(query: string): ChatPayload {
  return {
    kind: "answer",
    title: "不用先知道技能名，我们先确定你最需要哪类帮助",
    message:
      "我能听出你现在并不好受，但仅凭这句话还不能可靠判断该先稳定情绪、核对反复想法，还是处理一段关系。这里不把“信息不够”当成拒答；你选一个最接近的方向，我再从书中找对应方法。",
    steps: [
      "如果当下强度很高，先选“先帮我稳定下来”。",
      "如果脑中有反复出现的判断或预测，选“帮我理清想法”。",
      "如果困扰主要发生在人际互动里，选“帮我组织怎么表达”。",
    ],
    suggestedReplies: [
      "我现在情绪很强，先帮我稳定下来",
      "我想理清脑中反复出现的想法",
      "我想处理一段关系，帮我组织怎么表达",
    ],
    citations: [],
    nextAction: "none",
    mode: "guided",
    retrieval: retrievalMetadata(query, []),
  };
}

const stopBigrams = new Set([
  "什么", "怎么", "如何", "哪些", "是否", "可以", "应该", "请问", "解释",
  "中的", "一个", "这个", "那个", "请解", "一下", "今天", "天天", "天气",
  "气怎", "么样", "量子", "子色", "色动", "动力", "力学", "渐近", "近自", "自由",
]);

function lexicalTokens(value: string) {
  const normalized = normalize(value);
  const tokens = new Set<string>();
  for (const token of value.toLowerCase().match(/[a-z][a-z0-9-]{1,}/gu) ?? []) {
    tokens.add(normalize(token));
  }
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const token = normalized.slice(index, index + 2);
    if (!stopBigrams.has(token)) tokens.add(token);
  }
  return [...tokens];
}

// Retrieval runs over source-exact V2 chunks. Unlike the V1 `excerpt`, each
// chunk contains the complete OCR character range recorded in its provenance.
const searchablePages = knowledgeV2.chunks.map((chunk) => {
  const page: RagPage = {
    id: chunk.id,
    pageId: chunk.pageId,
    sourceId: chunk.sourceId,
    sourceFile: chunk.sourceFile,
    book: chunk.book,
    section: chunk.section,
    pdfPage: chunk.pdfPage,
    printedPage: chunk.printedPage,
    text: chunk.text,
    excerpt: chunk.text,
    ocrScore: chunk.ocrScore,
    renderDpi: 0,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
  };
  const normalizedText = normalize(page.text);
  const normalizedTitle = normalize(page.section);
  return {
    page,
    normalizedText,
    normalizedTitle,
    documentLength: Math.max(normalizedText.length / 2, 1),
    lexicalTerms: lexicalTokens(`${page.section}\n${page.text}`),
  };
});

const documentFrequency = new Map<string, number>();
for (const page of searchablePages) {
  for (const term of page.lexicalTerms) {
    documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
}
const averageDocumentLength = searchablePages.reduce(
  (sum, page) => sum + page.documentLength,
  0,
) / Math.max(searchablePages.length, 1);

function terms(value: string) {
  const normalized = normalize(value);
  const result = new Set<string>();
  for (const group of conceptGroups) {
    if (group.some((concept) => normalized.includes(normalize(concept)))) {
      for (const concept of group) {
        const normalizedConcept = normalize(concept);
        if (normalized.includes(normalizedConcept) || concept.length >= 4) {
          result.add(normalizedConcept);
        }
      }
    }
  }
  for (const token of value.toLowerCase().match(/[a-z][a-z0-9-]{1,}|[\p{Script=Han}]{2,}/gu) ?? []) {
    const normalizedToken = normalize(token);
    if (normalizedToken.length >= 4 && conceptGroups.some((group) => group.some(
      (concept) => normalizedToken.includes(normalize(concept)),
    ))) continue;
    result.add(normalizedToken);
  }
  for (const term of wikiExpansionTerms(value)) {
    result.add(normalize(term));
  }
  for (let index = 0; index < normalized.length - 1; index += 1) {
    result.add(normalized.slice(index, index + 2));
  }
  return [...result].filter((term) => term.length > 1 && !stopBigrams.has(term));
}

function occurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while ((cursor = haystack.indexOf(needle, cursor)) !== -1) {
    count += 1;
    cursor += needle.length;
  }
  return count;
}

export function retrieveEvidence(query: string, limit = 6): RetrievalHit[] {
  const queryTerms = terms(query);
  const bm25Terms = lexicalTokens(query);
  const normalizedQuery = normalize(query);
  const activeGroups = conceptGroups.filter((group) =>
    group.some((concept) => normalizedQuery.includes(normalize(concept))),
  );
  const hasScopeAnchor = [...dbtScopeTerms].some((term) => normalizedQuery.includes(term));
  const wikiTerms = wikiExpansionTerms(query);
  if (!hasScopeAnchor && !wikiTerms.length) return [];
  if (!queryTerms.length) return [];
  const wikiBoosts = wikiEvidenceBoosts(query);

  const scored = searchablePages.map(({ page, normalizedText, normalizedTitle, documentLength }) => {
    const matchedTerms: string[] = [];
    let score = wikiBoosts.get(page.id) ?? 0;

    for (const group of activeGroups) {
      const canonical = normalize(group[0]);
      if (normalizedTitle.includes(canonical)) score += 60;
      if (normalizedText.includes(canonical)) score += 24;
      if (canonical === normalize("正念")) {
        if (normalizedTitle.includes(normalize("正念讲义4"))) score += 90;
        if (normalizedTitle.includes(normalize("正念讲义5"))) score += 70;
      }
      for (const concept of group.slice(1)) {
        const normalizedConcept = normalize(concept);
        if (!normalizedQuery.includes(normalizedConcept)) continue;
        if (normalizedTitle.includes(normalizedConcept)) score += 18;
        if (normalizedText.includes(normalizedConcept)) score += 6;
      }
    }

    for (const term of queryTerms) {
      const textCount = Math.min(occurrences(normalizedText, term), 6);
      const titleCount = occurrences(normalizedTitle, term);
      if (textCount || titleCount) matchedTerms.push(term);
      const lengthWeight = Math.min(term.length, 8) / 2;
      score += textCount * lengthWeight;
      score += titleCount * lengthWeight * 4;
    }
    for (const term of bm25Terms) {
      const textFrequency = Math.min(occurrences(normalizedText, term), 8);
      const titleFrequency = Math.min(occurrences(normalizedTitle, term), 3);
      const frequency = textFrequency + titleFrequency * 3;
      if (!frequency) continue;
      const frequencyInCorpus = documentFrequency.get(term) ?? 0;
      const inverseDocumentFrequency = Math.log(
        1 + (searchablePages.length - frequencyInCorpus + 0.5) / (frequencyInCorpus + 0.5),
      );
      const lengthNormalization = 1.2 * (
        0.25 + 0.75 * (documentLength / averageDocumentLength)
      );
      score += inverseDocumentFrequency * ((frequency * 2.2) / (frequency + lengthNormalization)) * 2.5;
    }
    if (normalizedQuery.length >= 4 && normalizedText.includes(normalizedQuery)) score += 18;
    // Front-matter contents pages often contain every skill name but not the
    // definition or instructions. They remain searchable as discovery aids,
    // while substantive pages should win grounding retrieval.
    if (page.printedPage === null && page.pdfPage <= 20) score *= 0.18;
    if (page.ocrScore !== null && page.ocrScore < 0.75) score *= 0.72;
    return { page, score: Math.round(score * 100) / 100, matchedTerms };
  });

  const ranked = scored
    .filter((item) => item.score >= 1.5)
    .sort((left, right) => right.score - left.score || left.page.pdfPage - right.page.pdfPage);

  if (!ranked.length || ranked[0].matchedTerms.length < 1) return [];

  // Avoid returning adjacent duplicates unless the second page adds a strong match.
  const selected: RetrievalHit[] = [];
  for (const hit of ranked.slice(0, Math.max(limit * 8, 24))) {
    const duplicateNeighborhood = selected.some(
      (current) =>
        current.page.sourceId === hit.page.sourceId &&
        Math.abs(current.page.pdfPage - hit.page.pdfPage) <= 1,
    );
    if (!duplicateNeighborhood || hit.score >= ranked[0].score * 0.72) selected.push(hit);
    if (selected.length >= Math.min(limit, 6)) break;
  }
  return selected;
}

export function hitToCitation(hit: RetrievalHit): SourceCitation {
  return {
    id: `rag-${hit.page.id}`,
    sourceId: hit.page.sourceId,
    book: hit.page.book,
    section: hit.page.section,
    printedPage: hit.page.printedPage,
    pdfPage: hit.page.pdfPage,
    evidence: hit.page.excerpt,
    ocrScore: hit.page.ocrScore,
    chunkId: hit.page.id,
    charStart: hit.page.charStart,
    charEnd: hit.page.charEnd,
  };
}

type GroundedTemplate = {
  label: string;
  title: string;
  message: string;
  steps: string[];
  nextAction?: "practice" | "none";
};

function groundedTemplate(query: string, hits: RetrievalHit[]): GroundedTemplate | null {
  const normalizedQuery = normalize(query);
  const neighborhoodIds = new Set<string>();
  for (const hit of hits) {
    for (const page of ragIndex.pages) {
      if (page.sourceId === hit.page.sourceId && Math.abs(page.pdfPage - hit.page.pdfPage) <= 3) {
        neighborhoodIds.add(page.id);
      }
    }
  }
  const evidenceText = normalize(ragIndex.pages
    .filter((page) => neighborhoodIds.has(page.id))
    .map((page) => page.text)
    .join("\n"));
  const supports = (...phrases: string[]) => phrases.every((phrase) => evidenceText.includes(normalize(phrase)));

  if (normalizedQuery.includes("stop") && supports("停止动作", "退后一步", "客观观察", "带着觉察行事")) {
    return {
      label: "STOP",
      title: "先用 STOP 暂停，不让强烈情绪立刻带着你行动",
      message: "你说想先稳定下来。这里先把 STOP 作为一个低负担入口：它的目标不是立刻解决全部问题或强迫情绪消失，而是在强烈情绪下暂停冲动，避免让情境变得更糟。",
      steps: [
        "停止动作：先不要立即按照冲动反应。",
        "退后一步：从当下抽离片刻，给自己一点空间。",
        "客观观察：留意内在和外在正在发生什么。",
        "带着觉察行事：结合事实、目标和有效性，再选择下一步。",
      ],
    };
  }

  if (normalizedQuery.includes("dearman") && supports("描述情境", "表达感受", "明确态度", "强化对方", "保持正念", "表现自信", "协商妥协")) {
    return {
      label: "DEAR MAN",
      title: "DEAR MAN 是一套实现人际目标的表达步骤",
      message: "书中把它用于提出请求、拒绝、坚持立场或完成其他人际目标。名称对应七个动作：描述情境、表达感受、明确态度、强化对方、保持正念、表现自信、协商妥协。",
      steps: ["先描述可观察的情境。", "表达感受并明确提出请求或立场。", "说明积极结果，保持专注、自信，并在必要时协商。"],
    };
  }
  if (normalizedQuery.includes(normalize("痛苦耐受")) && supports("危机生存技能", "接纳现实技能")) {
    return {
      label: "痛苦耐受",
      title: "痛苦耐受包含危机生存与接纳现实两组技能",
      message: "书中把痛苦耐受分成两类：危机中先避免让事情恶化的生存技能，以及面对暂时无法改变事实时的接纳现实技能。它不是要认同痛苦，也不替代解决可以改变的问题。",
      steps: ["危机生存：如 STOP、利弊分析、TIP、转移注意力、自我安抚和改善当下。", "接纳现实：如全然接纳、转念、我愿意、浅笑与愿意的手势。", "先判断现在是需要安全度过危机，还是处理一个能够改变的现实问题。"],
    };
  }
  if (normalizedQuery.includes(normalize("正念")) && supports("观察", "描述", "参与", "不评判", "专一")) {
    return {
      label: "正念",
      title: "DBT 正念由三个“是什么”和三个“怎样做”技能组成",
      message: "书中列出的“是什么”技能是观察、描述、参与；“怎样做”技能是不评判、专一地做、有效地做。重点是觉察当下，并选择符合当前目标的做法。",
      steps: ["观察：留意当下经验。", "描述和参与：用事实语言命名，并投入正在做的事。", "练习不评判、一次专注一件事，并选择有效行动。"],
    };
  }
  const supportsBehaviorChain = evidenceText.includes(normalize("问题行为")) &&
    (evidenceText.includes(normalize("促发事件")) || evidenceText.includes(normalize("诱发事件")));
  if ((normalizedQuery.includes(normalize("行为链")) || normalizedQuery.includes(normalize("链式分析"))) && supportsBehaviorChain) {
    return {
      label: "行为链",
      title: "行为链分析用来还原问题行为如何一步步发生",
      message: "它从易感因素和诱发事件开始，沿着想法、情绪、身体感觉和行动冲动追踪到问题行为及其后果，再寻找可以插入技能的环节。",
      steps: ["先确定一次具体的问题行为和诱发事件。", "按时间顺序写下中间的想法、感受、身体感觉与行动。", "检查后果，并找出可以使用替代技能的连接点。"],
    };
  }
  return null;
}

export function buildRetrievalFallback(
  query: string,
  hits: RetrievalHit[],
  generationStatus?: "rejected" | "error",
  plan?: RetrievalPlan,
): ChatPayload {
  const citations = hits.map(hitToCitation);
  if (!hits.length) {
    if (plan?.kind === "guided") {
      return {
        kind: "answer",
        title: `我先把它理解为“${plan.label}”，但需要再确认一步`,
        message:
          "这个方向可能与 DBT 技能有关，但当前检索没有稳定返回可引用的对应页。为了不硬套技能，你可以补充下面这个关键信息，我会据此重新检索，而不是用固定的“书中没有”结束对话。",
        steps: ["请用一句话描述：刚才发生了什么，以及你此刻最想改变的是情绪、想法、行为还是沟通结果。"],
        suggestedReplies: [
          "我最想先降低情绪强度",
          "我最想弄清脑中的想法是否符合事实",
          "我最想改变接下来要做的行为或表达",
        ],
        citations: [],
        nextAction: "none",
        mode: "guided",
        generation: generationStatus
          ? { attempted: true, status: generationStatus }
          : undefined,
        retrieval: retrievalMetadata(query, []),
      };
    }
    return {
      kind: "refusal",
      title: "这个问题暂时不属于当前 DBT 自助范围",
      message:
        "从当前表述中看不出可以可靠连接到 DBT 技能的情绪、行为或人际目标。你不必知道技能名称；如果这是一个现实困扰，可以补充“发生了什么”和“你最想改变什么”，我会重新判断。其他领域的知识问答不在这个 Demo 的范围内。",
      citations: [],
      suggestedReplies: ["我想换成一个具体的情绪或人际困扰"],
      nextAction: "none",
      mode: "retrieval",
      retrieval: retrievalMetadata(query, []),
    };
  }

  const top = hits[0];
  const normalizedQuery = normalize(query);
  const templateQuery = plan?.kind === "guided" ? plan.retrievalQuery : query;
  const template = groundedTemplate(templateQuery, hits);
  const guidedPrefix = plan?.kind === "guided"
    ? `根据你描述的情境，我先把“${plan.label}”作为一个待核实的技能入口，而不是对你下结论。`
    : "";
  const queryLabel = normalizedQuery.includes("dearman")
    ? "DEAR MAN"
    : conceptGroups.find((group) => group.some((concept) => normalizedQuery.includes(normalize(concept))))?.[0]
      ?? "这个问题";
  return {
    kind: "answer",
    title: template?.title ?? `找到与“${queryLabel}”相关的书内证据`,
    message: `${guidedPrefix}${template?.message ?? "下面先给出与当前情境最接近的书内依据。这个技能方向只是一个入口；你可以对照自己的实际情况，保留贴合的部分。"}`,
    steps: template?.steps ?? [
      "先用一句可观察的话写下刚才发生了什么，不解释他人的动机。",
      "再选一个当前最想改变的目标：情绪强度、下一步行为，或沟通结果。",
      `对照来源“${top.page.section}”，确认这个技能是否贴合，再继续询问具体步骤。`,
    ],
    citations,
    nextAction: template?.nextAction ?? (plan?.route === "emotion-facts" || /核对事实|解释|假设|证据/u.test(query) ? "practice" : "none"),
    mode: plan?.kind === "guided" ? "guided" : "retrieval",
    generation: generationStatus
      ? { attempted: true, status: generationStatus }
      : undefined,
    retrieval: retrievalMetadata(query, hits),
  };
}
