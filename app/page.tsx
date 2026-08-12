"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  BookOpen,
  ExternalLink,
  Home as HomeIcon,
  ListChecks,
  MessageCircle,
  NotebookText,
  Send,
  ShieldAlert,
  Sparkles,
  Wind,
} from "lucide-react";
import knowledgeManifest from "../data/knowledge/manifest-v2.json";
import {
  ChatPayload,
  SourceCitation,
  sourceCitations,
} from "../lib/dbt-content";

type Tab = "home" | "chat" | "skills" | "practice" | "records";

type Message = {
  id: string;
  role: "user" | "assistant";
  text?: string;
  payload?: ChatPayload;
};

type PracticeRecord = {
  id: string;
  createdAt: string;
  emotion: string;
  intensityBefore: string;
  intensityAfter: string;
  event: string;
  interpretation: string;
  facts: string;
  fit: string;
  nextStep: string;
};

const practiceSteps = [
  {
    id: "emotion",
    eyebrow: "步骤 1 · 命名情绪",
    title: "你想调整哪一种情绪？",
    helper: "写下一个最主要的情绪，并估计练习前的强度。",
  },
  {
    id: "event",
    eyebrow: "步骤 2 · 描述事件",
    title: "摄像机能记录到什么？",
    helper: "只写可观察的事实：谁在何时做了什么，不加入动机推测。",
  },
  {
    id: "interpretation",
    eyebrow: "步骤 3 · 找出解释",
    title: "你对这件事作了什么解释？",
    helper: "写下脑中出现的想法、假设和预测。它们现在还不是事实。",
  },
  {
    id: "facts",
    eyebrow: "步骤 4 · 核对证据",
    title: "哪些事实支持或不支持这些解释？",
    helper: "同时列出两边的证据，并考虑其他可能的解释。",
  },
  {
    id: "fit",
    eyebrow: "步骤 5 · 评估匹配度",
    title: "这份情绪和当前事实有多匹配？",
    helper: "0 表示几乎不匹配，5 表示非常匹配。暂时不确定也可以。",
  },
  {
    id: "nextStep",
    eyebrow: "步骤 6 · 选择下一步",
    title: "现在最稳妥的下一步是什么？",
    helper: "先选一个负担较低、可以实际完成的动作。",
  },
] as const;

const quickPrompts = [
  "我脑子很乱，不知道从哪里开始",
  "什么是核对事实？",
  "痛苦耐受有哪些技能？",
  "DEAR MAN 是什么？",
];

const skillModules = [
  {
    id: "mindfulness",
    label: "正念",
    description: "观察当下，减少被想法和情绪自动带走。",
    prompts: ["DBT 的正念技能有哪些？", "智慧心是什么？"],
  },
  {
    id: "distress-tolerance",
    label: "痛苦耐受",
    description: "强度很高时先不让情况变得更糟。",
    prompts: ["痛苦耐受有哪些技能？", "STOP 技能怎么做？"],
  },
  {
    id: "emotion-regulation",
    label: "情绪调节",
    description: "理解情绪，核对事实并选择下一步行动。",
    prompts: ["什么是核对事实？", "相反行为和问题解决有什么区别？"],
  },
  {
    id: "interpersonal-effectiveness",
    label: "人际效能",
    description: "更清楚地请求、拒绝、表达和维护关系。",
    prompts: ["DEAR MAN 是什么？", "GIVE 和 FAST 分别是什么？"],
  },
];

const initialMessages: Message[] = [
  {
    id: "welcome",
    role: "assistant",
    payload: {
      kind: "answer",
      title: "描述困扰就可以，不必先知道 DBT 技能名",
      message:
        "当前 Demo 会先理解你想处理的是情绪、想法、行为还是关系，再从两册 DBT 资料中寻找带页码的依据；无法可靠判断时，会先问一个关键问题，而不是直接说“书中没有”。",
      citationIds: ["checkFacts"],
      nextAction: "practice",
    },
  },
];

function citationsForPayload(payload?: ChatPayload) {
  if (!payload) return [];
  if (payload.citations?.length) return payload.citations;
  return (payload.citationIds ?? [])
    .map((id) => sourceCitations[id])
    .filter(Boolean);
}

function pageLabel(citation: SourceCitation) {
  return citation.printedPage
    ? `印刷第 ${citation.printedPage} 页`
    : `PDF 第 ${citation.pdfPage} 页`;
}

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("home");
  const [consented, setConsented] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [busySeconds, setBusySeconds] = useState(0);
  const [source, setSource] = useState<SourceCitation | null>(null);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({
    emotion: "",
    intensityBefore: "60",
    intensityAfter: "40",
    event: "",
    interpretation: "",
    facts: "",
    fit: "3",
    nextStep: "",
  });
  const [records, setRecords] = useState<PracticeRecord[]>([]);
  const [saved, setSaved] = useState(false);
  const [practiceContext, setPracticeContext] = useState("");
  const latestMessageRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const panelScrollRef = useRef<HTMLDivElement | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setConsented(localStorage.getItem("dbt-demo-consent-v1") === "accepted");
      const stored = localStorage.getItem("dbt-practice-records-v1");
      if (stored) {
        try {
          setRecords(JSON.parse(stored) as PracticeRecord[]);
        } catch {
          localStorage.removeItem("dbt-practice-records-v1");
        }
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (messages.length <= 1) return;
    const timer = window.setTimeout(() => {
      latestMessageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [messages.length]);

  useEffect(() => {
    panelScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [tab]);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => {
      setBusySeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  const currentStep = practiceSteps[practiceIndex];
  const progress = Math.round(((practiceIndex + 1) / practiceSteps.length) * 100);
  const currentValue = answers[currentStep.id] ?? "";

  const activeSources = useMemo(() => {
    const latest = [...messages]
      .reverse()
      .find((message) => message.role === "assistant")?.payload;
    return citationsForPayload(latest);
  }, [messages]);

  const latestAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")?.payload;

  const busyLabel = busySeconds < 3
    ? "正在理解你的情境"
    : busySeconds < 8
      ? "正在检索书内依据"
      : "正在核对回答与页码";

  function acceptBoundary() {
    localStorage.setItem("dbt-demo-consent-v1", "accepted");
    setConsented(true);
  }

  function openChat(prompt?: string) {
    setTab("chat");
    if (prompt) {
      window.setTimeout(() => sendMessage(undefined, prompt), 0);
    } else {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function startFromHome(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    openChat(message);
  }

  async function sendMessage(event?: FormEvent, preset?: string) {
    event?.preventDefault();
    const message = (preset ?? input).trim();
    if (!message || busy) return;

    setMessages((items) => [
      ...items,
      { id: createId(), role: "user", text: message },
    ]);
    setInput("");
    setBusySeconds(0);
    setBusy(true);
    const controller = new AbortController();
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 45_000);

    try {
      const history = messages
        .filter((item) => item.id !== "welcome")
        .map((item) => ({
          role: item.role,
          content: item.role === "user"
            ? item.text ?? ""
            : [item.payload?.title, item.payload?.message, ...(item.payload?.steps ?? [])]
              .filter(Boolean)
              .join(" "),
        }))
        .filter((item) => item.content)
        .slice(-6);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as ChatPayload & { error?: string };
      setMessages((items) => [
        ...items,
        {
          id: createId(),
          role: "assistant",
          payload: response.ok
            ? payload
            : {
                kind: "refusal",
                title: "暂时无法处理",
                message: payload.error ?? "请稍后再试。",
              },
        },
      ]);
    } catch (error) {
      const wasAborted = error instanceof DOMException && error.name === "AbortError";
      setMessages((items) => [
        ...items,
        {
          id: createId(),
          role: "assistant",
          payload: {
            kind: "refusal",
            title: wasAborted ? "本次等待已停止" : "连接暂时不可用",
            message: wasAborted
              ? "没有提交新的内容。你可以稍后重试，或先从下方技能和练习进入。"
              : "服务暂时没有响应。你可以重试，或先从下方技能和练习进入。",
          },
        },
      ]);
    } finally {
      window.clearTimeout(timeout);
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
      setBusy(false);
    }
  }

  function cancelPendingRequest() {
    requestControllerRef.current?.abort();
  }

  function updateAnswer(value: string) {
    setAnswers((current) => ({ ...current, [currentStep.id]: value }));
    setSaved(false);
  }

  function startPracticeFromConversation(messageIndex: number) {
    const context = [...messages.slice(0, messageIndex)]
      .reverse()
      .find((message) => message.role === "user")?.text ?? "";
    setPracticeContext(context);
    setTab("practice");
  }

  function savePractice() {
    const record: PracticeRecord = {
      id: createId(),
      createdAt: new Date().toISOString(),
      emotion: answers.emotion,
      intensityBefore: answers.intensityBefore,
      intensityAfter: answers.intensityAfter,
      event: answers.event,
      interpretation: answers.interpretation,
      facts: answers.facts,
      fit: answers.fit,
      nextStep: answers.nextStep,
    };
    const nextRecords = [record, ...records];
    setRecords(nextRecords);
    localStorage.setItem("dbt-practice-records-v1", JSON.stringify(nextRecords));
    setSaved(true);
  }

  function resetPractice() {
    setPracticeIndex(0);
    setAnswers({
      emotion: "",
      intensityBefore: "60",
      intensityAfter: "40",
      event: "",
      interpretation: "",
      facts: "",
      fit: "3",
      nextStep: "",
    });
    setSaved(false);
    setPracticeContext("");
  }

  function deleteRecord(id: string) {
    if (!window.confirm("确定删除这条练习记录吗？删除后无法恢复。")) return;
    const nextRecords = records.filter((record) => record.id !== id);
    setRecords(nextRecords);
    localStorage.setItem("dbt-practice-records-v1", JSON.stringify(nextRecords));
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className="product-frame" aria-label="DBT 心理自助技能助手">
        <header className="topbar">
          <div className="brand-mark" aria-hidden="true">
            此
          </div>
          <div className="brand-copy">
            <strong>此刻</strong>
            <span>DBT 心理自助技能助手</span>
          </div>
          <div className="demo-badge">内部 Demo</div>
        </header>

        <div className={`workspace ${tab === "chat" ? "with-evidence" : "full-width"}`}>
          <section className="phone-panel">
            <div className="panel-scroll" ref={panelScrollRef}>
            <div className={`mobile-heading ${tab === "home" ? "home-heading" : ""}`}>
              {tab === "home" ? (
                <div className="home-intro-line">
                  <p className="kicker">今天的支持从这里开始</p>
                  <span>先照顾当下，再理解发生了什么</span>
                </div>
              ) : (
                <div>
                  <p className="kicker">
                    {tab === "chat"
                      ? "对话 · 先理解，再建议"
                      : tab === "skills"
                        ? "DBT 技能地图"
                        : tab === "practice"
                          ? "结构化练习 · 约 5 分钟"
                          : "本地记录 · 不上传"}
                  </p>
                  <h1>
                    {tab === "chat"
                      ? "描述困扰，我们一起选一个技能"
                      : tab === "skills"
                        ? "按需要找到 DBT 技能"
                        : tab === "practice"
                          ? "一步一步核对事实"
                          : "你的练习记录"}
                  </h1>
                </div>
              )}
              <div className="heading-actions">
                <button className="safety-link" onClick={() => openChat("我现在有伤害自己或他人的危险，需要立即帮助")}>
                  <ShieldAlert size={14} aria-hidden="true" />
                  安全求助
                </button>
                <button className="quiet-button" onClick={() => setConsented(false)}>使用边界</button>
              </div>
            </div>

            {tab === "home" && (
              <div className="home-view">
                <section className="home-hero">
                  <Image
                    className="home-hero-image"
                    src="/images/dbt-still-water-hero.jpg"
                    alt=""
                    fill
                    sizes="(max-width: 860px) 100vw, 1100px"
                    priority
                    unoptimized
                  />
                  <div className="home-hero-wash" aria-hidden="true" />
                  <div className="home-hero-content">
                    <div className="support-pill"><Sparkles size={14} aria-hidden="true" /> DBT 自助引导</div>
                    <h1>此刻，最困扰你的是什么？</h1>
                    <p>不必先判断对错，也不必知道技能名称。写下一件具体的事，我们会先理解情境，再寻找有页码依据的练习方向。</p>
                    <form className="home-composer" onSubmit={startFromHome}>
                      <label htmlFor="home-input">用一两句话开始</label>
                      <div>
                        <textarea
                          id="home-input"
                          value={input}
                          onChange={(event) => setInput(event.target.value)}
                          placeholder="例如：朋友一直没回消息，我越来越觉得自己被讨厌了……"
                          rows={2}
                          maxLength={1000}
                        />
                        <button type="submit" disabled={!input.trim() || busy}>
                          开始梳理 <ArrowRight size={17} aria-hidden="true" />
                        </button>
                      </div>
                      <small>你的练习记录默认只保存在当前设备。</small>
                    </form>
                  </div>
                </section>

                <section className="home-routes" aria-labelledby="home-routes-title">
                  <div className="section-heading">
                    <div>
                      <span>也可以直接选择</span>
                      <h2 id="home-routes-title">按现在的需要进入</h2>
                    </div>
                    <p>每条路径都可以随时回到对话，不要求一次做完。</p>
                  </div>
                  <div className="home-grid">
                    <button className="need-card urgent" onClick={() => openChat("我现在脑子很乱，情绪很强，想先稳定一点") }>
                      <span className="need-icon"><Wind size={22} aria-hidden="true" /></span>
                      <strong>情绪太强，先稳定</strong>
                      <small>用低负担步骤度过当下，不急着分析全部问题。</small>
                      <b>现在开始 <ArrowRight size={14} aria-hidden="true" /></b>
                    </button>
                    <button className="need-card" onClick={() => setTab("skills")}>
                      <span className="need-icon"><BookOpen size={22} aria-hidden="true" /></span>
                      <strong>按需要找技能</strong>
                      <small>从正念、痛苦耐受、情绪调节和人际效能中选择。</small>
                      <b>浏览技能 <ArrowRight size={14} aria-hidden="true" /></b>
                    </button>
                    <button className="need-card" onClick={() => setTab(records.length ? "records" : "practice")}>
                      <span className="need-icon"><ListChecks size={22} aria-hidden="true" /></span>
                      <strong>{records.length ? "继续查看练习记录" : "做一次核对事实练习"}</strong>
                      <small>{records.length ? `当前设备已有 ${records.length} 条记录。` : "六个小步骤，区分事件、解释、证据和下一步。"}</small>
                      <b>{records.length ? "查看记录" : "进入练习"} <ArrowRight size={14} aria-hidden="true" /></b>
                    </button>
                  </div>
                </section>

                <section className="home-proof" aria-label="知识库透明度">
                  <div className="proof-title"><BookOpen size={18} aria-hidden="true" /><span>知识库透明度</span></div>
                  <div><strong>{knowledgeManifest.coverage.indexedPageCount}</strong><span>两册 PDF 页</span></div>
                  <div><strong>{knowledgeManifest.coverage.chunkCount}</strong><span>可追溯原文片段</span></div>
                  <div><strong>{Math.round(knowledgeManifest.coverage.characterCoverage * 100)}%</strong><span>非空原文覆盖</span></div>
                </section>
                <p className="home-boundary">这是 AI 心理自助工具，不提供诊断、处方或个体化治疗决策。</p>
              </div>
            )}

            {tab === "chat" && (
              <div className="chat-view">
                <div className="flow-strip" aria-label="本次使用路径">
                  <span className="active"><b>1</b> 描述情境</span>
                  <ArrowRight size={13} aria-hidden="true" />
                  <span className={messages.length > 1 ? "active" : ""}><b>2</b> 理解与选技能</span>
                  <ArrowRight size={13} aria-hidden="true" />
                  <button onClick={() => setTab("practice")}><b>3</b> 带入练习</button>
                </div>
                <p className="quick-label">不知道怎么说？可以从这些句子开始</p>
                <div className="quick-prompts" aria-label="示例问题">
                  {quickPrompts.map((prompt) => (
                    <button key={prompt} onClick={() => sendMessage(undefined, prompt)}>
                      {prompt}
                    </button>
                  ))}
                </div>

                <div className="message-list" aria-live="polite">
                  {messages.map((message, index) =>
                    message.role === "user" ? (
                      <div
                        className="user-message"
                        key={message.id}
                        ref={(node) => {
                          if (index === messages.length - 1) latestMessageRef.current = node;
                        }}
                      >
                        {message.text}
                      </div>
                    ) : (
                      <article
                        className={`assistant-card ${message.payload?.kind ?? "answer"}`}
                        key={message.id}
                        ref={(node) => {
                          if (index === messages.length - 1) latestMessageRef.current = node;
                        }}
                      >
                        <div className="assistant-label">
                          <span aria-hidden="true">◎</span>
                          {message.payload?.kind === "crisis"
                            ? "安全优先"
                            : message.payload?.kind === "refusal"
                              ? "边界提示"
                              : "基于当前证据"}
                        </div>
                        <h2>{message.payload?.title}</h2>
                        <p>{message.payload?.message}</p>
                        {!!message.payload?.steps?.length && (
                          <ol className="answer-steps">
                            {message.payload.steps.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ol>
                        )}
                        {!!message.payload?.suggestedReplies?.length && (
                          <div className="reply-suggestions" aria-label="选择一个方向继续">
                            {message.payload.suggestedReplies.map((reply) => (
                              <button key={reply} onClick={() => sendMessage(undefined, reply)}>
                                {reply}
                              </button>
                            ))}
                          </div>
                        )}
                        {message.payload?.kind === "crisis" && (
                          <div className="crisis-actions">
                            <a href="tel:12356">拨打 12356</a>
                            <a href="tel:120">紧急情况拨打 120</a>
                          </div>
                        )}
                        {!!citationsForPayload(message.payload).length && (
                          <div className="citation-row">
                            {citationsForPayload(message.payload).map((citation) => (
                              <button key={citation.id} onClick={() => setSource(citation)}>
                                <span>来源</span>
                                {pageLabel(citation)}
                              </button>
                            ))}
                          </div>
                        )}
                        {message.payload?.nextAction === "practice" && (
                          <button className="primary-inline" onClick={() => startPracticeFromConversation(index)}>
                            开始六步练习 <ArrowRight size={15} aria-hidden="true" />
                          </button>
                        )}
                      </article>
                    ),
                  )}
                  {busy && (
                    <div className="thinking" role="status">
                      <div className="thinking-dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </div>
                      <div className="thinking-copy">
                        <strong>{busyLabel}</strong>
                        <small>{busySeconds < 8 ? "通常几秒即可完成" : "正在做最后核对，请稍候"}</small>
                      </div>
                      {busySeconds >= 10 && (
                        <button type="button" onClick={cancelPendingRequest}>停止等待</button>
                      )}
                    </div>
                  )}
                </div>

                <form className="composer" onSubmit={(event) => sendMessage(event)}>
                  <label htmlFor="chat-input">描述一个问题或具体情境</label>
                  <div>
                    <textarea
                      id="chat-input"
                      ref={inputRef}
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      placeholder="例如：领导没有回复消息，我开始担心自己做错了……"
                      rows={2}
                      maxLength={1000}
                    />
                    <button type="submit" disabled={!input.trim() || busy} aria-label="发送">
                      <Send size={19} aria-hidden="true" />
                    </button>
                  </div>
                  <p>AI 可能出错；重要决定请咨询专业人员。</p>
                </form>
              </div>
            )}

            {tab === "skills" && (
              <div className="skills-view">
                <p className="skills-intro">技能页负责理解和导航；所有专业说明最终仍回到原书片段与页码。</p>
                <div className="skill-module-grid">
                  {skillModules.map((module, index) => (
                    <article key={module.id} className="skill-module-card">
                      <div className="skill-module-head">
                        <span>0{index + 1}</span>
                        <h2>{module.label}</h2>
                      </div>
                      <p>{module.description}</p>
                      <div>
                        {module.prompts.map((prompt) => (
                          <button key={prompt} onClick={() => openChat(prompt)}>{prompt}</button>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
                <div className="wiki-note">
                  <strong>Evidence Wiki 当前状态</strong>
                  <p>{knowledgeManifest.wiki.nodeCount} 个技能导航节点均已连接原书证据；正式发布前仍需 DBT 专业人员逐节点审核。</p>
                </div>
              </div>
            )}

            {tab === "practice" && (
              <div className="practice-view">
                {practiceContext && (
                  <div className="practice-context">
                    <span>来自刚才对话的原话</span>
                    <p>{practiceContext}</p>
                    <button
                      onClick={() => setAnswers((current) => ({
                        ...current,
                        event: current.event || practiceContext,
                      }))}
                    >
                      作为待整理情境带入
                    </button>
                    <small>这里只复制你的原话，不会替你判断哪些是事实或解释。</small>
                  </div>
                )}
                <div className="progress-block">
                  <div>
                    <span>{currentStep.eyebrow}</span>
                    <strong>{progress}%</strong>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: `${progress}%` }} />
                  </div>
                </div>

                <article className="practice-card">
                  <div className="step-number">{practiceIndex + 1}</div>
                  <h2>{currentStep.title}</h2>
                  <p>{currentStep.helper}</p>

                  {currentStep.id === "emotion" && (
                    <div className="field-stack">
                      <label>
                        情绪名称
                        <input
                          value={answers.emotion}
                          onChange={(event) =>
                            setAnswers((current) => ({ ...current, emotion: event.target.value }))
                          }
                          placeholder="例如：焦虑、愤怒、悲伤"
                        />
                      </label>
                      <label className="range-field">
                        <span>
                          练习前强度 <strong>{answers.intensityBefore}</strong>/100
                        </span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={answers.intensityBefore}
                          onChange={(event) =>
                            setAnswers((current) => ({
                              ...current,
                              intensityBefore: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                  )}

                  {["event", "interpretation", "facts"].includes(currentStep.id) && (
                    <label className="large-field">
                      <span>你的记录</span>
                      <textarea
                        value={currentValue}
                        onChange={(event) => updateAnswer(event.target.value)}
                        rows={7}
                        placeholder={
                          currentStep.id === "event"
                            ? "只记录可以被观察到的内容……"
                            : currentStep.id === "interpretation"
                              ? "我脑中出现的解释是……"
                              : "支持这个解释的事实是……\n不支持它的事实是……"
                        }
                      />
                    </label>
                  )}

                  {currentStep.id === "fit" && (
                    <div className="fit-scale">
                      {["0", "1", "2", "3", "4", "5"].map((value) => (
                        <button
                          className={answers.fit === value ? "selected" : ""}
                          aria-pressed={answers.fit === value}
                          key={value}
                          onClick={() => updateAnswer(value)}
                        >
                          {value}
                        </button>
                      ))}
                      <div>
                        <span>几乎不匹配</span>
                        <span>非常匹配</span>
                      </div>
                    </div>
                  )}

                  {currentStep.id === "nextStep" && (
                    <div className="choice-grid">
                      {[
                        "继续观察，不急着行动",
                        "考虑采用相反行为",
                        "处理一个现实问题",
                        "向可信任的人求证",
                      ].map((choice) => (
                        <button
                          key={choice}
                          className={answers.nextStep === choice ? "selected" : ""}
                          aria-pressed={answers.nextStep === choice}
                          onClick={() => updateAnswer(choice)}
                        >
                          <span>{answers.nextStep === choice ? "✓" : "○"}</span>
                          {choice}
                        </button>
                      ))}
                      <label className="range-field after-range">
                        <span>
                          现在的情绪强度 <strong>{answers.intensityAfter}</strong>/100
                        </span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={answers.intensityAfter}
                          onChange={(event) =>
                            setAnswers((current) => ({
                              ...current,
                              intensityAfter: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                  )}

                  <div className="practice-actions">
                    <button
                      className="secondary-button"
                      onClick={() => setPracticeIndex((index) => Math.max(0, index - 1))}
                      disabled={practiceIndex === 0}
                    >
                      上一步
                    </button>
                    {practiceIndex < practiceSteps.length - 1 ? (
                      <button
                        className="primary-button"
                        onClick={() => setPracticeIndex((index) => index + 1)}
                        disabled={!currentValue.trim()}
                      >
                        下一步
                      </button>
                    ) : (
                      <button
                        className="primary-button"
                        onClick={savePractice}
                        disabled={!answers.nextStep || saved}
                      >
                        {saved ? "已保存" : "保存练习"}
                      </button>
                    )}
                  </div>
                </article>

                <button
                  className="evidence-note"
                  onClick={() => setSource(sourceCitations.worksheetOne)}
                >
                  <span>依据</span>
                  结构来自情绪调节练习单 5 · 查看原页
                  <b aria-hidden="true">↗</b>
                </button>

                {saved && (
                  <div className="saved-panel">
                    <strong>练习已经保存在这台设备</strong>
                    <p>记录不会上传，也不会用于模型训练。</p>
                    <div>
                      <button onClick={() => setTab("records")}>查看记录</button>
                      <button onClick={resetPractice}>再做一次</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "records" && (
              <div className="records-view">
                <div className="local-only-note">
                  <span aria-hidden="true">⌁</span>
                  <div>
                    <strong>仅保存在当前设备</strong>
                    <p>当前 Demo 不上传练习记录，也不用于模型训练。</p>
                  </div>
                </div>
                {records.length === 0 ? (
                  <div className="empty-state">
                    <div aria-hidden="true">○</div>
                    <h2>还没有练习记录</h2>
                    <p>完成一次“核对事实”练习后，摘要会出现在这里。</p>
                    <button onClick={() => setTab("practice")}>开始练习</button>
                  </div>
                ) : (
                  <div className="record-list">
                    {records.map((record) => (
                      <article key={record.id}>
                        <div className="record-head">
                          <div>
                            <span>{new Date(record.createdAt).toLocaleDateString("zh-CN")}</span>
                            <h2>{record.emotion || "未命名情绪"}</h2>
                          </div>
                          <button onClick={() => deleteRecord(record.id)}>删除</button>
                        </div>
                        <div className="intensity-change">
                          <strong>{record.intensityBefore}</strong>
                          <span>练习前</span>
                          <b>→</b>
                          <strong>{record.intensityAfter}</strong>
                          <span>练习后</span>
                        </div>
                        <dl>
                          <div>
                            <dt>事件</dt>
                            <dd>{record.event || "未填写"}</dd>
                          </div>
                          <div>
                            <dt>下一步</dt>
                            <dd>{record.nextStep || "未选择"}</dd>
                          </div>
                        </dl>
                        <details className="record-details">
                          <summary>查看完整练习</summary>
                          <dl>
                            <div>
                              <dt>我的解释</dt>
                              <dd>{record.interpretation || "未填写"}</dd>
                            </div>
                            <div>
                              <dt>核对结果</dt>
                              <dd>{record.facts || "未填写"}</dd>
                            </div>
                            <div>
                              <dt>与事实匹配度</dt>
                              <dd>{record.fit || "未评估"} / 5</dd>
                            </div>
                          </dl>
                        </details>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            </div>

            <nav className="tabbar" aria-label="主要功能">
              <button className={tab === "home" ? "active" : ""} aria-current={tab === "home" ? "page" : undefined} onClick={() => setTab("home")}>
                <HomeIcon size={18} aria-hidden="true" />
                首页
              </button>
              <button className={tab === "chat" ? "active" : ""} aria-current={tab === "chat" ? "page" : undefined} onClick={() => setTab("chat")}>
                <MessageCircle size={18} aria-hidden="true" />
                对话
              </button>
              <button
                className={tab === "skills" ? "active" : ""}
                aria-current={tab === "skills" ? "page" : undefined}
                onClick={() => setTab("skills")}
              >
                <BookOpen size={18} aria-hidden="true" />
                技能
              </button>
              <button
                className={tab === "practice" ? "active" : ""}
                aria-current={tab === "practice" ? "page" : undefined}
                onClick={() => setTab("practice")}
              >
                <ListChecks size={18} aria-hidden="true" />
                练习
              </button>
              <button
                className={tab === "records" ? "active" : ""}
                aria-current={tab === "records" ? "page" : undefined}
                onClick={() => setTab("records")}
              >
                <NotebookText size={18} aria-hidden="true" />
                记录
              </button>
            </nav>
          </section>

          {tab === "chat" && <aside className="evidence-panel">
            <div className="evidence-heading">
              <p className="kicker">CURRENT EVIDENCE</p>
              <h2>当前证据板</h2>
              <p>本轮回答只使用已摄取的书内页面；OCR 摘录需按原页复核。</p>
            </div>
            <div className="status-card">
              <div>
                <span>工作流</span>
                <strong>
                  {latestAssistant?.mode === "generated"
                    ? "RAG 受控生成"
                    : latestAssistant?.mode === "guided"
                      ? "RAG 情境引导"
                    : latestAssistant?.generation?.attempted
                      ? "RAG 安全降级"
                    : latestAssistant?.mode === "retrieval"
                      ? "RAG 检索模式"
                      : "人工核验模板"}
                </strong>
              </div>
              <i>运行中</i>
            </div>
            <div className="source-list">
              {activeSources.length ? (
                activeSources.map((citation) => (
                  <button key={citation.id} onClick={() => setSource(citation)}>
                    <span className="page-token">
                      {citation.printedPage ? `P.${citation.printedPage}` : `PDF.${citation.pdfPage}`}
                    </span>
                    <span>
                      <strong>{citation.section}</strong>
                      <small>PDF 第 {citation.pdfPage} 页</small>
                    </span>
                    <ExternalLink size={13} aria-hidden="true" />
                  </button>
                ))
              ) : (
                <p className="no-sources">提出一个问题后，证据会出现在这里。</p>
              )}
            </div>
            <div className="boundary-card">
              <span>本轮边界</span>
              <ul>
                <li>全书检索；核对事实可结构化练习</li>
                <li>无诊断和用药建议</li>
                <li>技能结论需引用；情境不清时先澄清</li>
              </ul>
            </div>
            <p className="evidence-footnote">
              {latestAssistant?.retrieval
                ? `已摄取 ${latestAssistant.retrieval.corpusPages} 页 · 本轮召回 ${latestAssistant.retrieval.resultCount} 页`
                : `已摄取 ${knowledgeManifest.coverage.indexedPageCount} 页 · 非空原文覆盖 ${Math.round(knowledgeManifest.coverage.characterCoverage * 100)}%`}
            </p>
          </aside>}
        </div>
      </section>

      {source && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSource(null)}>
          <section
            className="source-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="source-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <p>来源核验</p>
                <h2 id="source-title">{source.section}</h2>
              </div>
              <button onClick={() => setSource(null)} aria-label="关闭来源页面">
                ×
              </button>
            </div>
            <div className="source-meta">
              {source.printedPage && <span>印刷第 {source.printedPage} 页</span>}
                <span>PDF 第 {source.pdfPage} 页</span>
              {typeof source.charStart === "number" && (
                <span>原文字符 {source.charStart}-{source.charEnd}</span>
              )}
              {typeof source.ocrScore === "number" && (
                <span>OCR 置信度 {Math.round(source.ocrScore * 100)}%</span>
              )}
            </div>
            {source.image ? (
              <>
                <div className="source-summary">
                  <strong>人工核验摘要</strong>
                  <p>{source.evidence}</p>
                </div>
                <div className="scan-frame">
                  <Image
                    src={source.image}
                    alt={`${source.section}扫描页`}
                    width={900}
                    height={1273}
                    unoptimized
                  />
                </div>
              </>
            ) : (
              <div className="ocr-evidence">
                <span>OCR 证据摘录</span>
                <p>{source.evidence}</p>
                <small>原始扫描页未在网页中公开；请在受控内容库中按 PDF 页码复核。</small>
              </div>
            )}
            <p className="source-book">{source.book}</p>
          </section>
        </div>
      )}

      {consented === false && (
        <div className="modal-backdrop consent-backdrop">
          <section className="consent-modal" role="dialog" aria-modal="true" aria-labelledby="consent-title">
            <div className="consent-scroll">
              <div className="consent-symbol" aria-hidden="true">此</div>
              <p className="kicker">开始之前</p>
              <h2 id="consent-title">这是心理自助工具，不是真人咨询师</h2>
              <p>
                当前版本仅用于 18 岁以上成人的内部测试，提供 DBT 知识学习和技能练习；不进行诊断、处方或个体化治疗决策。
              </p>
              <ul>
                <li>AI 回答可能出错，请通过来源页核验。</li>
                <li>练习记录仅保存在这台设备。</li>
                <li>启用第三方模型时，对话内容会发送给模型供应商处理；请勿输入姓名、电话等身份信息。</li>
                <li>如果有立即伤害自己或他人的危险，请联系身边的人并拨打 120 或 110。</li>
              </ul>
            </div>
            <div className="consent-actions">
              <button onClick={acceptBoundary}>我已了解，进入 Demo</button>
              <small>继续即表示你已年满 18 岁，并理解以上边界。</small>
            </div>
          </section>
        </div>
      )}

      {consented === null && (
        <div className="boot-backdrop" role="status" aria-live="polite">
          <div className="boot-card">
            <div className="consent-symbol" aria-hidden="true">此</div>
            <strong>正在准备可交互页面</strong>
            <span>加载完成后即可开始，不需要重复点击。</span>
          </div>
        </div>
      )}
    </main>
  );
}
