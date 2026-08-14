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

export type ExperienceMode = "companion" | "deep-read";

export type SkillCard = {
  label: string;
  title: string;
  summary: string;
  whyItMayHelp: string;
  tryNow: string;
  takeaways?: string[];
};

export type ClaimCitation = {
  text: string;
  citationIds: string[];
  kind: "definition" | "applicability" | "practice" | "boundary";
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
  refusalReason?: "clinical-boundary" | "out-of-scope" | "transport" | "grounding-gap";
  title: string;
  message: string;
  steps?: string[];
  followUpQuestion?: string;
  skillCard?: SkillCard;
  suggestedReplies?: string[];
  citationIds?: string[];
  citations?: SourceCitation[];
  /** Professional DBT statements kept together with their supporting sources. */
  claims?: ClaimCitation[];
  nextAction?: "practice" | "none";
  experienceMode?: ExperienceMode;
  sessionState?: ConversationState;
  decision?: AssistantDecision;
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

export function buildSafetyResponse(assessment: SafetyAssessment): ChatPayload {
  if (assessment.category === "self-harm-crisis") {
    return {
      kind: "crisis",
      title: "现在先别一个人扛",
      message:
        "我很在意你现在的安全。先不要独自处理这件事：离开可能伤害自己的物品或地点，马上联系一个能到场陪你的人。如果你可能很快行动，立即拨打 120 或 110；也可以拨打 12356 全国统一心理援助热线。",
      steps: [
        "先和危险物品、药物、高处或其他危险地点拉开距离。",
        "马上联系一个可信任的人，请对方来陪你或保持通话。",
        "如果危险就在眼前，立即拨打 120 或 110，不要等待聊天回复。",
      ],
      followUpQuestion: "你现在是否已经准备行动，或者手边有可以伤害自己的东西？",
      suggestedReplies: ["有，危险就在眼前", "没有准备，但念头很强", "我已经联系到一个人"],
      nextAction: "none",
      mode: "safety",
    };
  }

  if (assessment.category === "other-harm-crisis") {
    return {
      kind: "crisis",
      title: "先和对方、危险物品拉开距离",
      message:
        "现在最重要的是避免任何人受伤。先不要继续争执、靠近对方或拿着可能伤人的东西；离开现场并联系一个能立即介入的可信任成年人或工作人员。如果你担心自己马上会动手，请立即拨打 110 或 120。",
      steps: [
        "放下并远离刀具、棍棒、药物或其他可能伤人的物品。",
        "和对方保持距离，去一个有人且相对安全的地方。",
        "请现实中的人立即介入；危险迫近时直接拨打 110 或 120。",
      ],
      followUpQuestion: "现在是否有人可能马上受伤，或者你手边有危险物品？",
      suggestedReplies: ["是，可能马上出事", "我已经离开现场", "现在没有人会受伤"],
      nextAction: "none",
      mode: "safety",
    };
  }

  if (assessment.category === "unsafe-behavior") {
    return {
      kind: "answer",
      title: "先确认现在没有人会受伤",
      message:
        "你提到摔、砸或动手，这类行为需要先处理当下安全，再回头分析为什么会一步步失控。现在先停下动作，放下手里的东西，和其他人拉开距离；确认安全后，我们再用行为链找到下次最早可以停住的位置。",
      steps: [
        "先停止动作，把容易伤人的物品放下并走远。",
        "和其他人保持距离，暂时不要继续争论。",
        "如果有人受伤或你担心还会动手，马上联系现实中的帮助，必要时拨打 110 或 120。",
      ],
      followUpQuestion: "现在有人受伤，或者仍有人可能被伤到吗？",
      suggestedReplies: ["现在没人会受伤", "有人受伤或可能受伤", "我已经离开现场"],
      nextAction: "none",
      mode: "safety",
    };
  }

  if (assessment.category === "violence-exposure") {
    return {
      kind: "answer",
      title: "先确认你现在是否安全",
      message:
        "对方正在摔、砸、推搡或动手时，不需要先把关系分析清楚。请先去一个能和对方隔开、有人可以帮助你的地方；不要为了继续聊天而留在危险现场。",
      steps: [
        "尽量去有出口、有人在的安全位置，避开厨房、阳台和危险物品。",
        "联系可信任的人，请对方来接你、陪你或保持通话。",
        "如果暴力正在发生或可能马上发生，拨打 110；有人受伤时拨打 120。",
      ],
      followUpQuestion: "你现在能安全离开并联系到一个现实中的人吗？",
      suggestedReplies: ["我已经到安全的地方", "我暂时离不开", "暴力正在发生"],
      nextAction: "none",
      mode: "safety",
    };
  }

  if (assessment.category === "medication") {
    return {
      kind: "refusal",
      refusalReason: "clinical-boundary",
      title: "药物怎么调整，需要由专业人员判断",
      message:
        "我不能根据聊天告诉你开始、停止、增减或更换药物。不同药物和身体情况的处理不同，自行调整可能有风险。请联系开药医生、精神科门诊或药师；如果已经多服、漏服后明显不适或出现意识异常，请及时联系 120。",
      steps: [
        "记下药名、当前剂量、服用时间和已经出现的不适。",
        "联系开药医生、就近精神科门诊或药师，按专业意见处理。",
        "严重不适、意识异常或误服过量时，立即拨打 120。",
      ],
      suggestedReplies: ["我想整理要告诉医生的信息", "我想先处理现在的情绪", "我知道该联系谁了"],
      nextAction: "none",
      mode: "safety",
    };
  }

  return {
    kind: "refusal",
    refusalReason: "clinical-boundary",
    title: "我不能替你诊断，但可以帮你安排下一步",
    message:
      "失眠、低落、焦虑或注意力变化可能有很多原因，仅凭聊天无法判断是不是某种疾病。更合适的下一步是记录持续时间、频率和对生活的影响，再由精神科医生、临床心理专业人员或其他有资质的专业人员评估。",
    steps: [
      "记录这些情况持续了多久、多久出现一次，以及睡眠、学习、工作和关系受到什么影响。",
      "预约有资质的专业人员评估，把记录和你最担心的问题一起带去。",
      "如果同时出现伤害自己或他人的想法，请立即告诉身边的人并联系 120、110 或 12356。",
    ],
    suggestedReplies: ["帮我整理就诊时要说什么", "我想先聊聊这些感受", "我想学一个当下能用的 DBT 技能"],
    nextAction: "none",
    mode: "safety",
  };
}

export function respondFromFrozenEvidence(input: string): ChatPayload {
  const message = input.trim();
  const safety = assessSafety(message);
  if (safety.category !== "none") return buildSafetyResponse(safety);

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
  const safety = assessSafety(input);
  return safety.category === "none" ? null : buildSafetyResponse(safety);
}

export function getContextualSafetyResponse(
  input: string,
  recentUserMessages: string[] = [],
): ChatPayload | null {
  const safety = assessSafety(input, recentUserMessages);
  return safety.category === "none" ? null : buildSafetyResponse(safety);
}
import type {
  AssistantDecision,
  ConversationState,
} from "./conversation/session-decision";
import {
  assessSafety,
  clinicalBoundaryPatterns,
  crisisPatterns,
  unsafeBehaviorPatterns,
  type SafetyAssessment,
} from "./safety/classifier";

export { clinicalBoundaryPatterns, crisisPatterns, unsafeBehaviorPatterns };
