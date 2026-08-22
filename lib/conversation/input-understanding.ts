export type ConversationScope =
  | "self-experience"
  | "dbt-learning"
  | "conversation"
  | "clearly-unrelated"
  | "ambiguous";

export type ConversationSubject = "self" | "other" | "general" | "unknown";

export type InputUnderstanding = {
  version: "1.0";
  scope: ConversationScope;
  subject: ConversationSubject;
  confidence: "high" | "medium" | "low";
  hasSelfExperience: boolean;
  hasAffectSignal: boolean;
  hasSituationSignal: boolean;
  reasonCodes: string[];
};

function normalize(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}

const dbtKnowledgePattern = /\b(?:DBT|STOP|TIPP?|DEAR\s*MAN|GIVE|FAST|PLEASE|ABC)\b|辩证行为|核对事实|相反行为|相反行动|问题解决|正念|痛苦耐受|危机生存|全然接纳|彻底接纳|情绪调节|人际效能|智慧心|行为链|链式分析|技能|练习单/iu;
const conversationalPattern = /^(你好|您好|嗨|哈喽|hello|hi|在吗|谢谢|谢谢你|好的|好吧|再见|拜拜|你是谁|你能做什么|怎么用)[呀啊吗呢？?！!。.,，\s]*$/iu;

// These are semantic dimensions used only to notice that an experience is
// being described. They do not select a DBT skill or assert a diagnosis.
const affectPattern = /难受|不好受|焦躁|烦躁|暴躁|浮躁|烦|窝火|发火|惹毛|炸毛|不耐烦|脾气.{0,3}差|状态.{0,3}差|静不下来|坐立不安|心神不宁|乱糟糟|悬着|想哭|压抑|心慌|慌|不安|害怕|焦虑|担心|恐惧|悲伤|难过|愤怒|生气|羞耻|内疚|委屈|低落|郁闷|孤独|心里堵|崩溃|疲惫|很累|好累|绷得.{0,3}紧|控制不住|失控|冲动|放不下|接受不了/u;
const situationPattern = /刚才|今天|昨天|最近|这几天|这段时间|发生|对方|朋友|同事|领导|家人|伴侣|对象|关系|吵架|冲突|消息|回复|工作|学习|失恋|拒绝|批评|拖延/u;
const firstPersonPattern = /我|自己|本人|心里|心情|情绪|脑子|身体|整个人/u;
const selfImpactPattern = /(?:让|使|搞得|弄得|看得|听得|急得)我.{0,16}(?:难受|烦|焦躁|烦躁|暴躁|浮躁|窝火|惹毛|炸毛|想哭|压抑|慌|不安|害怕|焦虑|担心|悲伤|难过|愤怒|生气|委屈|低落|郁闷|绷|乱|累)|我(?:觉得|感觉|感到|发现自己|忍不住|控制不住|静不下来|想哭)/u;
const leadingPersonalFrame = /^(?:我(?:今天|现在|最近|这几天|这段时间|刚才|昨晚)?|心里|心情|情绪|脑子|身体|整个人|总感觉|总觉得|感觉|觉得|说不上来|胸口)/u;

const thirdPartySubjectPattern = /^(?:我(?:家|的))?(?:猫|狗|宠物)|^(?:这|那|这个|那个)(?:部电影|个角色|首歌|本书|段文字|篇文章|故事)|^(?:他|她|他们|她们|朋友|同事|领导|伴侣|对象|孩子).{0,8}(?:很|有点|特别|看起来|显得)/u;
const creativeDescriptionPattern = /我(?:正在|在|想)(?:写|描述|分析|评论|翻译|创作).{0,18}(?:歌|歌词|小说|角色|电影|文章|文案|故事)/u;
const unrelatedObjectPattern = /压力锅|天气|量子|物理|化学|数学题|手机|电脑|服务器|数据库|代码|程序|打印机|路由器|股票|汇率|食谱|菜谱/u;
const selfHelpConceptPattern = /情绪|感受|想法|冲动|关系|沟通|表达|拒绝|请求|边界|事实|解释|假设|行为|拖延|后悔|接纳|睡眠|失眠|自责|内耗|反复想|冷静/u;
const generalRequestPattern = /什么|为什么|怎么|怎样|如何|哪(?:个|些|里)|谁|多少|请|帮我|给我|推荐|解释|介绍|讲|计算|分析|写|翻译|教我|规划|值得吗|会赢/u;

function looksLikeStandaloneExperience(message: string, hasAffectSignal: boolean) {
  if (!hasAffectSignal || message.length > 40) return false;
  if (thirdPartySubjectPattern.test(message) || creativeDescriptionPattern.test(message)) return false;
  return !unrelatedObjectPattern.test(message);
}

/**
 * High-recall, claim-free input understanding.
 *
 * This layer answers only whether the user is bringing a personal experience
 * into a DBT self-help conversation. It deliberately does not choose a skill.
 * When uncertain, it returns `ambiguous`, which the application resolves with
 * one clarification question instead of a refusal.
 */
export function understandUserInput(message: string, recentUserContext = ""): InputUnderstanding {
  const current = normalize(message);
  const context = normalize(`${recentUserContext} ${message}`);
  const reasonCodes: string[] = [];
  const hasAffectSignal = affectPattern.test(current);
  const hasSituationSignal = situationPattern.test(context);
  const hasSelfImpact = selfImpactPattern.test(current);
  const hasPersonalFrame = leadingPersonalFrame.test(current);
  const thirdPartyOnly = thirdPartySubjectPattern.test(current) && !hasSelfImpact;
  const creativeDescriptionOnly = creativeDescriptionPattern.test(current) && !hasSelfImpact;
  const hasExplicitUnrelatedObject = unrelatedObjectPattern.test(current) && !hasSelfImpact;
  const hasSelfExperience = hasSelfImpact ||
    (!thirdPartyOnly && !creativeDescriptionOnly && (
      (!hasExplicitUnrelatedObject && hasPersonalFrame && (hasAffectSignal || hasSituationSignal || current.length <= 28)) ||
      (firstPersonPattern.test(current) && hasAffectSignal) ||
      looksLikeStandaloneExperience(current, hasAffectSignal)
    ));

  if (dbtKnowledgePattern.test(current)) {
    reasonCodes.push("DBT_KNOWLEDGE_OR_SKILL");
    return {
      version: "1.0",
      scope: "dbt-learning",
      subject: hasSelfExperience ? "self" : "general",
      confidence: "high",
      hasSelfExperience,
      hasAffectSignal,
      hasSituationSignal,
      reasonCodes,
    };
  }

  if (conversationalPattern.test(current)) {
    reasonCodes.push("CONVERSATIONAL_ACT");
    return {
      version: "1.0",
      scope: "conversation",
      subject: "unknown",
      confidence: "high",
      hasSelfExperience: false,
      hasAffectSignal,
      hasSituationSignal,
      reasonCodes,
    };
  }

  if (hasSelfExperience) {
    reasonCodes.push("SELF_EXPERIENCE_FRAME");
    if (hasAffectSignal) reasonCodes.push("AFFECT_SIGNAL");
    if (hasSituationSignal) reasonCodes.push("SITUATION_SIGNAL");
    return {
      version: "1.0",
      scope: "self-experience",
      subject: "self",
      confidence: hasSelfImpact || (hasPersonalFrame && hasAffectSignal) ? "high" : "medium",
      hasSelfExperience: true,
      hasAffectSignal,
      hasSituationSignal,
      reasonCodes,
    };
  }

  if (thirdPartyOnly || creativeDescriptionOnly || hasExplicitUnrelatedObject) {
    reasonCodes.push(thirdPartyOnly
      ? "THIRD_PARTY_DESCRIPTION"
      : creativeDescriptionOnly
        ? "CREATIVE_DESCRIPTION"
        : "UNRELATED_OBJECT");
    return {
      version: "1.0",
      scope: "clearly-unrelated",
      subject: thirdPartyOnly ? "other" : "general",
      confidence: "high",
      hasSelfExperience: false,
      hasAffectSignal,
      hasSituationSignal,
      reasonCodes,
    };
  }

  if (generalRequestPattern.test(current) && !selfHelpConceptPattern.test(current) && !hasAffectSignal) {
    reasonCodes.push("GENERAL_KNOWLEDGE_REQUEST");
    return {
      version: "1.0",
      scope: "clearly-unrelated",
      subject: "general",
      confidence: "medium",
      hasSelfExperience: false,
      hasAffectSignal,
      hasSituationSignal,
      reasonCodes,
    };
  }

  reasonCodes.push("INSUFFICIENT_CONTEXT");
  return {
    version: "1.0",
    scope: "ambiguous",
    subject: "unknown",
    confidence: "low",
    hasSelfExperience: false,
    hasAffectSignal,
    hasSituationSignal,
    reasonCodes,
  };
}
