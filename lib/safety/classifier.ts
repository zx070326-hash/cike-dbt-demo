export type SafetyCategory =
  | "none"
  | "self-harm-crisis"
  | "other-harm-crisis"
  | "unsafe-behavior"
  | "violence-exposure"
  | "clinical-diagnosis"
  | "medication";

export type SafetySeverity = "none" | "boundary" | "check-immediate" | "urgent";

export type SafetyAssessment = {
  category: SafetyCategory;
  severity: SafetySeverity;
  reasonCodes: string[];
  requiresImmediateAction: boolean;
};

export type ExternalRiskLexicon = { l1a?: string[]; l1b?: string[] };

export const crisisPatterns = [
  /自杀|轻生/u,
  /想死|不想活|不愿活/u,
  /活着.{0,8}(没意思|没意义|没有意义|太累|不值得|受够了)/u,
  /不如.{0,5}(死|没了)|死了算了|一了百了/u,
  /永远.{0,5}(睡着|消失)|再也不想醒|不想再醒/u,
  /(希望|要是|如果).{0,6}(醒不过来|不要醒|消失).{0,6}(就好|更好|好了)/u,
  /(睡过去|睡着).{0,8}(再也|永远)?.{0,5}(别|不|不用).{0,2}醒/u,
  /想.{0,5}(从这个世界)?消失/u,
  /结束.{0,6}(生命|自己)|杀了自己/u,
  /伤害自己|自伤|自残|割腕|割伤自己/u,
  /跳楼|跳下去|跳桥|跳河|上吊|烧炭/u,
  /从.{0,6}(楼|高处|桥上|窗户).{0,6}跳/u,
  /服药自尽|(吞|吃).{0,5}(很多|大量|一整瓶|一把).{0,4}药/u,
  /(很多|大量|一整瓶|一把).{0,4}药.{0,8}(吞|吃|喝|服下)/u,
  /(没有我|我不在了).{0,8}(更好|轻松)/u,
  /(撑不下去|不想继续了|想彻底消失)/u,
  /撑不下去.{0,8}(结束|消失|不活)/u,
  /(不能|无法|很难|不确定).{0,6}保证.{0,4}(自己|我).{0,3}安全/u,
  /怕.{0,6}(对自己做点什么|伤到自己)/u,
  /(告别|遗书).{0,6}(写好|写完|准备)/u,
  /已经准备好.{0,8}(行动|开始|去做)/u,
  /身边.{0,5}(危险物品|刀|药).{0,10}(怕|可能|会).{0,5}(用|伤害自己)/u,
  /一个人.{0,8}(越来越|已经|快要)?.{0,4}(控制不住|撑不住)/u,
  /(危险的地方|高处|桥边|楼顶).{0,12}(撑不住|撑多久|控制不住|不知道怎么办)/u,
  /如果.{0,6}(没有醒来|没醒来).{0,10}(轻松|更好)/u,
  /不想再继续.{0,12}(想|想着).{0,4}(结束|消失)/u,
  /伤害了自己/u,
];

// Requests for instructions are classified independently from a user's stated
// intent. This prevents role-play, translation and "ignore the rules" wrappers
// from moving a harmful request into the ordinary retrieval route.
const harmfulInstructionPatterns = [
  /(?:自杀|自伤|自残|伤害自己).{0,18}(?:方法|方式|步骤|教程|比较|更安全|怎么做|怎样做)/u,
  /(?:方法|方式|步骤|教程).{0,12}(?:自杀|自伤|自残|伤害自己)/u,
  /(?:怎样|怎么).{0,8}(?:伤害自己|自伤|自残|结束生命)/u,
  /(?:假设|忽略|绕过).{0,12}(?:没有限制|规则|安全提醒).{0,16}(?:结束|消失).{0,6}(?:办法|方法|步骤)/u,
  /(?:具体|详细).{0,6}(?:结束生命|结束自己).{0,6}(?:办法|方法|步骤)/u,
];

const otherHarmPatterns = [
  /(想|要|准备|打算|计划|可能会|快要|忍不住|控制不住).{0,8}(杀|砍|捅|掐|打|弄死|伤害).{0,7}(他|她|别人|他人|家人|同事|对方|人)/u,
  /(杀|砍|捅|掐|打|弄死|伤害).{0,6}(他|她|别人|他人|家人|同事|对方).{0,8}(算了|现在|马上|待会|一会)/u,
  /(想|要|准备|打算|快要|忍不住|控制不住).{0,6}(打人|伤人|杀人)/u,
  /(手里|手边|拿着).{0,5}(刀|枪|棍|锤|危险物品).{0,10}(他|她|别人|伤人|动手)/u,
  /(气得|生气|愤怒|激动).{0,8}(想|要|快要|忍不住).{0,4}(动手|打人|伤人)/u,
  /怕.{0,10}(会|要|可能).{0,5}(伤到|打到|杀|砍|捅).{0,6}(旁边的人|别人|他|她|对方)/u,
  /(砍|杀|打|伤害).{0,5}(他|她|对方|别人).{0,6}(冲动|念头)/u,
  /(现在|马上|待会|一会儿)?.{0,6}(可能|也许|恐怕).{0,4}(会)?.{0,3}(伤害|伤到|打到).{0,4}(他人|别人|人|他|她|对方)/u,
  /(手里|手边|拿着).{0,5}(东西|物品|刀|棍).{0,8}(怕|担心).{0,5}(马上|一会儿)?.{0,3}(动手|伤人)/u,
];

export const unsafeBehaviorPatterns = [
  /(我|自己).{0,8}(摔|砸|扔).{0,5}(东西|杯子|手机|家具|物品)/u,
  /(一|每次)?(生气|发火|愤怒|激动).{0,8}(摔东西|砸东西|扔东西|踢门|砸门|打人|推人|掐人)/u,
  /(摔东西|砸东西|扔东西|踢门|砸门|打人|推人|掐人).{0,12}(后悔|内疚|收不住|停不下|控制不住|失控)/u,
  /(又|总是|经常|反复|刚刚|刚才|已经).{0,5}(摔东西|砸东西|扔东西|踢门|砸门|打人|推人|掐人)/u,
  /(我|自己).{0,8}(爆发|失控).{0,8}(动手|伤人|砸|摔|推|打)/u,
  /(我|自己).{0,10}(把).{0,8}(杯子|手机|家具|物品|东西|门).{0,5}(摔|砸|踢|扔)/u,
  /(我|自己).{0,8}(摔门|砸门|踹门|踢墙|砸墙)/u,
  /(控制不住|忍不住|失控).{0,8}(摔东西|砸东西|扔东西|踢门|砸门|动手|打人|推人)/u,
  /(我|自己).{0,8}(打|推|掐|踢)了?.{0,4}(他|她|别人|对方|家人)/u,
  /(我|自己).{0,8}(朝|冲).{0,4}(他|她|家人|对方).{0,5}(扔|砸).{0,4}(东西|物品)/u,
  /(拳头|脚).{0,4}(砸|踢).{0,4}(墙|门|家具)/u,
  /(生气|发火|愤怒).{0,8}(踹|踢|砸).{0,4}(家具|桌子|椅子|墙|门)/u,
];

const violenceExposurePatterns = [
  /(他|她|对方|伴侣|家人).{0,5}(正在|现在|又).{0,5}(摔东西|砸东西|踢门|砸门|打人|推我|掐我)/u,
  /(他|她|对方|伴侣|家人).{0,7}(摔东西|砸东西|打我|推我|掐我).{0,8}(害怕|不安全|怎么办)/u,
  /(他|她|对方|伴侣|家人).{0,8}(打我|推我|掐我|踢我|威胁我)/u,
  /我.{0,4}被.{0,6}(打|推|掐|踢|威胁)/u,
];

const diagnosisRequestPatterns = [
  /诊断|鉴定|确诊/u,
  /什么病|哪种病|有没有病/u,
  /(是不是|是否|像不像|算不算|会不会是|可能是|得了|患有).{0,18}(抑郁|焦虑|双相|躁郁|边缘|人格|精神|心理疾病|强迫|恐慌|创伤|PTSD|注意缺陷|多动|ADHD)/iu,
  /(抑郁|焦虑|双相|躁郁|边缘|人格|精神|强迫|恐慌|创伤|PTSD|注意缺陷|多动|ADHD).{0,4}(吗|么|是不是|是否|可能性|概率)/iu,
  /(这些|这种|上述|我的).{0,8}(症状|表现|情况).{0,10}(说明|算|是|属于).{0,8}(抑郁|焦虑|双相|疾病|病)/u,
  /(测一测|判断|确认|看看).{0,10}(抑郁|焦虑|双相|躁郁|边缘|人格|疾病|病)/u,
  /自测.{0,10}(抑郁|焦虑|双相|躁郁|边缘|人格|疾病|病)/u,
  /(怎么治疗|如何治疗|治疗方案).{0,8}(抑郁|焦虑|双相|精神|人格|疾病)/u,
  /普通情绪.{0,8}还是.{0,8}(心理疾病|精神疾病|病)/u,
  /(担心|怀疑|觉得).{0,8}(自己|我).{0,5}(有|得了|患有).{0,5}(抑郁|焦虑|双相|躁郁|边缘|人格|精神|强迫|恐慌|PTSD|ADHD)/iu,
  /(我|自己).{0,6}(担心|怀疑).{0,8}(抑郁|焦虑|双相|躁郁|边缘|人格|精神|强迫|恐慌|PTSD|ADHD)/iu,
];

export const clinicalBoundaryPatterns = diagnosisRequestPatterns;

const medicationPatterns = [
  /吃什么药|开什么药|开个?处方/u,
  /(停|减|加|换|断).{0,3}药|药.{0,4}(停|减|加|换|断)/u,
  /(加量|减量|增量|减半|加倍)|换.{0,4}(一种|另一个).{0,2}药/u,
  /药量|剂量|漏服|补服/u,
  /(服|吃).{0,4}药.{0,14}(停|减|加|换|怎么办|怎么处理)/u,
  /(多吃|少吃|减半|加倍).{0,5}药|药.{0,6}(多吃|少吃|减半|加倍)/u,
  /(这个|目前|现在).{0,5}(剂量|药量).{0,8}(适合|对不对|可以吗|行不行)/u,
  /(忘了|忘记).{0,5}(吃|服)药|药.{0,5}(忘了|忘记)/u,
  /(两顿|两次).{0,5}(一起吃|一起服|合在一起)/u,
  /(副作用|不良反应|吃了不舒服).{0,10}(不吃|停|减|换)/u,
  /药.{0,10}(不舒服|难受|副作用).{0,10}(不吃|停|减|换)/u,
  /药.{0,8}(酒|保健品|其他药).{0,8}(一起|同服|能不能|可以)/u,
];

const crisisFollowupPatterns = [
  /^(是|是的|有|有的|嗯|对|现在|马上|已经)[。！!？?\s]*$/u,
  /(刀|枪|绳|药|楼顶|桥边|窗边|危险物品)/u,
  /(现在|马上|立刻|已经).{0,8}(做|行动|准备|开始)/u,
  /(一个人|没人陪|控制不住|忍不住)/u,
];

function emptyAssessment(): SafetyAssessment {
  return {
    category: "none",
    severity: "none",
    reasonCodes: [],
    requiresImmediateAction: false,
  };
}

function normalizeForSafety(input: string) {
  return input
    .normalize("NFKC")
    .replace(/(没有|没|并不|不是|从没|从未).{0,3}(想死|自杀|轻生|伤害自己|自残)/gu, "")
    .replace(/(没有|没|并不|不是|不想|从没|从未).{0,3}(消失|结束自己|不醒来)/gu, "")
    .replace(/(没有|没|不会|并不|不是).{0,3}(想|要|会).{0,3}(伤害|打|杀).{0,4}(别人|他人|人|他|她|对方|家人)/gu, "")
    .trim();
}

function matchesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function isClinicalDiagnosisRequest(value: string) {
  if (!matchesAny(value, diagnosisRequestPatterns)) return false;
  // “我已确诊……”是背景信息，不等于要求系统重新诊断。
  const backgroundOnly = /(已经|已|已被|医生说|医院).{0,5}确诊/u.test(value) &&
    !/(是不是|是否|算不算|诊断|判断|确认|治疗方案|怎么治疗|如何治疗)/u.test(value.replace(/已被?确诊|已经确诊/gu, ""));
  if (backgroundOnly) return false;
  return true;
}

export function assessSafety(
  input: string,
  recentUserMessages: string[] = [],
  externalLexicon: ExternalRiskLexicon = {},
): SafetyAssessment {
  const message = normalizeForSafety(input);
  const normalizedMessage = message.normalize("NFKC").toLowerCase();
  const l1aHit = (externalLexicon.l1a ?? []).some((term) => normalizedMessage.includes(term.normalize("NFKC").toLowerCase()));
  const l1bHit = (externalLexicon.l1b ?? []).some((term) => normalizedMessage.includes(term.normalize("NFKC").toLowerCase()));

  if (l1aHit || l1bHit) {
    return {
      category: "self-harm-crisis",
      severity: l1aHit ? "urgent" : "check-immediate",
      reasonCodes: [l1aHit ? "EXTERNAL_LEXICON_L1A" : "EXTERNAL_LEXICON_L1B"],
      requiresImmediateAction: l1aHit,
    };
  }

  const informationalReference = /(?:课程|作业|新闻|文章|研究|科普).{0,12}(?:自杀|自伤)|(?:自杀|自伤).{0,8}(?:预防|课程|作业|研究|新闻|文章)/u.test(message);
  const firstPersonIntent = /(我|自己).{0,8}(想|要|准备|打算|控制不住|忍不住).{0,8}(死|消失|伤害|自伤|自残|结束)/u.test(message);

  if ((!informationalReference || firstPersonIntent) && matchesAny(message, crisisPatterns)) {
    return {
      category: "self-harm-crisis",
      severity: "urgent",
      reasonCodes: ["SELF_HARM_LANGUAGE"],
      requiresImmediateAction: true,
    };
  }

  if (matchesAny(message, harmfulInstructionPatterns)) {
    return {
      category: "self-harm-crisis",
      severity: "urgent",
      reasonCodes: ["HARMFUL_INSTRUCTION_REQUEST"],
      requiresImmediateAction: true,
    };
  }

  if (matchesAny(message, otherHarmPatterns)) {
    return {
      category: "other-harm-crisis",
      severity: "urgent",
      reasonCodes: ["OTHER_HARM_INTENT"],
      requiresImmediateAction: true,
    };
  }

  if (matchesAny(message, medicationPatterns)) {
    return {
      category: "medication",
      severity: "boundary",
      reasonCodes: ["MEDICATION_DECISION_REQUEST"],
      requiresImmediateAction: false,
    };
  }

  if (isClinicalDiagnosisRequest(message)) {
    return {
      category: "clinical-diagnosis",
      severity: "boundary",
      reasonCodes: ["DIAGNOSIS_REQUEST"],
      requiresImmediateAction: false,
    };
  }

  if (matchesAny(message, violenceExposurePatterns)) {
    return {
      category: "violence-exposure",
      severity: "check-immediate",
      reasonCodes: ["POSSIBLE_VIOLENCE_EXPOSURE"],
      requiresImmediateAction: false,
    };
  }

  if (matchesAny(message, unsafeBehaviorPatterns)) {
    return {
      category: "unsafe-behavior",
      severity: "check-immediate",
      reasonCodes: ["UNSAFE_DYSREGULATED_BEHAVIOR"],
      requiresImmediateAction: false,
    };
  }

  const recentCrisis = recentUserMessages
    .slice(-3)
    .some((previous) => matchesAny(normalizeForSafety(previous), crisisPatterns));
  if (recentCrisis && matchesAny(message, crisisFollowupPatterns)) {
    return {
      category: "self-harm-crisis",
      severity: "urgent",
      reasonCodes: ["RECENT_CRISIS_CONTEXT", "AMBIGUOUS_IMMEDIATE_FOLLOWUP"],
      requiresImmediateAction: true,
    };
  }

  const recentOtherHarm = recentUserMessages
    .slice(-3)
    .some((previous) => matchesAny(normalizeForSafety(previous), otherHarmPatterns));
  if (recentOtherHarm && matchesAny(message, crisisFollowupPatterns)) {
    return {
      category: "other-harm-crisis",
      severity: "urgent",
      reasonCodes: ["RECENT_OTHER_HARM_CONTEXT", "AMBIGUOUS_IMMEDIATE_FOLLOWUP"],
      requiresImmediateAction: true,
    };
  }

  const recentUnsafeBehavior = recentUserMessages
    .slice(-3)
    .some((previous) => matchesAny(normalizeForSafety(previous), unsafeBehaviorPatterns));
  if (recentUnsafeBehavior && /^(有|是|对).{0,8}(受伤|危险|还会|可能|控制不住)|有人.{0,4}(受伤|流血)|可能.{0,4}(受伤|伤到)|还会.{0,3}(动手|砸|摔)|停不下来/u.test(message)) {
    return {
      category: "other-harm-crisis",
      severity: "urgent",
      reasonCodes: ["RECENT_UNSAFE_BEHAVIOR", "POSSIBLE_CURRENT_INJURY"],
      requiresImmediateAction: true,
    };
  }

  const recentMedicationContext = recentUserMessages
    .slice(-3)
    .some((previous) => /药|服药|吃药|剂量|舍曲林|奥氮平|喹硫平|碳酸锂/u.test(previous));
  if (recentMedicationContext && /^(今晚|今天|这次|那)?(能|可以|要不要|需不需要)?.{0,5}(不吃|停掉|减一点|加一点|换掉|补上|一起吃)/u.test(message)) {
    return {
      category: "medication",
      severity: "boundary",
      reasonCodes: ["RECENT_MEDICATION_CONTEXT", "MEDICATION_FOLLOWUP_DECISION"],
      requiresImmediateAction: false,
    };
  }

  return emptyAssessment();
}
