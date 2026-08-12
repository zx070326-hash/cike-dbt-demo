export type SourceCitation = {
  id: string;
  book: string;
  section: string;
  printedPage: number | null;
  pdfPage: number;
  image?: string;
  evidence: string;
  sourceId?: string;
  ocrScore?: number | null;
  chunkId?: string;
  charStart?: number;
  charEnd?: number;
};

export const sourceCitations: Record<string, SourceCitation> = {
  trainerOverview: {
    id: "trainer-overview",
    book: "《DBT情绪调节手册（上）：标准技能训练手册》",
    section: "第九章第八节：核对事实——教学要点",
    printedPage: 544,
    pdfPage: 567,
    image: "/sources/dbt-upper-567.jpg",
    evidence:
      "教学说明建议把讲义与练习单配合使用，并在练习前后记录情绪强度。",
  },
  trainerEvent: {
    id: "trainer-event",
    book: "《DBT情绪调节手册（上）：标准技能训练手册》",
    section: "第九章第八节：描述诱发事件与解释",
    printedPage: 549,
    pdfPage: 572,
    image: "/sources/dbt-upper-572.jpg",
    evidence:
      "教学说明强调用感官可观察事实描述事件，并识别判断、绝对化语言和附加解释。",
  },
  overview: {
    id: "overview",
    book: "《DBT情绪调节手册（下）：讲义与练习单》",
    section: "情绪调节讲义7：概论——改变情绪反应",
    printedPage: 202,
    pdfPage: 223,
    image: "/sources/dbt-lower-223.jpg",
    evidence:
      "改变情绪反应可以从核对事实、相反行为和问题解决三个方向展开。",
  },
  checkFacts: {
    id: "check-facts",
    book: "《DBT情绪调节手册（下）：讲义与练习单》",
    section: "情绪调节讲义8：核对事实",
    printedPage: 203,
    pdfPage: 224,
    image: "/sources/dbt-lower-224.jpg",
    evidence:
      "核对事实要求区分事件本身、对事件的解释和由此产生的情绪反应。",
  },
  fittingEmotion: {
    id: "fitting-emotion",
    book: "《DBT情绪调节手册（下）：讲义与练习单》",
    section: "情绪调节讲义8a：符合事实的情绪范例",
    printedPage: 204,
    pdfPage: 225,
    image: "/sources/dbt-lower-225.jpg",
    evidence:
      "判断情绪是否符合事实，需要考虑结果发生的可能性、严重性以及情绪在当下的作用。",
  },
  worksheetOne: {
    id: "worksheet-one",
    book: "《DBT情绪调节手册（下）：讲义与练习单》",
    section: "情绪调节练习单5：核对事实（第1页）",
    printedPage: 256,
    pdfPage: 277,
    image: "/sources/dbt-lower-277.jpg",
    evidence:
      "练习从命名情绪、描述诱发事件和识别解释与假设开始。",
  },
  worksheetTwo: {
    id: "worksheet-two",
    book: "《DBT情绪调节手册（下）：讲义与练习单》",
    section: "情绪调节练习单5：核对事实（第2页）",
    printedPage: 257,
    pdfPage: 278,
    image: "/sources/dbt-lower-278.jpg",
    evidence:
      "练习继续检查威胁和最坏结果，并评估情绪强度是否与事实相符。",
  },
};

export type ChatPayload = {
  kind: "answer" | "refusal" | "crisis";
  title: string;
  message: string;
  steps?: string[];
  suggestedReplies?: string[];
  citationIds?: string[];
  citations?: SourceCitation[];
  nextAction?: "practice" | "none";
  mode?: "safety" | "bridge" | "verified" | "retrieval" | "guided" | "generated";
  generation?: {
    attempted: boolean;
    status: "accepted" | "rejected" | "error";
  };
  retrieval?: {
    query: string;
    resultCount: number;
    corpusPages: number;
    knowledgeVersion?: string;
    evidenceCharacters?: number;
  };
};

export const crisisPatterns = [
  /自杀/u,
  /想死/u,
  /不想活/u,
  /活着.{0,4}(没意思|没意义|没有意义|太累)/u,
  /不如.{0,3}死/u,
  /一了百了/u,
  /永远.{0,3}(睡着|消失)/u,
  /结束.{0,4}(生命|自己)/u,
  /伤害自己/u,
  /自伤/u,
  /自残/u,
  /割腕/u,
  /割伤自己/u,
  /跳楼/u,
  /从.{0,4}(楼|高处).{0,4}跳/u,
  /跳下去/u,
  /跳桥/u,
  /跳河/u,
  /上吊/u,
  /烧炭/u,
  /服药自尽/u,
  /(吞|吃).{0,4}(很多|大量|一整瓶).{0,3}药/u,
  /杀了自己/u,
  /(杀了|杀掉|弄死).{0,4}(他|她|别人|家人|他们)/u,
  /伤害.{0,3}(别人|他人|家人)/u,
];

export const clinicalBoundaryPatterns = [
  /诊断/u,
  /确诊/u,
  /什么病/u,
  /(我|本人).{0,5}(是不是|是否|像不像|得了|患有).{0,6}(抑郁|焦虑|双相|躁郁|边缘|精神|人格)/u,
  /(确认|判断).{0,6}(抑郁|焦虑|双相|躁郁|边缘|人格|疾病)/u,
  /吃什么药/u,
  /停药/u,
  /减药/u,
  /加药/u,
  /换药/u,
  /断药/u,
  /药量/u,
  /剂量/u,
  /漏服/u,
  /(服|吃).{0,3}药.{0,12}(停|减|加|换)/u,
  /(多吃|少吃).{0,3}药/u,
  /药.{0,5}(多吃|少吃)/u,
  /处方/u,
];

export function respondFromFrozenEvidence(input: string): ChatPayload {
  const message = input.trim();

  if (crisisPatterns.some((pattern) => pattern.test(message))) {
    return {
      kind: "crisis",
      title: "先确保你此刻的安全",
      message:
        "我不能用普通的技能练习处理正在发生的生命安全风险。如果你已经采取行动、持有可伤害自己或他人的物品，或觉得自己可能马上行动，请立即与危险物品和可能被伤害的人拉开距离，联系身边可信任的人陪着你，并拨打 120 或 110。你也可以拨打 12356 全国统一心理援助热线。",
      steps: [
        "先远离可能伤害自己或他人的物品、地点或情境。",
        "联系一位能够现在陪伴你的人，不要独自承受。",
        "如有迫在眉睫的危险，立即拨打 120 或 110。",
      ],
      nextAction: "none",
      mode: "safety",
    };
  }

  if (clinicalBoundaryPatterns.some((pattern) => pattern.test(message))) {
    return {
      kind: "refusal",
      title: "这个问题超出 Demo 边界",
      message:
        "我可以帮助你学习 DBT 技能，但不能进行疾病诊断、判断你是否患病，也不能提供开始、停止或调整药物的建议。请把诊断和用药问题交给有资质的专业人员。",
      nextAction: "none",
      mode: "safety",
    };
  }

  if (/相反行为|问题解决/u.test(message)) {
    return {
      kind: "answer",
      title: "先判断情绪是否符合事实",
      message:
        "在选择相反行为或问题解决之前，先核对当前情绪是否符合事实。如果情绪或行为冲动不符合事实，可以考虑相反行为；如果事实本身构成可以改变的问题，则更适合问题解决。",
      steps: [
        "描述发生了什么，不加入推测。",
        "判断当前情绪及强度是否符合事实。",
        "再决定保持情绪、采用相反行为，还是解决现实问题。",
      ],
      citationIds: ["overview", "trainerOverview", "checkFacts"],
      nextAction: "practice",
      mode: "verified",
    };
  }

  if (/核对|事实|解释|假设|焦虑|担心|领导|消息|情绪/u.test(message)) {
    return {
      kind: "answer",
      title: "把事实和解释暂时分开",
      message:
        "“核对事实”不是要否定你的感受，而是先检查：真正发生了什么、你对它作了什么解释，以及情绪强度是否与目前能够确认的事实相符。你可以从一个具体事件开始。",
      steps: [
        "只写摄像机能够记录到的事件。",
        "写下脑中出现的解释、假设或预测。",
        "列出支持和不支持这些解释的事实。",
        "评估最坏结果的可能性，并写下可应对的方法。",
      ],
      citationIds: ["trainerEvent", "checkFacts", "worksheetOne", "worksheetTwo"],
      nextAction: "practice",
      mode: "verified",
    };
  }

  if (/你好|开始|能做什么|怎么用/u.test(message)) {
    return {
      kind: "answer",
      title: "我可以陪你学习一个 DBT 技能",
      message:
        "当前 Demo 可以从两册资料中检索 DBT 技能并标明原页；“核对事实”还提供了一个完整的六步结构化练习。你可以直接说技能名称，或描述一个具体、负担较低的情境。",
      citationIds: ["trainerOverview", "overview", "checkFacts"],
      nextAction: "practice",
      mode: "verified",
    };
  }

  return {
    kind: "refusal",
    title: "现有证据不足以回答",
    message:
      "当前问题无法从已经摄取的两册资料中得到足够直接的支持。为了避免把模型常识误当作书中内容，我不会继续推测；你可以换成更具体的 DBT 技能名称再试。",
    citationIds: [],
    nextAction: "none",
    mode: "verified",
  };
}

export function getSafetyBoundaryResponse(input: string): ChatPayload | null {
  const message = input.trim();
  if (crisisPatterns.some((pattern) => pattern.test(message))) {
    return respondFromFrozenEvidence(message);
  }
  if (clinicalBoundaryPatterns.some((pattern) => pattern.test(message))) {
    return respondFromFrozenEvidence(message);
  }
  return null;
}

const crisisFollowupPatterns = [
  /^(是|是的|有|有的|嗯|对|现在|马上|已经)$/u,
  /(刀|枪|绳|药|楼顶|桥边|窗边|危险物品)/u,
  /(现在|马上|立刻|已经).{0,6}(做|行动|准备|开始)/u,
  /(一个人|没人陪|控制不住|忍不住)/u,
];

export function getContextualSafetyResponse(
  input: string,
  recentUserMessages: string[] = [],
): ChatPayload | null {
  const direct = getSafetyBoundaryResponse(input);
  if (direct) return direct;
  const recentCrisis = recentUserMessages
    .slice(-3)
    .some((message) => crisisPatterns.some((pattern) => pattern.test(message)));
  if (recentCrisis && crisisFollowupPatterns.some((pattern) => pattern.test(input.trim()))) {
    return respondFromFrozenEvidence("我想自杀");
  }
  return null;
}
