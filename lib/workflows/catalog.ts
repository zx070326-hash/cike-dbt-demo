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
      { id: "emotion", label: "现在最明显的情绪", input: "short-text" },
      { id: "intensityBefore", label: "这种情绪现在有多强烈", input: "scale" },
      { id: "event", label: "刚才实际发生了什么", input: "long-text" },
      { id: "interpretation", label: "当时脑中冒出的想法", input: "long-text" },
      { id: "evidence", label: "哪些事实对得上，哪些对不上", input: "long-text" },
      { id: "fit", label: "这份情绪和事实有多对得上", input: "scale" },
      { id: "nextStep", label: "现在愿意先做哪一小步", input: "single-choice" },
      { id: "intensityAfter", label: "做到这里，情绪还有多强烈", input: "scale" },
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
      { id: "pause", label: "我有没有先停一下", input: "single-choice" },
      { id: "observation", label: "现在身体、情绪和周围发生了什么", input: "long-text" },
      { id: "effectiveAction", label: "接下来做什么更有帮助", input: "long-text" },
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
      { id: "actionUrge", label: "这份情绪催着我做什么", input: "long-text" },
      { id: "factFit", label: "这份情绪和事实对得上吗", input: "single-choice" },
      { id: "oppositeAction", label: "我准备做哪个相反的小动作", input: "long-text" },
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
      { id: "problem", label: "眼前哪一部分可以改变", input: "long-text" },
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
      { id: "vulnerabilities", label: "这件事之前，我的状态怎么样", input: "long-text" },
      { id: "promptingEvent", label: "最开始发生了什么", input: "long-text" },
      { id: "links", label: "接下来一步步发生了什么", input: "long-text" },
      { id: "consequences", label: "行为的后果", input: "long-text" },
      { id: "skillfulLinks", label: "下一次可以在哪一步停下来", input: "long-text" },
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
      { id: "nonAcceptance", label: "我正在怎样和这件事较劲", input: "long-text" },
      { id: "turningMind", label: "这一次，我准备怎样把注意力转回来", input: "long-text" },
      { id: "willingAction", label: "一个愿意采取的行动", input: "long-text" },
    ],
  },
];

export function releasedWorkflows() {
  return workflowCatalog.filter((workflow) => workflow.status === "demo-reviewed");
}
