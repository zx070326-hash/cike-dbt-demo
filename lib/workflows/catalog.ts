export type WorkflowStatus = "demo-reviewed" | "professional-review-required";

export type WorkflowField = {
  id: string;
  label: string;
  input: "short-text" | "long-text" | "scale" | "single-choice" | "multi-choice";
  optional?: boolean;
};

export type WorkflowDefinition = {
  id: string;
  version: string;
  label: string;
  module: string;
  wikiNodeId: string;
  status: WorkflowStatus;
  fields: WorkflowField[];
};

// Definitions are product state machines, not generated conversations. Only
// workflows with the required review status may be exposed to end users.
export const workflowCatalog: WorkflowDefinition[] = [
  {
    id: "check-facts",
    version: "1.0",
    label: "核对事实",
    module: "emotion-regulation",
    wikiNodeId: "emotion-check-facts",
    status: "demo-reviewed",
    fields: [
      { id: "emotion", label: "想调整的主要情绪", input: "short-text" },
      { id: "intensityBefore", label: "练习前强度", input: "scale" },
      { id: "event", label: "可观察到的诱发事件", input: "long-text" },
      { id: "interpretation", label: "脑中出现的解释、假设或预测", input: "long-text" },
      { id: "evidence", label: "支持与不支持这些解释的事实", input: "long-text" },
      { id: "fit", label: "情绪与事实的匹配程度", input: "scale" },
      { id: "nextStep", label: "一个负担较低的下一步", input: "single-choice" },
      { id: "intensityAfter", label: "练习后强度", input: "scale" },
    ],
  },
  {
    id: "stop",
    version: "0.1",
    label: "STOP",
    module: "distress-tolerance",
    wikiNodeId: "distress-stop",
    status: "professional-review-required",
    fields: [
      { id: "trigger", label: "刚才发生了什么", input: "long-text", optional: true },
      { id: "pause", label: "我是否已经暂停当前冲动", input: "single-choice" },
      { id: "observation", label: "此刻内在和外在发生了什么", input: "long-text" },
      { id: "effectiveAction", label: "接下来最有效的一步", input: "long-text" },
    ],
  },
  {
    id: "tip",
    version: "0.1",
    label: "TIP",
    module: "distress-tolerance",
    wikiNodeId: "distress-tip",
    status: "professional-review-required",
    fields: [
      { id: "intensityBefore", label: "练习前强度", input: "scale" },
      { id: "selectedPractice", label: "采用的身体调节练习", input: "single-choice" },
      { id: "intensityAfter", label: "练习后强度", input: "scale" },
    ],
  },
  {
    id: "opposite-action",
    version: "0.1",
    label: "相反行为",
    module: "emotion-regulation",
    wikiNodeId: "emotion-opposite-action",
    status: "professional-review-required",
    fields: [
      { id: "emotion", label: "当前情绪", input: "short-text" },
      { id: "actionUrge", label: "当前行动冲动", input: "long-text" },
      { id: "factFit", label: "情绪是否符合事实", input: "single-choice" },
      { id: "oppositeAction", label: "准备完整采取的相反行为", input: "long-text" },
    ],
  },
  {
    id: "problem-solving",
    version: "0.1",
    label: "问题解决",
    module: "emotion-regulation",
    wikiNodeId: "emotion-problem-solving",
    status: "professional-review-required",
    fields: [
      { id: "problem", label: "可以改变的现实问题", input: "long-text" },
      { id: "goal", label: "希望达到的结果", input: "short-text" },
      { id: "options", label: "可能的解决办法", input: "long-text" },
      { id: "chosenAction", label: "准备尝试的办法", input: "long-text" },
      { id: "review", label: "结果与下一次调整", input: "long-text", optional: true },
    ],
  },
  {
    id: "dear-man",
    version: "0.1",
    label: "DEAR MAN",
    module: "interpersonal-effectiveness",
    wikiNodeId: "interpersonal-dear-man",
    status: "professional-review-required",
    fields: [
      { id: "objective", label: "这次沟通的主要目标", input: "short-text" },
      { id: "describe", label: "描述情境", input: "long-text" },
      { id: "express", label: "表达感受或看法", input: "long-text" },
      { id: "assert", label: "明确请求或立场", input: "long-text" },
      { id: "reinforce", label: "说明积极结果", input: "long-text" },
      { id: "mindful", label: "保持专注的提醒", input: "short-text" },
      { id: "appear", label: "表现自信的方式", input: "short-text" },
      { id: "negotiate", label: "可以协商的空间", input: "long-text" },
    ],
  },
  {
    id: "behavior-chain",
    version: "0.1",
    label: "行为链分析",
    module: "behavior-analysis",
    wikiNodeId: "behavior-chain",
    status: "professional-review-required",
    fields: [
      { id: "targetBehavior", label: "要分析的问题行为", input: "long-text" },
      { id: "vulnerabilities", label: "此前的脆弱因素", input: "long-text" },
      { id: "promptingEvent", label: "促发事件", input: "long-text" },
      { id: "links", label: "按时间顺序记录中间环节", input: "long-text" },
      { id: "consequences", label: "行为的后果", input: "long-text" },
      { id: "skillfulLinks", label: "可以插入技能的连接点", input: "long-text" },
    ],
  },
  {
    id: "radical-acceptance",
    version: "0.1",
    label: "全然接纳",
    module: "distress-tolerance",
    wikiNodeId: "distress-radical-acceptance",
    status: "professional-review-required",
    fields: [
      { id: "reality", label: "当前无法立即改变的事实", input: "long-text" },
      { id: "nonAcceptance", label: "不接纳如何表现", input: "long-text" },
      { id: "turningMind", label: "这一次准备怎样转念", input: "long-text" },
      { id: "willingAction", label: "一个愿意采取的行动", input: "long-text" },
    ],
  },
];

export function releasedWorkflows() {
  return workflowCatalog.filter((workflow) => workflow.status === "demo-reviewed");
}
