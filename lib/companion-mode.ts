import type {
  ChatPayload,
  SkillCard,
  SourceCitation,
} from "./dbt-content";
import {
  hitToCitation,
  retrievalMetadata,
  type RetrievalHit,
  type RetrievalPlan,
} from "./rag";

type CompanionGuide = {
  card: SkillCard;
  title: string;
  message: string;
  question: string;
  replies: string[];
  nextAction?: "practice" | "none";
};

function includesAny(value: string, terms: string[]) {
  const normalized = value.normalize("NFKC").toLowerCase();
  return terms.some((term) => normalized.includes(term.normalize("NFKC").toLowerCase()));
}

function guideFor(query: string, plan: RetrievalPlan): CompanionGuide {
  if (plan.situation === "relationship-attachment") {
    return {
      title: "舍不得，也可以先照顾好自己",
      message:
        "你还在意，并不代表你就必须继续忍受难受。感情没有立刻消失很正常；我们先不催自己放下，也不把已经发生的事轻轻带过。",
      question: "你现在最舍不得的，是这个人、曾经被在意的感觉，还是对未来的期待？",
      replies: ["是这个人本身", "是曾经被在意的感觉", "是我想象过的未来"],
      card: {
        label: "全然接纳",
        title: "接纳现实，不等于认同现实",
        summary:
          "全然接纳，是先停止和已经发生的事实反复较劲。它不要求你喜欢这件事，也不要求你留在一段让自己受伤的关系里。",
        whyItMayHelp: "当“舍不得”和“已经受伤”同时存在时，它可以帮你先容纳这份拉扯，再决定怎样保护自己。",
        tryNow: "把这句话补完整：即使我还舍不得，今天我也愿意为自己守住……",
        takeaways: ["承认现在仍然舍不得", "同时看见已经发生的事实", "只决定今天能做的一小步"],
      },
    };
  }

  if (plan.situation === "relationship-distress") {
    return {
      title: "先别急着替这段关系下结论",
      message:
        "听起来你一边很在意，一边又被对方的态度伤到。两种感受可以同时存在。现在不用逼自己马上决定离开还是继续，先看清最近真正发生了什么。",
      question: "最近哪一件具体的事，最让你觉得自己没有被好好对待？",
      replies: ["我想说说最近那件事", "我想先看清哪些是事实", "我现在更想让难受缓一点"],
      card: {
        label: "核对事实",
        title: "感受是真的，脑中的解释还可以再核对",
        summary:
          "核对事实不是否定你的感受，而是把三件事分开：对方实际做了什么、你脑中怎样理解、这带来了什么情绪。",
        whyItMayHelp: "关系里最消耗人的，常常是事实、猜测和期待缠在一起。分开后，下一步会更清楚。",
        tryNow: "只写一件最近的小事，先不用解释对方为什么这样做。",
        takeaways: ["先记录双方实际说了什么、做了什么", "再写自己的感受和解释", "最后看自己想确认什么或守住什么"],
      },
    };
  }

  if (includesAny(query, ["正念", "智慧心", "观察", "描述", "参与", "不评判"])) {
    return {
      title: "正念不是清空大脑，而是回来看看现在",
      message:
        "如果脑中有很多想法，不需要先把它们赶走。正念更像是退半步，看见身体、想法和情绪正在发生什么，再选择怎样回应。",
      question: "你更想先练观察当下，还是想了解怎样少一点自我评判？",
      replies: ["我想先练观察", "我想少一点自我评判", "我想完整了解正念技能"],
      card: {
        label: "正念核心技能",
        title: "看见、说清、投入当下",
        summary:
          "书里把正念分成两组：观察、描述、参与，是“做什么”；不评判、专一、有效，是“怎样做”。",
        whyItMayHelp: "它不是要求你立刻平静，而是减少被想法和情绪自动带走。",
        tryNow: "花十秒钟，只描述一种身体感觉，不评价它好或坏。",
        takeaways: ["观察、描述、参与", "不评判、一次只做一件事", "选择对当前目标真正有效的行动"],
      },
    };
  }

  if (includesAny(query, ["痛苦耐受", "危机生存", "自我安抚", "改善当下"])) {
    return {
      title: "很难熬时，目标不一定是马上解决一切",
      message:
        "痛苦耐受不是让你忍着不管，而是在情绪最强、现实又暂时改不了时，先安全地度过这一段，不让情况继续变糟。",
      question: "你现在更想了解怎样撑过情绪高峰，还是怎样面对暂时改变不了的事？",
      replies: ["先撑过情绪高峰", "面对改变不了的事", "我想完整了解两类方法"],
      card: {
        label: "痛苦耐受",
        title: "一类帮助度过危机，一类帮助接纳现实",
        summary:
          "书里把痛苦耐受分成危机生存和接纳现实两类：前者先避免冲动让事情更糟，后者处理暂时改变不了的事实。",
        whyItMayHelp: "先分清自己面对的是情绪高峰还是无法立即改变的现实，才更容易选对方法。",
        tryNow: "先问自己：现在最重要的是安全度过这一刻，还是接受一个已经存在的事实？",
        takeaways: ["危机生存不是长期回避", "接纳不等于赞成", "能解决的问题仍然要解决"],
      },
    };
  }

  const wantsInterpersonal = plan.route === "interpersonal" || (
    plan.kind === "direct" && includesAny(query, ["dear man", "dearman", "give", "fast"])
  );
  if (wantsInterpersonal) {
    return {
      title: "难开口时，先把最重要的那句话留下",
      message:
        "你可能既想把话说清楚，又担心关系变得更僵。先不用准备一整段完美的话，我们只找出你最希望对方听懂的一件事。",
      question: "这次谈话里，你最想得到一个结果、顾好关系，还是不再委屈自己？",
      replies: ["我最想把请求说清楚", "我更在意关系别变僵", "我不想再委屈自己"],
      card: {
        label: "人际效能",
        title: "先分清这次谈话最重要的目标",
        summary:
          "DBT 会把人际沟通里的目标分开看：把事情办成、照顾关系、守住自尊。三者都重要，但一次谈话通常需要排出先后。",
        whyItMayHelp: "先知道自己最想守住什么，表达时就不容易被争论带跑。",
        tryNow: "用一句话写下：这次谈完以后，我最希望发生的是……",
        takeaways: ["说双方都能确认的事实", "表达感受和明确请求", "谈偏时回到最重要的目标"],
      },
    };
  }

  const wantsAcceptance = plan.route === "acceptance" || includesAny(query, [
    "接受不了", "改变不了", "已经发生", "挽回不了", "全然接纳", "彻底接纳",
  ]);
  if (wantsAcceptance) {
    return {
      title: "有些痛苦，不需要今天就想通",
      message:
        "听起来你一直在和一件已经发生、却很难接受的事较劲。先不用说服自己它是对的；我们只是试着少消耗一点力气。",
      question: "你现在最难接受的，是事情已经发生，还是它带来的某个结果？",
      replies: ["是事情已经发生", "是它带来的结果", "我还说不清，但很抗拒"],
      card: {
        label: "全然接纳",
        title: "接纳，是承认事实已经在这里",
        summary:
          "接纳不是赞成、原谅或放弃改变，而是不再要求现实必须先变成另一个样子，自己才能继续往下走。",
        whyItMayHelp: "当事情暂时不能改变时，停止反复对抗事实，能把力气留给仍然可以选择的部分。",
        tryNow: "轻声补一句：我不喜欢这件事，但现在能确认的事实是……",
        takeaways: ["先区分痛苦和对痛苦的反复对抗", "承认事实不等于认同", "把注意力放回仍能选择的行动"],
      },
    };
  }

  const wantsDistress = plan.route === "distress-survival" || includesAny(query, [
    "stop", "tip", "情绪很强", "脑子很乱", "冷静不下来", "崩溃", "先缓",
  ]);
  if (wantsDistress) {
    return {
      title: "先让这一阵情绪有地方落下来",
      message:
        "听起来这股情绪来得很满。现在不急着把事情分析清楚，也不要求自己马上平静；先给冲动和行动之间留一点距离。",
      question: "你现在更需要停下来一分钟，还是先让身体慢慢缓一点？",
      replies: ["我想先停一分钟", "我想先让身体缓一点", "我想说说刚才发生了什么"],
      card: {
        label: "STOP",
        title: "情绪最强时，先不要被冲动推着走",
        summary:
          "STOP 的重点不是赶走情绪，而是先停下、退一步、观察，再带着觉察决定下一步。",
        whyItMayHelp: "情绪很强时，先减少冲动行动，通常比立刻解决整件事更现实。",
        tryNow: "双脚踩地，先暂停要做的动作，然后说出你现在看到的三样东西。",
        takeaways: ["停止动作", "退后一步并观察", "想清真正想要的结果再行动"],
      },
    };
  }

  const wantsBehaviorChain = plan.route === "behavior-chain" || includesAny(query, [
    "行为链", "链式分析", "反复做", "总是冲动", "事后后悔",
  ]);
  if (wantsBehaviorChain) {
    return {
      title: "这不是突然发生的，我们可以往前找一找",
      message:
        "你注意到同一种反应反复出现，这已经是一个很重要的线索。先不急着责怪自己，我们把它倒回去看，通常能找到一个可以改变的小环节。",
      question: "最近一次发生时，最先把整件事推起来的是什么？",
      replies: ["我想从最近一次说起", "当时身体已经很累", "我只记得后来很后悔"],
      card: {
        label: "行为链分析",
        title: "把一次失控拆成一连串可以看见的环节",
        summary:
          "行为链会按时间看：之前的状态、触发事件、想法和身体反应、做出的行为，以及最后的结果。",
        whyItMayHelp: "把“我怎么又这样”变成具体环节后，才更容易找到下次能换一种做法的位置。",
        tryNow: "只选最近一次，不分析一整类问题：那天事情发生前，你的身体和状态怎么样？",
        takeaways: ["从一次具体事件开始", "按时间而不是按对错回看", "寻找最早可以暂停或换做法的环节"],
      },
    };
  }

  const wantsFacts = plan.route === "emotion-facts" || includesAny(query, [
    "核对事实", "担心", "焦虑", "反复想", "是不是", "一定", "想多了",
  ]);
  if (wantsFacts) {
    return {
      title: "先把发生的事和脑中的解释分开放",
      message:
        "一件事在脑子里反复转时，发生过的事和我们对它的解释很容易黏在一起。感受是真的，但脑中最吓人的结论不一定已经被证实。",
      question: "如果只写你亲眼看到或亲耳听到的内容，刚才到底发生了什么？",
      replies: ["能确认的事实是……", "我脑中一直在想……", "我分不清事实和猜测"],
      card: {
        label: "核对事实",
        title: "不是和情绪争辩，而是看看它依据了什么",
        summary:
          "核对事实会把诱发事件、解释和情绪分开，再检查威胁、预测和最坏结果有没有足够证据。",
        whyItMayHelp: "当担心主要由猜测推动时，分开事实和解释，可以让下一步更贴近现实。",
        tryNow: "先写一句不带“他觉得”“一定”“肯定”的事件描述。",
        takeaways: ["只写能观察到的事件", "找出脑中的解释和假设", "再看情绪强度是否与事实相符"],
      },
      nextAction: "practice",
    };
  }

  return {
    title: "先找到这股难受最明显的地方",
    message:
      "不用急着把原因讲完整，也不用马上找到解决办法。先看看这份感受主要落在身体、想法还是行动冲动上，会更容易找到贴合的方法。",
    question: "此刻最明显的是身体绷着或坐不住、脑中的想法停不下来，还是很想马上做点什么？",
    replies: ["身体最明显，想先缓下来", "脑中的想法停不下来", "我很想马上做点什么"],
    card: {
      label: "观察与描述",
      title: "先看见，再用简单的话说出来",
      summary:
        "正念中的观察与描述，是先留意身体、想法和情绪，再用尽量不评判的语言把它说出来。",
      whyItMayHelp: "当感受很混乱时，先把它说清一点，不必急着解释全部原因。",
      tryNow: "补完这句话：我注意到身体有……，心里更像是……",
      takeaways: ["先观察，不急着改变", "描述正在发生的体验", "少用“我不该这样”之类的评判"],
    },
  };
}

export function companionRetrievalQuery(query: string, plan: RetrievalPlan) {
  if (plan.kind !== "clarify") return plan.retrievalQuery;
  return `${query} 正念 观察 描述 了解并命名情绪 情绪调节`;
}

export function buildCompanionFallback(
  query: string,
  hits: RetrievalHit[],
  plan: RetrievalPlan,
  generationStatus?: "rejected" | "error",
): ChatPayload {
  const guide = guideFor(query, plan);
  const citations: SourceCitation[] = hits.slice(0, 3).map(hitToCitation);
  return {
    kind: "answer",
    title: guide.title,
    message: guide.message,
    followUpQuestion: guide.question,
    skillCard: guide.card,
    suggestedReplies: guide.replies,
    citations,
    nextAction: guide.nextAction ?? "none",
    mode: "guided",
    experienceMode: "companion",
    generation: generationStatus
      ? { attempted: true, status: generationStatus }
      : undefined,
    retrieval: retrievalMetadata(companionRetrievalQuery(query, plan), hits),
  };
}
