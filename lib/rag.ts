import rawIndex from "../data/rag/index-v1.json";
import type { ChatPayload, SourceCitation } from "./dbt-content";
import { knowledgeV2 } from "./knowledge-v2";
import { createRetrievalEngine, type EngineRetrievalHit } from "./retrieval/engine";
import { createEvidenceBundle, type EvidenceBundle } from "./retrieval/evidence-bundle";
import type { RetrievalPlan } from "./retrieval/planner";
export { planRetrieval } from "./retrieval/planner";
export type { RetrievalPlan } from "./retrieval/planner";

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
  matchedSkillCardIds?: string[];
  qualityScore?: number;
  parentBlock?: EngineRetrievalHit["parentBlock"];
};

export const ragIndex = rawIndex as RagIndex;
const retrievalEngine = createRetrievalEngine(knowledgeV2);

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

export function buildClarificationResponse(): ChatPayload {
  return {
    kind: "answer",
    title: "先不用急着替你选方法",
    message:
      "你这句话已经足够开始。为了不把某个技能硬套给你，我们先只分清眼前最需要处理的部分。",
    followUpQuestion: "此刻最明显的是身体绷着或坐不住、脑中的想法停不下来，还是很想马上做点什么？",
    suggestedReplies: [
      "身体最明显，想先缓下来",
      "脑中的想法停不下来",
      "我很想马上做点什么",
    ],
    citations: [],
    nextAction: "none",
    mode: "bridge",
  };
}

export function retrieveEvidence(query: string, limit = 6): RetrievalHit[] {
  return retrievalEngine.retrieve(query, limit).map((hit) => ({
    page: {
      id: hit.chunk.id,
      pageId: hit.chunk.pageId,
      sourceId: hit.chunk.sourceId,
      sourceFile: hit.chunk.sourceFile,
      book: hit.chunk.book,
      section: hit.chunk.displaySection,
      pdfPage: hit.chunk.pdfPage,
      printedPage: hit.chunk.printedPage,
      text: hit.chunk.text,
      excerpt: hit.chunk.text,
      ocrScore: hit.chunk.ocrScore,
      renderDpi: 0,
      charStart: hit.chunk.charStart,
      charEnd: hit.chunk.charEnd,
    },
    score: hit.score,
    matchedTerms: hit.matchedTerms,
    matchedSkillCardIds: hit.matchedSkillCardIds,
    qualityScore: hit.qualityScore,
    parentBlock: hit.parentBlock,
  }));
}

/**
 * Quality-first evidence contract for claim-level generation. Existing callers
 * can continue using RetrievalHit; model integrations can migrate to this
 * bundle without changing chunk IDs or citation provenance.
 */
export function buildEvidenceBundle(
  query: string,
  hits: RetrievalHit[],
  maxParentContext = 8,
): EvidenceBundle {
  const engineHits: EngineRetrievalHit[] = [];
  for (const hit of hits) {
    const chunk = knowledgeV2.chunks.find((item) => item.id === hit.page.id);
    if (!chunk) continue;
    engineHits.push({
      chunk,
      score: hit.score,
      matchedTerms: hit.matchedTerms,
      matchedSkillCardIds: hit.matchedSkillCardIds ?? chunk.skillCardIds,
      qualityScore: hit.qualityScore ?? chunk.sourceQuality.score,
      parentBlock: hit.parentBlock,
    });
  }
  return createEvidenceBundle(knowledgeV2, query, engineHits, maxParentContext);
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
    const relationalDistress = includesAny(query, [
      "爱上", "喜欢上", "放不下", "舍不得", "冷淡", "薄情", "忽冷忽热", "不理我",
      "没回应", "感情", "恋爱", "失恋", "暧昧", "伴侣", "对象", "前任", "关系", "相处",
    ]);
    if (relationalDistress) {
      return {
        kind: "answer",
        title: "喜欢上一个让你摸不准的人，确实会很消耗",
        message:
          "先不用逼自己马上决定要不要继续，也不用急着替对方下结论。我们可以先把三件事分开：对方实际做了什么、你因此怎么想和怎么感受、你希望这段关系接下来怎样。这样更容易看清下一步，而不是被反复猜测牵着走。",
        steps: [
          "写下一件最近发生的具体小事，只写双方实际说了什么、做了什么。",
          "再写下你当时的感受，以及脑中最强烈的解释；先把解释当作一种可能，而不是已经确定的事实。",
          "最后问自己：我现在更想确认事实、表达需求，还是先让情绪缓下来？",
        ],
        suggestedReplies: [
          "我想先说一件最近发生的事",
          "我想判断自己是不是一直在猜",
          "我想想清楚要怎么和对方说",
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
      refusalReason: "out-of-scope",
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
  if (plan?.situation === "relationship-attachment") {
    return {
      kind: "answer",
      title: "放不下，不是逼自己说一句“算了”就能做到",
      message:
        "你可以一边舍不得，一边慢慢看清这段关系。先不用要求自己马上忘掉他，也不用因为还在意，就忽略那些让你受伤的事实。现在更重要的是弄清：你舍不得的究竟是什么，以及继续靠近会不会让你越来越委屈自己。",
      steps: [
        "先完成一句：我最舍不得的是这个人、曾经的感觉，还是对未来的期待？",
        "再写一句：即使我舍不得，目前已经能确认的事实是……",
        "想一想：如果好朋友处在同样的关系里，我会希望她守住什么底线？",
        "今天只决定一个小步骤：继续观察、确认一件事，或者先拉开一点距离照顾自己。",
      ],
      suggestedReplies: [
        "我最舍不得的是……",
        "我已经能确认的事实是……",
        "我最怕放下以后会……",
      ],
      citations,
      nextAction: "none",
      mode: "guided",
      generation: generationStatus
        ? { attempted: true, status: generationStatus }
        : undefined,
      retrieval: retrievalMetadata(query, hits),
    };
  }
  if (plan?.situation === "relationship-distress") {
    return {
      kind: "answer",
      title: "喜欢上一个让你反复受伤的人，确实很难一下放下",
      message:
        "你一边在意他，一边又被他的态度弄得难受，这两种感受可以同时存在。先不用逼自己马上离开或继续，也先不把“薄情”当成已经核实的全部事实。更有用的是看清：他实际怎么对待你、这段关系让你付出了什么，以及你真正想要怎样的关系。",
      steps: [
        "选一件最近发生的具体小事，只写他实际说了什么、做了什么。",
        "再写下这件事带给你的感受，以及你脑中对他的解释；把事实和解释暂时分开。",
        "问问自己：我想从这段关系得到什么？我需要守住什么底线，才不会越来越委屈自己？",
        "如果你想和他谈，再把最想确认的一件事或最重要的一个请求说清楚。",
      ],
      suggestedReplies: [
        "我想先说一件他最近做的事",
        "我想看看哪些是事实，哪些是我的猜测",
        "我想想清楚自己的底线",
      ],
      citations,
      nextAction: "none",
      mode: "guided",
      generation: generationStatus
        ? { attempted: true, status: generationStatus }
        : undefined,
      retrieval: retrievalMetadata(query, hits),
    };
  }
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
