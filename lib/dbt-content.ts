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
      title: "现在先别一个人扛",
      message:
        "如果你已经开始行动、手边有可能伤人的东西，或者担心自己马上会行动，请先离开危险物品和地点，马上联系一个能来陪你的人，并拨打 120 或 110。你也可以拨打 12356 全国统一心理援助热线。",
      steps: [
        "把可能伤人的东西放远，离开可能发生伤害的地方。",
        "马上联系一个能陪着你的人，不要独自待着。",
        "如果危险就在眼前，立即拨打 120 或 110。",
      ],
      nextAction: "none",
      mode: "safety",
    };
  }

  if (clinicalBoundaryPatterns.some((pattern) => pattern.test(message))) {
    return {
      kind: "refusal",
      title: "诊断和用药，需要交给专业人员",
      message:
        "我可以和你一起了解 DBT 技能，但不能判断你是否患有某种疾病，也不能告诉你该不该开始、停止或调整药物。把这个问题带给精神科医生或其他有资质的专业人员会更安全。",
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
        "先写下刚才实际发生了什么，暂时不猜原因。",
        "再看看现在的情绪和强度，跟能确认的事实有多对得上。",
        "最后再决定：先等等、做一个相反的小动作，还是处理眼前的问题。",
      ],
      citationIds: ["overview", "trainerOverview", "checkFacts"],
      nextAction: "practice",
      mode: "verified",
    };
  }

  if (/核对|事实|解释|假设|焦虑|担心|领导|消息|情绪/u.test(message)) {
    return {
      kind: "answer",
      title: "先把发生的事和脑中的猜测分开",
      message:
        "“核对事实”不是要否定你的感受，而是把三件事分开看：刚才发生了什么、你当时怎么理解，以及现在的情绪和能确认的事实有多对得上。",
      steps: [
        "先写你亲眼看到或听到的内容，不猜对方的原因。",
        "再写下当时脑中冒出的想法、担心或预测。",
        "看看哪些事实对得上，哪些对不上，还有哪些暂时不能确定。",
        "如果担心最坏的结果，也写下它有多可能，以及真发生时你能做什么。",
      ],
      citationIds: ["trainerEvent", "checkFacts", "worksheetOne", "worksheetTwo"],
      nextAction: "practice",
      mode: "verified",
    };
  }

  if (/你好|开始|能做什么|怎么用/u.test(message)) {
    return {
      kind: "answer",
      title: "先告诉我，你现在最想处理什么",
      message:
        "你可以直接说一件最近发生的事，或者告诉我现在最难受的是什么。我会从两册书里找合适的方法并标出页码；需要时，还能跟着做一次“核对事实”练习。",
      citationIds: ["trainerOverview", "overview", "checkFacts"],
      nextAction: "practice",
      mode: "verified",
    };
  }

  return {
    kind: "refusal",
    title: "这两册书里暂时找不到足够依据",
    message:
      "我不想拿模型自己的常识冒充书里的内容。你可以把问题说得更具体一点，或者直接告诉我想了解哪一个 DBT 技能，我再帮你查。",
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
