import rawIndex from "../data/rag/index-v1.json";
import type { ChatPayload, SourceCitation } from "./dbt-content";
import { conversationStarterReplies } from "./conversation-bridge";
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
  "心情不好", "心情不太好", "心情不是很好", "心情有点差", "心情很差", "状态不好", "状态不太好",
  "状态有点差", "不开心", "低落", "郁闷", "孤独", "心里堵", "有点累", "很累",
  "好累", "疲惫", "不知道该怎么说", "不知道怎么说", "说不清", "不知道从哪说起",
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

  if (/^(我)?(现在|也)?(不知道(该)?怎么说|不知道从哪(里)?说起|说不清)[了呀啊呢。！!？?\s]*$/u.test(current)) {
    return {
      kind: "clarify",
      route: "clarify",
      retrievalQuery: current,
      label: "需要确认当前目标",
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
      label: "把想说的话说清楚",
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
      label: "看看这件事是怎么一步步发生的",
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
      label: "面对一时改变不了的事",
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
      label: "把事实和脑中的猜测分开",
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
      label: "情绪很强，先让自己停一下",
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

export function buildClarificationResponse(): ChatPayload {
  return {
    kind: "answer",
    title: "听起来，你今天不太好受",
    message:
      "不用急着把原因讲完整。你可以先选一个最接近的：缓一缓现在的情绪、理清脑中反复出现的想法，或者先说说刚才发生了什么。",
    suggestedReplies: [...conversationStarterReplies],
    citations: [],
    nextAction: "none",
    mode: "bridge",
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
      title: "情绪很强时，先用 STOP 给自己一点停顿",
      message: "你想先稳住自己，可以从 STOP 开始。它不是要求情绪马上消失，也不是现在就解决所有问题，而是先停一下，别让冲动把事情推得更糟。",
      steps: [
        "停止动作：先别立刻照着冲动去做。",
        "退后一步：离开一下，或者慢慢呼吸几次，给自己一点空间。",
        "客观观察：看看身体、情绪和周围正在发生什么。",
        "带着觉察行事：想想你真正想要的结果，再决定下一步。",
      ],
    };
  }

  if (normalizedQuery.includes("dearman") && supports("描述情境", "表达感受", "明确态度", "强化对方", "保持正念", "表现自信", "协商妥协")) {
    return {
      label: "DEAR MAN",
      title: "DEAR MAN 帮你把难开口的话说清楚",
      message: "它适合用在提出请求、拒绝别人或坚持立场时。名字看起来有点复杂，其实就是七个动作：说清发生了什么、表达感受、明确请求、说明好处、别跑题、保持自信、愿意协商。",
      steps: ["先说清你们都能确认的事实。", "说出自己的感受，再明确提出请求或立场。", "说明这样做的好处；如果对话跑偏，就把重点带回来，需要时再协商。"],
    };
  }
  if (normalizedQuery.includes(normalize("痛苦耐受")) && supports("危机生存技能", "接纳现实技能")) {
    return {
      label: "痛苦耐受",
      title: "有些时候，先撑过最难受的那一阵",
      message: "书里把“痛苦耐受”分成两类：一类帮你在情绪最强时先别把事情弄得更糟；另一类帮你面对暂时改变不了的事实。接纳不是认同痛苦，能解决的问题还是要解决。",
      steps: ["如果情绪已经很强，可以先用 STOP、TIP、自我安抚等方法缓下来。", "如果事情暂时改变不了，可以练习全然接纳、转念和“我愿意”。", "先分清：现在更需要安全度过这一刻，还是动手解决一个现实问题。"],
    };
  }
  if (normalizedQuery.includes(normalize("正念")) && supports("观察", "描述", "参与", "不评判", "专一")) {
    return {
      label: "正念",
      title: "正念，就是把注意力带回正在发生的这一刻",
      message: "书里把它分成“做什么”和“怎么做”两组：观察、描述、参与；不评判、一次只做一件事、选择真正有用的做法。",
      steps: ["先留意现在的身体、想法和周围，不急着改变。", "试着用简单的事实语言说出来，然后回到正在做的事。", "少评判，一次专注一件事，选择对当前目标真正有帮助的行动。"],
    };
  }
  const supportsBehaviorChain = evidenceText.includes(normalize("问题行为")) &&
    (evidenceText.includes(normalize("促发事件")) || evidenceText.includes(normalize("诱发事件")));
  if ((normalizedQuery.includes(normalize("行为链")) || normalizedQuery.includes(normalize("链式分析"))) && supportsBehaviorChain) {
    return {
      label: "行为链",
      title: "把整件事倒回去看，找到能改变的那一环",
      message: "行为链会把一次问题行为按时间慢慢拆开：之前身体和生活是什么状态、什么事触发了你、脑中怎么想、身体怎么反应，最后发生了什么。这样才能找到下次可以停下来或换一种做法的地方。",
      steps: ["先选一次具体发生过的行为，不要分析一整类问题。", "按时间写下当时的想法、情绪、身体感觉和动作。", "看看结果怎样，再找出下一次可以停一下或换做法的地方。"],
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
        title: "我大概明白你想处理什么了，还差一点信息",
        message:
          `这可能和“${plan.label}”有关，但我还不想急着替你选方法。再告诉我一点：刚才发生了什么，你现在最想改变的是感受、脑中的想法、接下来的行为，还是沟通结果？`,
        suggestedReplies: [
          "我想先让情绪缓下来",
          "我想看看是不是自己想多了",
          "我想想清楚接下来怎么做或怎么说",
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
      title: "我暂时还没看出该从哪种 DBT 方法开始",
      message:
        "如果这和你的情绪、行为或一段关系有关，可以再告诉我两件事：刚才发生了什么，以及你最想改变什么。其他类型的知识问题，这个体验版暂时回答不了。",
      citations: [],
      suggestedReplies: ["我想换一件最近让我难受的事来说"],
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
    ? `听起来，这件事可能和“${plan.label}”有关。我先把它当作一个尝试方向，你可以看看是否贴合自己。`
    : "";
  const queryLabel = normalizedQuery.includes("dearman")
    ? "DEAR MAN"
    : conceptGroups.find((group) => group.some((concept) => normalizedQuery.includes(normalize(concept))))?.[0]
      ?? "这个问题";
  return {
    kind: "answer",
    title: template?.title ?? `书里有一部分正好讲到“${queryLabel}”`,
    message: `${guidedPrefix}${template?.message ?? "下面是书里和你刚才说的事最接近的部分。你可以先看看哪些说得像自己，不贴合的地方不用勉强套进去。"}`,
    steps: template?.steps ?? [
      "先用一句话写下刚才实际发生了什么，暂时别猜对方的原因。",
      "再想想现在最想改变什么：情绪、下一步行动，还是沟通结果。",
      `可以点开“${top.page.section}”对照原文，再决定要不要继续练这个方法。`,
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
