import type { ProtocolModule } from "./types";

const sharedScale = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

function moduleDefinition(
  value: Omit<ProtocolModule, "id" | "shortTitle" | "releaseDay" | "prerequisiteIds" | "reviewStatus" | "contentVersion"> & {
    shortTitle?: string;
  },
): ProtocolModule {
  const id = `module-${String(value.ordinal).padStart(2, "0")}`;
  return {
    ...value,
    id,
    shortTitle: value.shortTitle ?? value.title,
    releaseDay: value.ordinal % 2 === 1 ? "monday" : "thursday",
    prerequisiteIds: value.ordinal === 1 ? [] : [`module-${String(value.ordinal - 1).padStart(2, "0")}`],
    reviewStatus: "draft-internal",
    contentVersion: "nssi-phase1-content-0.1",
  };
}

/**
 * This is the protocol catalogue, not AI-authored treatment advice. Every
 * module stays visibly draft-internal until a clinical reviewer activates the
 * corresponding content version.
 */
export const nssiPhase1Modules: ProtocolModule[] = [
  moduleDefinition({
    ordinal: 1, week: 1, title: "开始使用：目标、边界与求助路径", shortTitle: "开始使用",
    purpose: "知道这个工具能做什么、不能做什么，并完成第一份个人支持地图。",
    introduction: "先建立共同规则：自助训练负责帮助你观察、练习和记录；诊断、治疗决策与紧急处置仍由现实中的专业人员承担。",
    estimatedMinutes: 12, skillCardIds: ["mindfulness-what"], sourceQueries: ["DBT 正念 观察 描述 参与"],
    exercise: { id: "support-map", title: "我的支持地图", prompt: "写下需要帮助时可以联系的人和现实资源。", fields: [
      { id: "goal", label: "这八周我最想改善的一件事", kind: "textarea", required: true },
      { id: "support", label: "我愿意联系的一位支持者", kind: "text", required: true },
    ] },
  }),
  moduleDefinition({
    ordinal: 2, week: 1, title: "看见情绪、身体与冲动", shortTitle: "识别当下",
    purpose: "在自动行动前，辨认情绪、身体反应和行动冲动。",
    introduction: "准确观察并不是给自己下结论，而是把混在一起的体验拆成可以处理的信息。",
    estimatedMinutes: 15, skillCardIds: ["mindfulness-what", "emotion-understand"], sourceQueries: ["观察 描述 情绪 身体反应 行动冲动"],
    exercise: { id: "notice-now", title: "一分钟观察", prompt: "只描述此刻能观察到的内容，不解释原因。", fields: [
      { id: "emotion", label: "最接近的情绪", kind: "text", required: true },
      { id: "body", label: "身体最明显的感觉", kind: "text", required: true },
      { id: "urge", label: "行动冲动强度", kind: "scale", required: true, options: sharedScale },
    ] },
  }),
  moduleDefinition({
    ordinal: 3, week: 2, title: "建立我的数字安全计划", shortTitle: "安全计划",
    purpose: "在平静时准备一条可以在高风险时直接照着走的求助路径。",
    introduction: "安全计划不是一句提醒，而是由预警信号、内部应对、支持者、专业资源和环境安全等部分组成的行动清单。",
    estimatedMinutes: 25, skillCardIds: ["distress-crisis-survival"], sourceQueries: ["DBT 危机生存技能 痛苦耐受 安全"],
    exercise: { id: "safety-plan", title: "完成安全计划", prompt: "分段填写并保存；之后每次修改都会保留版本。", fields: [
      { id: "warningSigns", label: "我的预警信号", kind: "textarea", required: true },
      { id: "internalCoping", label: "我可以先做的内部应对", kind: "textarea", required: true },
      { id: "supportContacts", label: "我可以联系的人", kind: "textarea", required: true },
    ] },
  }),
  moduleDefinition({
    ordinal: 4, week: 2, title: "在冲动前停一下：STOP", shortTitle: "STOP",
    purpose: "在情绪和冲动快速升高时，为下一步创造短暂停顿。",
    introduction: "STOP 不负责一次解决问题，它先帮助你停止自动行动、退后、观察，再选择更符合目标的下一步。",
    estimatedMinutes: 18, skillCardIds: ["distress-stop", "distress-crisis-survival"], sourceQueries: ["STOP 停止动作 退后一步 客观观察 带着觉察行事"],
    exercise: { id: "stop-rehearsal", title: "预演一次 STOP", prompt: "选择一个常见触发场景，提前写下四步。", fields: [
      { id: "situation", label: "触发场景", kind: "textarea", required: true },
      { id: "stopPlan", label: "我的四步预演", kind: "textarea", required: true },
    ] },
  }),
  moduleDefinition({
    ordinal: 5, week: 3, title: "先调节身体的高唤起", shortTitle: "调节身体",
    purpose: "当身体过度激活、难以思考时，先用适合自身条件的方法降低唤起。",
    introduction: "身体调节是短时稳定手段。涉及温度或运动的练习需要先确认自身身体条件；不确定时从节律呼吸开始。",
    estimatedMinutes: 16, skillCardIds: ["distress-tip"], sourceQueries: ["TIP 体温 强烈运动 节律呼吸 配对肌肉放松"],
    exercise: { id: "body-regulation", title: "选择安全的身体调节", prompt: "选择适合自己的一个动作并记录前后强度。", fields: [
      { id: "method", label: "选择的方法", kind: "multi-select", required: true, options: ["节律呼吸", "肌肉放松", "短时活动（身体条件允许）"] },
      { id: "before", label: "练习前强度", kind: "scale", required: true, options: sharedScale },
      { id: "after", label: "练习后强度", kind: "scale", required: true, options: sharedScale },
    ] },
  }),
  moduleDefinition({
    ordinal: 6, week: 3, title: "安全度过情绪高峰", shortTitle: "危机生存",
    purpose: "在问题暂时无法解决时，选择不会让情况恶化的短时应对。",
    introduction: "危机生存技能服务于短时高峰，并不替代之后的问题解决、专业帮助或现实安全行动。",
    estimatedMinutes: 18, skillCardIds: ["distress-crisis-survival"], sourceQueries: ["痛苦耐受 危机生存 转移注意 自我安抚 改善当下"],
    exercise: { id: "survival-menu", title: "建立我的短时技能菜单", prompt: "为不同强度各选一个可以执行的安全动作。", fields: [
      { id: "medium", label: "中等强度时", kind: "textarea", required: true },
      { id: "high", label: "高强度时", kind: "textarea", required: true },
    ] },
  }),
  moduleDefinition({
    ordinal: 7, week: 4, title: "理解情绪在传递什么", shortTitle: "理解情绪",
    purpose: "识别情绪的诱因、功能、行动冲动与后果。",
    introduction: "情绪提供信息，但不是所有解释都等于事实。先理解它在推动什么，再决定是否跟随。",
    estimatedMinutes: 17, skillCardIds: ["emotion-understand"], sourceQueries: ["理解并命名情绪 情绪功能 行动冲动"],
    exercise: { id: "emotion-map", title: "画出一次情绪反应", prompt: "从最近一次具体事件开始。", fields: [
      { id: "event", label: "发生了什么", kind: "textarea", required: true },
      { id: "emotion", label: "情绪与身体反应", kind: "textarea", required: true },
      { id: "actionUrge", label: "它推动我做什么", kind: "textarea", required: true },
    ] },
  }),
  moduleDefinition({
    ordinal: 8, week: 4, title: "把事实和解释分开", shortTitle: "核对事实",
    purpose: "检查情绪是否被未确认的解释、假设或最坏预测推高。",
    introduction: "核对事实不会否定真实感受；它帮助我们分清摄像机能记录的内容和脑中对这些内容的解释。",
    estimatedMinutes: 20, skillCardIds: ["emotion-check-facts"], sourceQueries: ["核对事实 诱发事件 解释 假设 威胁 最坏结果"],
    exercise: { id: "check-facts", title: "核对一次事实", prompt: "把事实、解释与最坏预测分别写下。", fields: [
      { id: "facts", label: "可观察的事实", kind: "textarea", required: true },
      { id: "interpretation", label: "我的解释或假设", kind: "textarea", required: true },
      { id: "alternative", label: "还可能有哪些解释", kind: "textarea", required: false },
    ] },
  }),
  moduleDefinition({
    ordinal: 9, week: 5, title: "当冲动不符合事实：相反行动", shortTitle: "相反行动",
    purpose: "当情绪或强度不符合事实时，用完整的相反行动改变情绪。",
    introduction: "相反行动不是压住情绪。使用前必须先核对事实，并确认相反行动不会忽视真实危险。",
    estimatedMinutes: 20, skillCardIds: ["emotion-opposite-action", "emotion-check-facts"], sourceQueries: ["相反行动 情绪不符合事实 行动冲动"],
    exercise: { id: "opposite-action", title: "设计一次相反行动", prompt: "从行动冲动开始，设计一个安全、完整的相反动作。", fields: [
      { id: "urge", label: "情绪推动我做什么", kind: "textarea", required: true },
      { id: "factCheck", label: "它是否符合事实", kind: "text", required: true },
      { id: "opposite", label: "完整的相反行动", kind: "textarea", required: true },
    ] },
  }),
  moduleDefinition({
    ordinal: 10, week: 5, title: "当现实可以改变：问题解决", shortTitle: "问题解决",
    purpose: "把真实且可改变的问题转化为具体行动。",
    introduction: "如果情绪符合事实，而且现实问题可以改变，就需要定义问题、比较方案并执行，而不只是反复分析感受。",
    estimatedMinutes: 20, skillCardIds: ["emotion-problem-solving"], sourceQueries: ["问题解决 定义问题 产生方案 选择方案 执行"],
    exercise: { id: "problem-solving", title: "解决一个具体问题", prompt: "选择一个范围足够小的问题。", fields: [
      { id: "problem", label: "具体、可观察的问题", kind: "textarea", required: true },
      { id: "options", label: "至少两个方案", kind: "textarea", required: true },
      { id: "next", label: "24 小时内的一步", kind: "textarea", required: true },
    ] },
  }),
  moduleDefinition({
    ordinal: 11, week: 6, title: "降低情绪脆弱性", shortTitle: "日常预防",
    purpose: "通过照顾身体、积累正向体验和建立掌控感，减少容易失控的条件。",
    introduction: "预防不是要求生活完美，而是找出一个对情绪影响最大的可改变因素。身体症状仍需由医疗专业人员评估。",
    estimatedMinutes: 18, skillCardIds: ["emotion-vulnerability"], sourceQueries: ["降低情绪脆弱性 PLEASE 积累正向情绪 建立掌控感"],
    exercise: { id: "vulnerability-plan", title: "选一个本周变量", prompt: "只选择一个最值得先改善的因素。", fields: [
      { id: "factor", label: "最影响我的因素", kind: "text", required: true },
      { id: "smallChange", label: "本周可以做到的小变化", kind: "textarea", required: true },
    ] },
  }),
  moduleDefinition({
    ordinal: 12, week: 6, title: "面对暂时改变不了的事实", shortTitle: "全然接纳",
    purpose: "减少与已经存在的现实持续对抗所增加的痛苦。",
    introduction: "接纳不是赞同、原谅或放弃改变，而是承认这一刻的现实，再决定仍然能够做什么。",
    estimatedMinutes: 20, skillCardIds: ["distress-radical-acceptance"], sourceQueries: ["全然接纳 转念 我愿意 接纳不是认命"],
    exercise: { id: "acceptance", title: "练习一次接纳", prompt: "只选择一个当前暂时无法改变的事实。", fields: [
      { id: "fact", label: "暂时无法改变的事实", kind: "textarea", required: true },
      { id: "choice", label: "即使如此，我仍能选择", kind: "textarea", required: true },
    ] },
  }),
  moduleDefinition({
    ordinal: 13, week: 7, title: "分清人际互动的优先级", shortTitle: "人际目标",
    purpose: "在获得结果、维护关系与维护自尊之间决定本次互动重点。",
    introduction: "不同对话不需要追求同一个结果。先确定优先级，才能选择合适的表达技能。",
    estimatedMinutes: 16, skillCardIds: ["interpersonal-priorities"], sourceQueries: ["人际效能 目标效能 关系效能 自尊效能 优先级"],
    exercise: { id: "interpersonal-priority", title: "给一次对话排优先级", prompt: "只针对一场具体对话排序。", fields: [
      { id: "conversation", label: "我要进行的对话", kind: "textarea", required: true },
      { id: "priority", label: "第一优先", kind: "multi-select", required: true, options: ["得到具体结果", "维护关系", "维护自尊"] },
    ] },
  }),
  moduleDefinition({
    ordinal: 14, week: 7, title: "清楚提出请求与界限：DEAR MAN", shortTitle: "DEAR MAN",
    purpose: "围绕目标描述事实、表达感受并提出具体请求。",
    introduction: "DEAR MAN 适用于安全关系中的请求、拒绝和坚持立场；存在控制或暴力风险时应先处理现实安全。",
    estimatedMinutes: 22, skillCardIds: ["interpersonal-dear-man"], sourceQueries: ["DEAR MAN 描述 表达 明确请求 强化 正念 自信 协商"],
    exercise: { id: "dear-man", title: "写一份沟通草稿", prompt: "针对一件具体事情写下核心表达。", fields: [
      { id: "describe", label: "双方能确认的事实", kind: "textarea", required: true },
      { id: "assert", label: "我的具体请求或界限", kind: "textarea", required: true },
      { id: "negotiate", label: "可以协商的部分", kind: "textarea", required: false },
    ] },
  }),
  moduleDefinition({
    ordinal: 15, week: 8, title: "在关系中同时尊重彼此", shortTitle: "GIVE 与 FAST",
    purpose: "在维护关系的同时，不以过度委屈自己为代价。",
    introduction: "GIVE 帮助维护互动质量，FAST 帮助维护自尊。两者都不能被用来掩盖现实中的伤害或安全风险。",
    estimatedMinutes: 20, skillCardIds: ["interpersonal-give", "interpersonal-fast"], sourceQueries: ["GIVE FAST 温和 表现兴趣 确认 维护自尊 公平 价值观 诚实"],
    exercise: { id: "give-fast", title: "准备一场兼顾关系与自尊的对话", prompt: "各选一个最需要提醒自己的动作。", fields: [
      { id: "relationship", label: "我想怎样维护关系", kind: "textarea", required: true },
      { id: "selfRespect", label: "我需要守住什么", kind: "textarea", required: true },
    ] },
  }),
  moduleDefinition({
    ordinal: 16, week: 8, title: "回看行为链，准备下一次不同选择", shortTitle: "行为链与巩固",
    purpose: "从最近一次具体事件中找到可改变的最早环节，并形成持续使用计划。",
    introduction: "行为链用于理解事件怎样一步步发展，不用于责怪自己。先找到一个可以更早介入的环节，再把有效技能放进未来计划。",
    estimatedMinutes: 25, skillCardIds: ["behavior-chain", "behavior-missing-links"], sourceQueries: ["行为链 脆弱因素 促发事件 连接点 后果 缺失环节"],
    exercise: { id: "chain-maintenance", title: "完成一次行为链与巩固计划", prompt: "选择最近一次具体事件，找到最早可改变的一环。", fields: [
      { id: "chain", label: "事件如何一步步发展", kind: "textarea", required: true },
      { id: "changePoint", label: "下次最早的改变点", kind: "textarea", required: true },
      { id: "maintenance", label: "我准备继续保留的技能", kind: "textarea", required: true },
    ] },
  }),
];

export const modulesById = new Map(nssiPhase1Modules.map((module) => [module.id, module]));

export function assertCurriculumIntegrity() {
  if (nssiPhase1Modules.length !== 16) throw new Error("NSSI phase 1 must contain exactly 16 modules");
  for (const [index, module] of nssiPhase1Modules.entries()) {
    if (module.ordinal !== index + 1) throw new Error(`Module ordinal mismatch: ${module.id}`);
    if (module.week !== Math.floor(index / 2) + 1) throw new Error(`Module week mismatch: ${module.id}`);
    if (module.ordinal > 1 && module.prerequisiteIds[0] !== nssiPhase1Modules[index - 1].id) {
      throw new Error(`Module prerequisite mismatch: ${module.id}`);
    }
  }
  return true;
}
