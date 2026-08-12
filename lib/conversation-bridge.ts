import type { ChatPayload } from "./dbt-content";

const greetingPattern = /^(你好|您好|嗨|哈喽|hello|hi|在吗|早上好|上午好|下午好|晚上好)[呀啊吗呢？?！!。.,，\s]*$/iu;
const productHelpPattern = /^(开始|你是谁|你能做什么|可以做什么|怎么用|如何使用)[呀啊吗呢？?！!。.,，\s]*$/u;
const thanksPattern = /^(谢谢|谢谢你|多谢|辛苦了|明白了|知道了|好的|好吧)[呀啊吗呢？?！!。.,，\s]*$/u;
const closingPattern = /^(晚安|再见|拜拜|下次再说|先这样)[呀啊吗呢？?！!。.,，\s]*$/u;
const describeEventPattern = /^(我想)?先?(说说|讲讲)(刚才|今天)?发生了什么[呀啊吗呢？?！!。.,，\s]*$/u;

export const conversationStarterReplies = [
  "我现在情绪很强，先帮我稳定下来",
  "我在反复想一件事，想理清它",
  "我想先说说发生了什么",
] as const;

export function getSimpleConversationResponse(input: string): ChatPayload | null {
  const message = input.trim();

  if (greetingPattern.test(message)) {
    return {
      kind: "answer",
      title: "你好，我在",
      message: "你可以直接说一句今天最困扰你的事，不用先知道技能名称；也可以从下面选一个方向开始。",
      suggestedReplies: [...conversationStarterReplies],
      nextAction: "none",
      mode: "bridge",
    };
  }

  if (productHelpPattern.test(message)) {
    return {
      kind: "answer",
      title: "从你此刻最需要的帮助开始",
      message: "这里可以先听你描述困扰，再帮你选择一个有书内依据的 DBT 技能或练习。你不需要先说出专业术语。",
      suggestedReplies: [...conversationStarterReplies],
      nextAction: "none",
      mode: "bridge",
    };
  }

  if (describeEventPattern.test(message)) {
    return {
      kind: "answer",
      title: "可以，从一件具体事情开始",
      message: "不用一次讲完整，也不用先判断谁对谁错。试着只说摄像机能记录到的部分：刚才发生了什么？",
      nextAction: "none",
      mode: "bridge",
    };
  }

  if (thanksPattern.test(message)) {
    return {
      kind: "answer",
      title: "不客气",
      message: "我们可以按你的节奏继续。你可以再说一点刚才的情境，也可以先停在这里。",
      suggestedReplies: ["继续刚才的话题", "换一个困扰", "先到这里"],
      nextAction: "none",
      mode: "bridge",
    };
  }

  if (closingPattern.test(message)) {
    return {
      kind: "answer",
      title: "好，先到这里",
      message: "谢谢你说出这些。已经保存的练习仍只留在当前设备；需要时可以再回来继续。",
      nextAction: "none",
      mode: "bridge",
    };
  }

  return null;
}
