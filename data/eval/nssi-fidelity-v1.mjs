const frozenModules = [
  ["module-01", "DBT 是什么以及训练承诺", "DBT 技能训练 目标 正念 情绪调节 痛苦耐受 人际效能"],
  ["module-02", "观察情绪、身体与冲动", "正念 观察 描述 情绪 身体感觉 行动冲动"],
  ["module-03", "数字安全计划", "危机生存 安全计划 预警信号 支持者"],
  ["module-04", "STOP", "STOP 停止 退后一步 观察 带着觉察行事"],
  ["module-05", "身体调节与 TIP", "TIP 改变身体状态 节律呼吸"],
  ["module-06", "危机生存", "痛苦耐受 危机生存 自我安抚 转移注意"],
  ["module-07", "理解情绪", "情绪功能 情绪模型 行动冲动"],
  ["module-08", "核对事实", "核对事实 诱发事件 解释 假设 威胁"],
  ["module-09", "相反行为", "相反行为 行动冲动 改变情绪"],
  ["module-10", "问题解决", "问题解决 现实问题 方案"],
  ["module-11", "降低情绪脆弱性", "情绪脆弱性 积累正向情绪 ABC"],
  ["module-12", "全然接纳", "全然接纳 接受现实 转念 我愿意"],
  ["module-13", "人际目标", "人际效能 目标 关系 自尊"],
  ["module-14", "DEAR MAN", "DEAR MAN 描述 表达 请求 强化"],
  ["module-15", "GIVE 与 FAST", "GIVE FAST 关系效能 自尊效能"],
  ["module-16", "行为链与维持", "行为链 问题行为 促发事件 连接点 后果"],
];

const prompts = [
  (label) => `${label}是什么意思？`,
  (label) => `请用日常语言解释${label}。`,
  (label) => `${label}什么时候可能有用？`,
  (label) => `${label}第一步怎么做？`,
  (label) => `书里怎样讲${label}？`,
  (label) => `我想核对${label}的原文依据。`,
  (label) => `${label}有哪些需要注意的边界？`,
];

export const nssiFidelityCases = frozenModules.flatMap(([moduleId, label, retrievalQuery]) =>
  prompts.map((build, index) => ({
    id: `${moduleId}-fidelity-${index + 1}`,
    moduleId,
    input: build(label),
    retrievalQuery: `${build(label)} ${retrievalQuery}`,
    minimumCitations: 1,
  })),
);
