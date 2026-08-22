import {
  understandUserInput,
  type InputUnderstanding,
} from "../conversation/input-understanding";

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
  situation?: "relationship-distress" | "relationship-attachment";
};

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function includesAny(value: string, candidates: string[]) {
  const normalizedValue = normalize(value);
  return candidates.some((candidate) => normalizedValue.includes(normalize(candidate)));
}

const explicitSkillTerms = [
  "DBT", "辩证行为", "核对事实", "相反行为", "相反行动", "问题解决",
  "正念", "痛苦耐受", "危机生存", "全然接纳", "彻底接纳", "情绪调节",
  "人际效能", "智慧心", "行为链", "链式分析", "链锁分析", "DEAR MAN",
  "DEARMAN", "GIVE", "FAST", "TIP", "TIPP", "STOP", "PLEASE", "ABC",
  "积累正向情绪", "积累正面情绪", "利弊分析", "转移注意力", "自我安抚", "改善当下",
  "促发事件", "脆弱因素", "缺失环节", "行动冲动", "问题行为", "接纳现实",
  "目标效能", "关系效能", "自尊效能", "不评判",
  "目标关系和自尊",
];

/** Deterministic provisional routing. It selects a retrieval direction, never a diagnosis. */
export function planRetrieval(
  query: string,
  recentUserContext = "",
  suppliedUnderstanding?: InputUnderstanding,
): RetrievalPlan {
  const current = query.trim();
  const context = `${recentUserContext} ${current}`.trim();
  const inputUnderstanding = suppliedUnderstanding ?? understandUserInput(current, recentUserContext);
  if (includesAny(current, explicitSkillTerms)) {
    return { kind: "direct", route: "direct", retrievalQuery: context, label: "用户指定的 DBT 技能" };
  }
  if (/^(我)?(现在|也)?(不知道(该)?怎么说|不知道从哪(里)?说起|说不清)[了呀啊呢。！!？?\s]*$/u.test(current)) {
    return { kind: "clarify", route: "clarify", retrievalQuery: current, label: "需要确认当前目标" };
  }
  if (includesAny(current, ["想先说说", "刚才发生的事", "还讲不完整"])) {
    return { kind: "clarify", route: "clarify", retrievalQuery: current, label: "先听你把事情说出来" };
  }
  if (/一边.+一边/u.test(current) || includesAny(current, ["理智还是感受", "脑子和心里打架"])) {
    return { kind: "clarify", route: "clarify", retrievalQuery: current, label: "先看清内在拉扯" };
  }
  if (includesAny(current, ["日常预防", "提前预防", "不想每次都等情绪爆发"])) {
    return { kind: "clarify", route: "clarify", retrievalQuery: current, label: "寻找日常降低脆弱性的方向" };
  }
  if (
    (includesAny(current, ["观察"]) && includesAny(current, ["描述"]) && includesAny(current, ["参与"])) ||
    includesAny(current, ["学过很多技能", "知道该用技能", "技能却没用", "现场就想不起来"])
  ) {
    return { kind: "direct", route: "direct", retrievalQuery: current, label: "高置信度 DBT 技能方向" };
  }
  if (includesAny(current, ["确实存在而且能改", "列出可行方案", "列解决方案", "现实问题怎么解决"])) {
    return { kind: "direct", route: "direct", retrievalQuery: `${context} 问题解决`, label: "可改变的现实问题" };
  }
  if (
    includesAny(current, ["不知道怎么说", "不知道该怎么说", "说不清"]) &&
    !includesAny(context, ["对方", "他", "她", "伴侣", "朋友", "同事", "领导", "家人", "沟通", "表达", "请求", "拒绝", "冲突"])
  ) {
    return { kind: "clarify", route: "clarify", retrievalQuery: current, label: "需要确认当前感受" };
  }

  const immediateEscalation = includesAny(current, ["现在", "马上", "快要", "正在", "忍不住想", "就要", "控制不住了"]) &&
    includesAny(current, ["摔", "砸", "扔", "吼", "打", "冲过去", "爆发"]);
  const highIntensity = includesAny(context, [
    "情绪很强", "先稳定", "冷静不下来", "快要崩溃", "情绪爆炸", "压倒",
    "脑子很乱", "脑子一片乱", "喘不过气", "当下太难熬", "先撑过去", "安全撑过",
    "什么都想不了", "先冷静", "情绪太强", "要爆炸",
  ]);
  if (immediateEscalation || highIntensity) {
    return {
      kind: "guided",
      route: "distress-survival",
      retrievalQuery: `${context} 痛苦耐受 危机生存 STOP 停止动作 退后一步 客观观察 带着觉察行事`,
      label: immediateEscalation ? "先停住可能让事情更糟的动作" : "情绪很强，先让自己停一下",
    };
  }

  const concreteProblemBehavior = includesAny(context, [
    "摔东西", "砸东西", "扔东西", "摔门", "砸门", "大喊", "吼人", "推人", "打人",
    "冲动消费", "暴饮暴食", "反复检查", "反复联系", "一遍遍发消息", "发很多消息",
    "失控", "拖延", "拖到最后", "爆发", "问题行为",
  ]);
  const behaviorAftermath = includesAny(context, [
    "事后", "之后", "后来", "后悔", "每次", "总是", "一再", "反复", "又一次", "控制不住",
  ]);
  if ((concreteProblemBehavior && behaviorAftermath) || includesAny(context, [
    "冲动后", "冲动了", "总是冲动", "反复做", "事后特别后悔", "又后悔",
  ])) {
    return {
      kind: "guided",
      route: "behavior-chain",
      retrievalQuery: `${context} 行为链 链锁分析 脆弱因素 促发事件 问题行为 行为后果`,
      label: "把反复发生的行为拆开来看",
    };
  }

  if (
    includesAny(current, ["放不下", "舍不得", "忘不了", "离不开", "还是喜欢", "总想他", "总想她", "一直等他", "一直等她", "等他消息", "等她消息"]) &&
    includesAny(context, ["爱上", "喜欢", "冷淡", "薄情", "忽冷忽热", "感情", "恋爱", "失恋", "暧昧", "伴侣", "对象", "前任", "关系", "他", "她"])
  ) {
    return {
      kind: "guided",
      route: "acceptance",
      retrievalQuery: `${context} 痛苦耐受 接纳现实 全然接纳 智慧心 核对事实 关系目标 自尊目标`,
      label: "面对舍不得和现实之间的拉扯",
      situation: "relationship-attachment",
    };
  }

  if (includesAny(context, [
    "吵架", "冲突", "沟通", "表达", "怎么说", "开口", "边界", "拒绝", "请求",
    "一说话就", "想处理一段关系", "爱上", "喜欢上", "冷淡", "薄情", "忽冷忽热",
    "不理我", "没回应", "感情", "恋爱", "失恋", "暧昧", "伴侣", "对象", "前任",
    "关系怎么办", "相处", "在意的人", "委屈自己", "一直道歉", "不停道歉",
    "申请", "怎样说", "确认对方", "同意他", "让对方理解", "关系谈崩",
    "争论", "谈话", "守住自尊",
  ])) {
    const relationshipDistress = includesAny(context, [
      "爱上", "喜欢上", "放不下", "舍不得", "冷淡", "薄情", "忽冷忽热", "不理我",
      "没回应", "感情", "恋爱", "失恋", "暧昧", "伴侣", "对象", "前任", "在意的人",
    ]) && !includesAny(current, ["沟通", "表达", "怎么说", "开口", "边界", "拒绝", "请求", "谈一谈"]);
    return {
      kind: "guided",
      route: "interpersonal",
      retrievalQuery: relationshipDistress
        ? `${context} 人际效能 核对事实 人际关系目标 关系效能 自尊效能 智慧心`
        : `${context} 人际效能 DEAR MAN GIVE FAST 请求 拒绝`,
      label: relationshipDistress ? "看清这段关系里发生了什么" : "把想说的话说清楚",
      situation: relationshipDistress ? "relationship-distress" : undefined,
    };
  }

  if (includesAny(context, [
    "无法改变", "改变不了", "已经发生", "挽回不了", "接受不了", "不能接受",
    "不愿接受", "一直抗拒", "放不下", "耿耿于怀", "不甘心", "为什么偏偏",
  ])) {
    return {
      kind: "guided",
      route: "acceptance",
      retrievalQuery: `${context} 痛苦耐受 接纳现实 全然接纳 转念 我愿意`,
      label: "面对一时改变不了的事",
    };
  }

  if (includesAny(context, [
    "肯定会", "一定会", "一定是", "是不是", "意味着", "搞砸", "最坏", "预测", "认定",
    "反复想", "胡思乱想", "内耗", "纠结", "想不通", "担心", "焦虑", "紧张", "猜他",
    "事实和我的解释", "事实和解释", "摄像机能记录",
  ])) {
    return {
      kind: "guided",
      route: "emotion-facts",
      retrievalQuery: `${context} 核对事实 情绪 解释 假设 证据 威胁 预测`,
      label: "把事实和脑中的猜测分开",
    };
  }
  if (inputUnderstanding.scope !== "clearly-unrelated") {
    return {
      kind: "clarify",
      route: "clarify",
      retrievalQuery: current,
      label: inputUnderstanding.scope === "self-experience"
        ? "先确认此刻最需要的帮助"
        : "需要确认当前目标",
    };
  }
  return { kind: "out-of-scope", route: "out-of-scope", retrievalQuery: current, label: "当前 DBT 自助范围之外" };
}
