import type { SafetyAssessment, SafetyCategory } from "../safety/classifier";

export type ConversationNeed = "listen" | "stabilize" | "clarify" | "learn" | "practice";
export type ConversationIntensity = 0 | 1 | 2 | 3;
export type InterventionResponse = "not-tried" | "unknown" | "no-change" | "helped" | "worse";

export type ConversationState = {
  version: "3.0";
  need: ConversationNeed;
  intensity: ConversationIntensity;
  activeSkill: string | null;
  lastIntervention: string | null;
  responseToIntervention: InterventionResponse;
};

export type AssistantDecision = {
  version: "3.0";
  route: string;
  safetyCategory: SafetyCategory;
  skillCandidates: string[];
  requiresClarification: boolean;
  reasonCodes: string[];
};

export type HistoryTurn = { role: "user" | "assistant"; content: string };

type Candidate = { id: string; score: number; reasons: string[] };

const namedSkills = [
  ["行为链分析", /行为链|链式分析|链锁分析/u],
  ["核对事实", /核对事实/u],
  ["STOP", /\bSTOP\b|停止技能/iu],
  ["TIP", /\bTIPP?\b/iu],
  ["全然接纳", /全然接纳|彻底接纳/u],
  ["相反行为", /相反行为|相反行动/u],
  ["问题解决", /问题解决/u],
  ["DEAR MAN", /DEAR\s*MAN|DEARMAN/iu],
  ["人际效能", /人际效能|\bGIVE\b|\bFAST\b/iu],
  ["正念", /正念|智慧心|观察.{0,2}描述.{0,2}参与|不评判|一次专注|一心一意|有效地做/u],
  ["痛苦耐受", /痛苦耐受|危机生存/u],
] as const;

function includesPattern(value: string, pattern: RegExp) {
  return pattern.test(value.normalize("NFKC"));
}

function lastNamedSkill(value: string) {
  for (const [skill, pattern] of namedSkills) {
    if (includesPattern(value, pattern)) return skill;
  }
  return null;
}

function inferLastIntervention(history: HistoryTurn[]) {
  const assistant = [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  const named = lastNamedSkill(assistant);
  if (named) return named;
  if (/停一下|停下来|暂停|退后一步|脚底|双脚踩地|观察周围|留意呼吸|注意力.{0,4}(呼吸|身体)/u.test(assistant)) {
    return "STOP";
  }
  if (/事实.{0,4}解释|解释.{0,4}事实|能确认的事/u.test(assistant)) return "核对事实";
  return null;
}

function inferResponseToIntervention(message: string, lastIntervention: string | null): InterventionResponse {
  if (!lastIntervention) return "not-tried";
  if (/更难受|更糟|加重|反而.{0,5}(难受|慌|乱)|越来越/u.test(message)) return "worse";
  if (/没用|没有用|没变化|完全没有|还是一样|一点没/u.test(message)) return "no-change";
  if (/好一点|缓了一点|有点用|轻松一点|好多了|有效/u.test(message)) return "helped";
  return "unknown";
}

function inferIntensity(message: string, safety: SafetyAssessment): ConversationIntensity {
  if (safety.severity === "urgent") return 3;
  if (safety.severity === "check-immediate") return 3;
  if (/崩溃|失控|控制不住|喘不过气|情绪爆炸|快撑不住|非常强烈|特别强烈/u.test(message)) return 3;
  if (/很难受|特别难受|一直|反复|睡不着|失眠|很生气|很害怕|很焦虑|很低落|很乱/u.test(message)) return 2;
  if (/有点|不太|不舒服|难受|担心|紧张|烦|累|低落|委屈|生气/u.test(message)) return 1;
  return 0;
}

function inferNeed(message: string, intensity: ConversationIntensity, safety: SafetyAssessment): ConversationNeed {
  if (safety.category !== "none") return "stabilize";
  if (/只想.{0,8}(听我说|说说|聊聊|陪陪)|想找.{0,6}(人|你).{0,5}(说说|聊聊)|先听我说|不想分析|暂时不想解决/u.test(message)) {
    return "listen";
  }
  if ((intensity >= 3 && /崩溃|失控|控制不住|喘不过气|快撑不住|情绪爆炸/u.test(message)) ||
    /先.{0,5}(缓|稳定|冷静|停下)|当下太难熬|撑过这一刻/u.test(message)) {
    return "stabilize";
  }
  const namedSkill = lastNamedSkill(message);
  if (namedSkill && /怎么(做|练)|带我|一起练|开始练|下一步|试一试|练习/u.test(message)) return "practice";
  if (namedSkill || /是什么|有哪些|区别|原理|适合什么时候|如何理解/u.test(message)) return "learn";
  if (/帮我.{0,6}(做|练)|我想练|下一步怎么做|从哪一步开始/u.test(message)) return "practice";
  return "clarify";
}

function candidate(id: string): Candidate {
  return { id, score: 0, reasons: [] };
}

function addSignal(item: Candidate, points: number, reason: string, matched: boolean) {
  if (!matched) return;
  item.score += points;
  item.reasons.push(reason);
}

function scoreSkillCandidates(message: string, recentUserContext: string, need: ConversationNeed) {
  const context = `${recentUserContext} ${message}`.normalize("NFKC");
  const items = {
    "behavior-chain": candidate("behavior-chain"),
    "distress-survival": candidate("distress-survival"),
    "emotion-facts": candidate("emotion-facts"),
    acceptance: candidate("acceptance"),
    interpersonal: candidate("interpersonal"),
  };

  const behavior = /(摔|砸|扔).{0,5}(东西|杯子|手机|家具|物品)|踢门|砸门|打人|推人|掐人|吼人|爆发|冲动行为|拖延/u.test(context);
  const repeated = /每次|总是|经常|反复|又|一再/u.test(context);
  const aftermath = /事后|后来.{0,4}(后悔|内疚)|后悔|内疚|自责/u.test(context);
  const lossOfControl = /控制不住|停不下来|收不住|失控|忍不住/u.test(context);
  addSignal(items["behavior-chain"], 3, "CONCRETE_PROBLEM_BEHAVIOR", behavior);
  addSignal(items["behavior-chain"], 4, "BEHAVIOR_CHAIN_CONCEPT", /促发事件|诱发事件|问题行为|连接点|链条环节|脆弱因素/u.test(message));
  addSignal(items["behavior-chain"], 2, "REPEATED_PATTERN", repeated);
  addSignal(items["behavior-chain"], 2, "AFTERMATH_OR_REGRET", aftermath);
  addSignal(items["behavior-chain"], 2, "LOSS_OF_CONTROL", lossOfControl);

  addSignal(items["distress-survival"], 3, "NEED_STABILIZATION", need === "stabilize");
  addSignal(items["distress-survival"], 2, "ACUTE_AROUSAL", /现在|马上|快要|情绪很强|冷静不下来|脑子很乱|喘不过气/u.test(message));
  addSignal(items["distress-survival"], 1, "LOSS_OF_CONTROL", lossOfControl);

  addSignal(items["emotion-facts"], 2, "PREDICTION_LANGUAGE", /肯定|一定|是不是|意味着|会不会|最坏|搞砸/u.test(context));
  addSignal(items["emotion-facts"], 4, "FACT_CHECK_CONCEPT", /假设|核对证据|检查证据|事实.{0,4}解释|解释.{0,4}事实/u.test(message));
  addSignal(items["emotion-facts"], 2, "RUMINATION", /反复想|一直想|想不通|胡思乱想|内耗|猜/u.test(context));
  addSignal(items["emotion-facts"], 1, "ANXIETY", /担心|焦虑|紧张|害怕/u.test(context));

  addSignal(items.acceptance, 3, "UNCHANGEABLE_REALITY", /已经发生|改变不了|无法改变|挽回不了/u.test(context));
  addSignal(items.acceptance, 2, "RESISTANCE_TO_REALITY", /接受不了|不能接受|抗拒|放不下|舍不得/u.test(context));

  addSignal(items.interpersonal, 2, "INTERPERSONAL_EVENT", /伴侣|对象|朋友|同事|领导|家人|对方|关系/u.test(context));
  addSignal(items.interpersonal, 2, "COMMUNICATION_GOAL", /沟通|表达|开口|请求|拒绝|边界|怎么说/u.test(context));
  addSignal(items.interpersonal, 1, "CONFLICT", /吵架|冲突|冷淡|不理|忽冷忽热/u.test(context));

  return Object.values(items).sort((left, right) => right.score - left.score);
}

export function buildConversationDecision(
  message: string,
  history: HistoryTurn[],
  safety: SafetyAssessment,
): { state: ConversationState; decision: AssistantDecision } {
  const recentUserContext = history
    .filter((turn) => turn.role === "user")
    .slice(-2)
    .map((turn) => turn.content)
    .join(" ");
  const lastIntervention = inferLastIntervention(history);
  const intensity = inferIntensity(message, safety);
  const need = inferNeed(message, intensity, safety);
  const responseToIntervention = inferResponseToIntervention(message, lastIntervention);
  const explicitSkill = lastNamedSkill(message);
  const candidates = scoreSkillCandidates(message, recentUserContext, need);
  const viable = candidates.filter((item) => item.score >= 3);

  let route = viable[0]?.id ?? "clarify";
  const reasonCodes = [...(viable[0]?.reasons ?? [])];
  if (explicitSkill) {
    route = "direct";
    reasonCodes.unshift("USER_NAMED_SKILL");
  } else if (safety.category !== "none") {
    route = "safety";
    reasonCodes.splice(0, reasonCodes.length, ...safety.reasonCodes);
  } else if (need === "listen") {
    route = "clarify";
    reasonCodes.unshift("USER_REQUESTED_LISTENING");
  }

  const activeSkill = safety.category === "unsafe-behavior" || safety.category === "other-harm-crisis"
    ? "STOP"
    : explicitSkill ?? (route === "behavior-chain"
      ? "行为链分析"
      : route === "distress-survival"
        ? "STOP"
        : route === "emotion-facts"
          ? "核对事实"
          : route === "acceptance"
            ? "全然接纳"
            : route === "interpersonal"
              ? "人际效能"
              : lastIntervention);

  const topGap = viable.length > 1 ? viable[0].score - viable[1].score : viable[0]?.score ?? 0;
  const requiresClarification = safety.category === "unsafe-behavior" ||
    safety.category === "violence-exposure" ||
    (route === "clarify" && need !== "learn") ||
    (viable.length > 1 && topGap <= 1 && need !== "stabilize");

  return {
    state: {
      version: "3.0",
      need,
      intensity,
      activeSkill,
      lastIntervention,
      responseToIntervention,
    },
    decision: {
      version: "3.0",
      route,
      safetyCategory: safety.category,
      skillCandidates: viable.slice(0, 3).map((item) => item.id),
      requiresClarification,
      reasonCodes: [...new Set(reasonCodes)],
    },
  };
}
