"use client";

import { ArrowRight, BookOpen, ChevronDown, ExternalLink } from "lucide-react";
import type { ChatPayload, ExperienceMode, SourceCitation } from "../../lib/dbt-content";

type Branch = {
  label: string;
  prompt?: string;
  action?: "practice";
};

type ConversationAnswerProps = {
  payload?: ChatPayload;
  mode: ExperienceMode;
  sources: SourceCitation[];
  isLatest: boolean;
  busy: boolean;
  onPrompt: (prompt: string) => void;
  onPractice: () => void;
  onSource: (source: SourceCitation) => void;
};

function pageLabel(source: SourceCitation) {
  return source.printedPage
    ? `书中 ${source.printedPage} 页`
    : `PDF ${source.pdfPage} 页`;
}

function uniqueBranches(payload: ChatPayload | undefined, mode: ExperienceMode): Branch[] {
  const supplied = (payload?.suggestedReplies ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, 2)
    .map((item) => ({ label: item, prompt: item }));

  if (mode === "deep-read") {
    return [
      ...supplied,
      { label: "举个贴近生活的例子", prompt: "请用一个贴近生活的例子解释，并说明什么时候适合用、什么时候不适合用。" },
    ].slice(0, 3);
  }

  const defaults: Branch[] = [
    supplied[0] ?? { label: "我想继续说说", prompt: "我想先继续说说这件事，请先听我说，再问我一个容易回答的问题。" },
    { label: "帮我理清原因", prompt: "先别急着给更多方法，帮我理一理这件事为什么会让我这么难受。" },
    { label: "现在练一小步", action: "practice" },
  ];
  return defaults;
}

export function ConversationAnswer({
  payload,
  mode,
  sources,
  isLatest,
  busy,
  onPrompt,
  onPractice,
  onSource,
}: ConversationAnswerProps) {
  const kind = payload?.kind ?? "answer";
  const branches = uniqueBranches(payload, mode);
  const label = kind === "crisis"
    ? "先把安全放在第一位"
    : kind === "refusal" && payload?.mode === "safety"
      ? "这件事需要专业人员判断"
      : kind === "refusal" && payload?.refusalReason === "out-of-scope"
        ? "这个问题超出当前体验范围"
        : kind === "refusal"
          ? "这次没有顺利接上"
      : mode === "companion"
        ? payload?.skillCard ? "听见你，也带来一个可能有用的方法" : "我在听"
        : "根据书中内容整理";

  return (
    <>
      <div className="assistant-label">
        <span aria-hidden="true">◎</span>
        {label}
      </div>
      <h2>{payload?.title || (kind === "refusal" ? "这件事值得更稳妥地处理" : "我们慢慢来")}</h2>
      <p>{payload?.message || "刚才的回答没有完整显示。你可以换个说法再试一次。"}</p>

      {payload?.followUpQuestion && (
        <div className="next-question">
          <span>如果愿意，我们先只说这一点</span>
          <p>{payload.followUpQuestion}</p>
        </div>
      )}

      {!!payload?.steps?.length && !payload.skillCard && (
        <ol className="answer-steps compact-steps">
          {payload.steps.slice(0, mode === "companion" ? 3 : 6).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}

      {payload?.skillCard && (
        <section className="knowledge-glimpse" aria-label={`相关知识：${payload.skillCard.label}`}>
          <div className="knowledge-glimpse-head">
            <span className="skill-card-icon"><BookOpen size={16} aria-hidden="true" /></span>
            <div>
              <small>这段话背后的 DBT 方法</small>
              <strong>{payload.skillCard.label}</strong>
            </div>
          </div>
          <p>{payload.skillCard.summary}</p>
          <div className="try-one-step">
            <span>现在只试一小步</span>
            <p>{payload.skillCard.tryNow}</p>
          </div>
          <details className="knowledge-more">
            <summary>多了解一点这个方法 <ChevronDown size={15} aria-hidden="true" /></summary>
            <div>
              <h3>{payload.skillCard.title}</h3>
              <p>{payload.skillCard.whyItMayHelp}</p>
              {!!payload.skillCard.takeaways?.length && (
                <ul>
                  {payload.skillCard.takeaways.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
            </div>
          </details>
        </section>
      )}

      {kind === "crisis" && (
        <div className="crisis-actions" aria-label="立即求助方式">
          <a href="tel:12356">拨打 12356</a>
          <a href="tel:120">紧急情况拨打 120</a>
        </div>
      )}

      {!!sources.length && (
        <details className="sources-disclosure">
          <summary>
            <span><BookOpen size={15} aria-hidden="true" />查看书本依据（{sources.length}）</span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div>
            {sources.map((source) => (
              <button key={source.id} type="button" onClick={() => onSource(source)}>
                <span>
                  <strong>{source.section}</strong>
                  <small>{pageLabel(source)}</small>
                </span>
                <ExternalLink size={14} aria-hidden="true" />
              </button>
            ))}
            <p>卡片是通俗转述。点击来源可查看定位到的原页或 OCR 文本。</p>
          </div>
        </details>
      )}

      {payload?.nextAction === "practice" && !isLatest && (
        <button className="primary-inline" type="button" onClick={onPractice}>
          跟着做一遍 <ArrowRight size={15} aria-hidden="true" />
        </button>
      )}

      {isLatest && !busy && kind === "answer" && (
        <div className="conversation-branches" aria-label="接下来想怎么继续">
          <span>{mode === "companion" ? "接下来，你更想——" : "接下来可以——"}</span>
          <div>
            {branches.map((branch) => (
              <button
                key={branch.label}
                type="button"
                onClick={() => branch.action === "practice" ? onPractice() : onPrompt(branch.prompt ?? branch.label)}
              >
                {branch.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
