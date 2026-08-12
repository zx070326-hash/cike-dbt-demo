import type { ChatPayload } from "./dbt-content";

const greetingPattern = /^(你好|您好|嗨|哈喽|hello|hi|在吗|早上好|上午好|下午好|晚上好)[呀啊吗呢？?！!。.,，\s]*$/iu;
const productHelpPattern = /^(开始|你是谁|你能做什么|可以做什么|怎么用|如何使用)[呀啊吗呢？?！!。.,，\s]*$/u;
const thanksPattern = /^(谢谢|谢谢你|多谢|辛苦了|明白了|知道了|好的|好吧)[呀啊吗呢？?！!。.,，\s]*$/u;
const closingPattern = /^(晚安|再见|拜拜|下次再说|先这样)[呀啊吗呢？?！!。.,，\s]*$/u;
const describeEventPattern = /^(我想)?先?(说说|讲讲)(刚才|今天)?(发生了什么|发生的事)[呀啊吗呢？?！!。.,，\s]*$/u;

export const conversationStarterReplies = [
  "我现在情绪很强，想先缓一缓",
  "有件事我一直反复想，想理清楚",
  "我想先说说刚才发生的事",
] as const;

export function getSimpleConversationResponse(input: string): ChatPayload | null {
  const message = input.trim();

  if (greetingPattern.test(message)) {
    return {
      kind: "answer",
      title: "你好，我在",
      message: "你可以说说今天发生了什么，或者现在最难受的是什么。先说一句就好，不用想清楚该用什么技能。",
      suggestedReplies: [...conversationStarterReplies],
      nextAction: "none",
      mode: "bridge",
    };
  }

  if (productHelpPattern.test(message)) {
    return {
      kind: "answer",
      title: "你只要告诉我发生了什么",
      message: "我会先听懂你想处理的是情绪、反复出现的想法，还是一段关系，再从书里找一个合适的方法。你不用先知道专业名词。",
      suggestedReplies: [...conversationStarterReplies],
      nextAction: "none",
      mode: "bridge",
    };
  }

  if (describeEventPattern.test(message)) {
    return {
      kind: "answer",
      title: "好，从刚才发生的事说起",
      message: "不用一次讲完整，也不用先判断谁对谁错。先告诉我：当时在哪里、谁说了什么或做了什么？",
      nextAction: "none",
      mode: "bridge",
    };
  }

  if (thanksPattern.test(message)) {
    return {
      kind: "answer",
      title: "不客气",
      message: "我们可以慢慢来。你想继续，就再说一点刚才发生的事；想休息，也可以先停在这里。",
      suggestedReplies: ["继续说刚才的事", "换一件事说", "先到这里"],
      nextAction: "none",
      mode: "bridge",
    };
  }

  if (closingPattern.test(message)) {
    return {
      kind: "answer",
      title: "好，先到这里",
      message: "谢谢你愿意说这些。已经保存的练习只会留在这台设备上；想继续时，随时可以回来。",
      nextAction: "none",
      mode: "bridge",
    };
  }

  return null;
}
