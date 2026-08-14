"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  BookOpen,
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
  ExperienceMode,
  SourceCitation,
  sourceCitations,
} from "../lib/dbt-content";
import { ConversationAnswer } from "./components/ConversationAnswer";

type Tab = "home" | "chat" | "skills" | "practice" | "records";

type Message = {
  id: string;
  role: "user" | "assistant";
  text?: string;
  payload?: ChatPayload;
  experienceMode?: ExperienceMode;
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
    eyebrow: "第 1 步 · 先说说感受",
    title: "现在最明显的情绪是什么？",
    helper: "先写一个最贴近的词就好，比如焦虑、生气或难过。",
  },
  {
    id: "event",
    eyebrow: "第 2 步 · 说清发生的事",
    title: "刚才具体发生了什么？",
    helper: "先写你亲眼看到或听到的内容：谁说了什么、做了什么。暂时别猜对方为什么这样做。",
  },
  {
    id: "interpretation",
    eyebrow: "第 3 步 · 看看脑中的想法",
    title: "当时，你脑中第一个冒出的想法是什么？",
    helper: "把担心、猜测或预想写下来。它们很真实，但还需要和事实分开看。",
  },
  {
    id: "facts",
    eyebrow: "第 4 步 · 回头看看事实",
    title: "哪些事实对得上？哪些对不上？",
    helper: "两边都写一点。如果暂时想不到，也可以先写“还不确定”。",
  },
  {
    id: "fit",
    eyebrow: "第 5 步 · 再看情绪有多贴合",
    title: "现在再看，这份情绪和事实有多对得上？",
    helper: "0 表示几乎对不上，5 表示很对得上。拿不准时，选最接近的数字就好。",
  },
  {
    id: "nextStep",
    eyebrow: "第 6 步 · 选一个小动作",
    title: "接下来，你愿意先做哪一小步？",
    helper: "不用一次解决全部问题，只选一件现在做得到的事。",
  },
] as const;

const companionPrompts = [
  "我脑子很乱，想先缓一缓",
  "一件事反复在脑子里转，我想理清楚",
  "我不知道该怎么和对方开口",
  "我今天心情不太好，但不知道怎么说",
];

const deepReadPrompts = [
  "STOP 技能怎么做？",
  "全然接纳和认命有什么不同？",
  "什么是核对事实？",
  "DEAR MAN 适合什么时候用？",
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
      title: "先说一句就好",
      message:
        "不用先想清楚该用什么方法。你可以说说今天发生了什么，或者现在最难受的是什么。我们先把眼前这一小段说清楚，再决定要不要一起看书里的方法。",
      nextAction: "none",
      mode: "bridge",
      experienceMode: "companion",
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

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeChatPayload(value: unknown, mode: ExperienceMode): ChatPayload & { error?: string } {
  if (!value || typeof value !== "object") {
    return {
      kind: "refusal",
      refusalReason: "transport",
      title: "刚才的回答没有完整送达",
      message: "网络返回的内容不完整。你的话没有被重复提交，可以点一次发送再试。",
      experienceMode: mode,
    };
  }

  const raw = value as Record<string, unknown>;
  const kind = raw.kind === "answer" || raw.kind === "refusal" || raw.kind === "crisis"
    ? raw.kind
    : "refusal";
  const cleanStrings = (items: unknown) => Array.isArray(items)
    ? items.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 8)
    : undefined;

  return {
    ...raw,
    kind,
    title: typeof raw.title === "string" && raw.title.trim()
      ? raw.title
      : kind === "refusal" ? "这件事需要更稳妥地处理" : "我们慢慢来",
    message: typeof raw.message === "string" && raw.message.trim()
      ? raw.message
      : "刚才的回答没有完整显示。你可以换个说法再试一次。",
    steps: cleanStrings(raw.steps),
    suggestedReplies: cleanStrings(raw.suggestedReplies),
    experienceMode: raw.experienceMode === "companion" || raw.experienceMode === "deep-read"
      ? raw.experienceMode
      : mode,
    skillCard: raw.skillCard && typeof raw.skillCard === "object"
      ? raw.skillCard as ChatPayload["skillCard"]
      : undefined,
    citations: Array.isArray(raw.citations)
      ? raw.citations.filter((citation) => citation && typeof citation === "object") as SourceCitation[]
      : undefined,
    citationIds: cleanStrings(raw.citationIds),
    error: typeof raw.error === "string" ? raw.error : undefined,
  } as ChatPayload & { error?: string };
}

function looksLikePracticeEvent(value: string) {
  const text = value.trim();
  if (text.length < 6 || /[？?]$/u.test(text)) return false;
  if (/^(你好|您好|嗨|哈喽|谢谢|好的|好吧|在吗|我现在情绪很强|我在反复想一件事|有件事我一直反复想|我想先说说(刚才)?发生)/u.test(text)) return false;
  if (/什么是|怎么用|如何使用|有哪些|是什么技能|DBT\s*技能/iu.test(text)) return false;
  const hasPersonOrMoment = /(我|他|她|对方|朋友|同事|领导|家人|伴侣|老师|孩子|刚才|今天|昨天|最近)/u.test(text);
  const hasObservableAction = /(说了?|做了?|发了?|回复|没回|没有回|收到|看到|听到|告诉|拒绝|批评|争吵|吵架|迟到|取消|离开|发生|联系|答应|失约|挂断|摔|打|骂)/u.test(text);
  return hasPersonOrMoment && hasObservableAction;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("home");
  const [consented, setConsented] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [experienceMode, setExperienceMode] = useState<ExperienceMode>("companion");
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
  const submittingRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setConsented(localStorage.getItem("dbt-demo-consent-v1") === "accepted");
      const storedMode = localStorage.getItem("dbt-experience-mode-v1");
      if (storedMode === "companion" || storedMode === "deep-read") {
        setExperienceMode(storedMode);
      }
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
    ? experienceMode === "companion" ? "先听懂你在说什么" : "先读懂你的问题"
    : busySeconds < 8
      ? experienceMode === "companion" ? "正在找一段真正贴近的书中方法" : "正在从两册书里查找"
      : "正在核对内容和页码";

  const quickPrompts = experienceMode === "companion" ? companionPrompts : deepReadPrompts;

  function acceptBoundary() {
    localStorage.setItem("dbt-demo-consent-v1", "accepted");
    setConsented(true);
  }

  function changeExperienceMode(nextMode: ExperienceMode) {
    if (busy || nextMode === experienceMode) return;
    setExperienceMode(nextMode);
    localStorage.setItem("dbt-experience-mode-v1", nextMode);
    window.setTimeout(() => inputRef.current?.focus(), 0);
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
    if (!message || busy || submittingRef.current) return;
    submittingRef.current = true;
    const requestMode = experienceMode;

    setMessages((items) => [
      ...items,
      { id: createId(), role: "user", text: message, experienceMode: requestMode },
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
            : [
                item.payload?.title,
                item.payload?.message,
                item.payload?.followUpQuestion,
                item.payload?.skillCard?.label,
                item.payload?.skillCard?.title,
                item.payload?.skillCard?.summary,
                item.payload?.skillCard?.whyItMayHelp,
                item.payload?.skillCard?.tryNow,
                ...(item.payload?.skillCard?.takeaways ?? []),
                ...(item.payload?.steps ?? []),
              ]
              .filter(Boolean)
              .join(" "),
        }))
        .filter((item) => item.content)
        .slice(-6);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history, experienceMode: requestMode }),
        signal: controller.signal,
      });
      const responseText = await response.text();
      let payload: ChatPayload & { error?: string };
      try {
        payload = normalizeChatPayload(JSON.parse(responseText) as unknown, requestMode);
      } catch {
        payload = normalizeChatPayload(null, requestMode);
      }
      setMessages((items) => [
        ...items,
        {
          id: createId(),
          role: "assistant",
          experienceMode: requestMode,
          payload: response.ok
              ? { ...payload, experienceMode: payload.experienceMode ?? requestMode }
              : {
                  kind: "refusal",
                  refusalReason: "transport",
                  title: "刚才没有成功",
                  message: payload.error ?? "可以再试一次，或者先去看看技能和练习。",
                  experienceMode: requestMode,
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
          experienceMode: requestMode,
          payload: {
            kind: "refusal",
            refusalReason: "transport",
            title: wasAborted ? "已经停止等待" : "刚才没有收到回复",
            message: wasAborted
              ? "这次没有继续提交。你可以换个说法再试，也可以先去看看技能和练习。"
              : "可能是网络有点慢。你可以再试一次，也可以先去看看技能和练习。",
            experienceMode: requestMode,
          },
        },
      ]);
    } finally {
      window.clearTimeout(timeout);
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
      submittingRef.current = false;
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
      .find((message) => message.role === "user" && looksLikePracticeEvent(message.text ?? ""))?.text ?? "";
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
    if (!window.confirm("要删掉这条记录吗？删掉后就找不回来了。")) return;
    const nextRecords = records.filter((record) => record.id !== id);
    setRecords(nextRecords);
    localStorage.setItem("dbt-practice-records-v1", JSON.stringify(nextRecords));
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className={`product-frame theme-${tab}`} data-view={tab} aria-label="DBT 自助练习助手">
        <header className="topbar">
          <div className="brand-mark" aria-hidden="true">
            此
          </div>
          <div className="brand-copy">
            <strong>此刻</strong>
            <span>DBT 自助练习助手</span>
          </div>
          <div className="demo-badge">体验版</div>
        </header>

        <div className={`workspace ${tab === "chat" ? "with-evidence" : "full-width"}`}>
          <section className="phone-panel">
            {tab !== "home" && <div className="view-art" aria-hidden="true" />}
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
                      ? "先说说，再一起找办法"
                      : tab === "skills"
                        ? "看看有哪些 DBT 方法"
                        : tab === "practice"
                          ? "跟着做一遍 · 大约 5 分钟"
                          : "只存在这台设备上"}
                  </p>
                  <h1>
                    {tab === "chat"
                      ? "先说说，此刻怎么了"
                      : tab === "skills"
                        ? "你现在更需要哪一种帮助？"
                        : tab === "practice"
                          ? "把这件事一步步理清楚"
                          : "你的练习记录"}
                  </h1>
                </div>
              )}
              <div className="heading-actions">
                <button className="safety-link" onClick={() => openChat("我现在有伤害自己或他人的危险，需要立即帮助")}>
                  <ShieldAlert size={14} aria-hidden="true" />
                  安全求助
                </button>
                <button className="quiet-button" onClick={() => setConsented(false)}>使用说明</button>
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
                    <div className="support-pill"><Sparkles size={14} aria-hidden="true" /> 有书本依据的自助练习</div>
                    <h1>此刻，最困扰你的是什么？</h1>
                    <p>不用先判断谁对谁错，也不用知道专业名词。写下刚刚发生的事，或者你现在最难受的地方，我们从这里开始。</p>
                    <form className="home-composer" onSubmit={startFromHome}>
                      <label htmlFor="home-input">用一两句话开始</label>
                      <div>
                        <textarea
                          id="home-input"
                          value={input}
                          onChange={(event) => setInput(event.target.value)}
                          placeholder="比如：朋友一直没回消息，我开始担心是不是自己做错了……"
                          rows={2}
                          maxLength={1000}
                        />
                        <button type="submit" disabled={!input.trim() || busy}>
                          和我说说 <ArrowRight size={17} aria-hidden="true" />
                        </button>
                      </div>
                      <small>你的练习记录默认只保存在当前设备。</small>
                    </form>
                  </div>
                </section>

                <section className="home-routes" aria-labelledby="home-routes-title">
                  <div className="section-heading">
                    <div>
                      <span>不想打字？也可以直接选</span>
                      <h2 id="home-routes-title">你现在更需要哪一种帮助？</h2>
                    </div>
                    <p>不用一次想清楚，选一个最接近的就好，之后随时可以换。</p>
                  </div>
                  <div className="home-grid">
                    <button className="need-card urgent" onClick={() => openChat("我现在脑子很乱，情绪很强，想先稳定一点") }>
                      <span className="need-icon"><Wind size={22} aria-hidden="true" /></span>
                      <strong>情绪太强，先缓一缓</strong>
                      <small>先做几个简单步骤，别让情绪推着你马上行动。</small>
                      <b>我想先缓一缓 <ArrowRight size={14} aria-hidden="true" /></b>
                    </button>
                    <button className="need-card" onClick={() => setTab("skills")}>
                      <span className="need-icon"><BookOpen size={22} aria-hidden="true" /></span>
                      <strong>找一个适合现在的方法</strong>
                      <small>不知道该怎么做时，可以从四类 DBT 技能里慢慢找。</small>
                      <b>看看有哪些方法 <ArrowRight size={14} aria-hidden="true" /></b>
                    </button>
                    <button className="need-card" onClick={() => setTab(records.length ? "records" : "practice")}>
                      <span className="need-icon"><ListChecks size={22} aria-hidden="true" /></span>
                      <strong>{records.length ? "看看之前理清的事情" : "把一件事慢慢理清楚"}</strong>
                      <small>{records.length ? `这台设备上已经有 ${records.length} 条记录。` : "用六个小步骤，分开看发生的事、脑中的想法和能确认的事实。"}</small>
                      <b>{records.length ? "查看记录" : "开始理一理"} <ArrowRight size={14} aria-hidden="true" /></b>
                    </button>
                  </div>
                </section>

                <section className="home-proof" aria-label="书本内容收录情况">
                  <div className="proof-title"><BookOpen size={18} aria-hidden="true" /><span>书本内容收录情况</span></div>
                  <div><strong>{knowledgeManifest.coverage.indexedPageCount}</strong><span>两册书的 PDF 页数</span></div>
                  <div><strong>{knowledgeManifest.coverage.chunkCount}</strong><span>可以查到出处的原文段落</span></div>
                  <div><strong>{Math.round(knowledgeManifest.coverage.characterCoverage * 100)}%</strong><span>有文字的页面已全部收录</span></div>
                </section>
                <p className="home-boundary">这是 AI 自助练习，不会替你诊断，也不能告诉你该怎么用药。</p>
              </div>
            )}

            {tab === "chat" && (
              <div className="chat-view">
                <div className="experience-switch" role="group" aria-label="选择对话方式">
                  <button
                    type="button"
                    className={experienceMode === "companion" ? "active" : ""}
                    aria-pressed={experienceMode === "companion"}
                    disabled={busy}
                    onClick={() => changeExperienceMode("companion")}
                  >
                    <MessageCircle size={17} aria-hidden="true" />
                    <span><strong>陪伴对话</strong><small>先回应你的感受，再带来一个相关方法</small></span>
                    <b>默认</b>
                  </button>
                  <button
                    type="button"
                    className={experienceMode === "deep-read" ? "active" : ""}
                    aria-pressed={experienceMode === "deep-read"}
                    disabled={busy}
                    onClick={() => changeExperienceMode("deep-read")}
                  >
                    <BookOpen size={17} aria-hidden="true" />
                    <span><strong>知识伴读</strong><small>系统理解方法、步骤和书中出处</small></span>
                  </button>
                </div>
                <div className={`mode-intro ${experienceMode}`}>
                  <Sparkles size={15} aria-hidden="true" />
                  <p>{experienceMode === "companion"
                    ? "这里不会急着给结论。先听懂你正经历什么，每次只往前走一小步；提到 DBT 方法时，仍能回到书本出处。"
                    : "适合带着问题读 DBT。先给通俗解释，需要时再展开步骤和原书来源，不把大段摘录堆到你面前。"}</p>
                </div>
                {messages.length === 1 && (
                  <>
                    <p className="quick-label">{experienceMode === "companion" ? "不知道从哪里说起？可以先点一句" : "想先读哪一种方法？"}</p>
                    <div className="quick-prompts" aria-label="示例问题">
                      {quickPrompts.map((prompt) => (
                        <button key={prompt} disabled={busy} onClick={() => sendMessage(undefined, prompt)}>
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div className="message-list" aria-live="polite">
                  {messages.length === 1 && (
                    <div className="conversation-empty" aria-hidden="true">
                      <span>{experienceMode === "companion" ? "从一句话开始就好" : "带着一个问题来读"}</span>
                      <p>{experienceMode === "companion"
                        ? "一个感受、一件刚发生的事，或者“我也说不清”都可以。"
                        : "可以输入技能名，也可以直接问它什么时候有用、该怎么练。"}</p>
                    </div>
                  )}
                  {messages.map((message, index) =>
                    message.id === "welcome" ? null : message.role === "user" ? (
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
                        className={`assistant-card ${message.payload?.kind ?? "answer"} ${(message.payload?.experienceMode ?? message.experienceMode) === "companion" ? "companion-answer" : "deep-answer"}`}
                        key={message.id}
                        ref={(node) => {
                          if (index === messages.length - 1) latestMessageRef.current = node;
                        }}
                      >
                        <ConversationAnswer
                          payload={message.payload}
                          mode={message.payload?.experienceMode ?? message.experienceMode ?? "companion"}
                          sources={citationsForPayload(message.payload)}
                          isLatest={index === messages.length - 1 && index > 0}
                          busy={busy}
                          onPrompt={(prompt) => sendMessage(undefined, prompt)}
                          onPractice={() => startPracticeFromConversation(index)}
                          onSource={setSource}
                        />
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
                        <small>{busySeconds < 8 ? "通常几秒就好" : "还在认真核对，再等一小会儿"}</small>
                      </div>
                      {busySeconds >= 10 && (
                        <button type="button" onClick={cancelPendingRequest}>停止等待</button>
                      )}
                    </div>
                  )}
                </div>

                <form className="composer" onSubmit={(event) => sendMessage(event)} aria-busy={busy}>
                  <label htmlFor="chat-input">{experienceMode === "companion" ? "把现在最想说的告诉我" : "输入想了解的 DBT 方法或问题"}</label>
                  <div>
                    <textarea
                      id="chat-input"
                      ref={inputRef}
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault();
                          void sendMessage();
                        }
                      }}
                      enterKeyHint="enter"
                      placeholder={experienceMode === "companion"
                        ? "比如：领导一直没回消息，我开始担心是不是自己做错了……"
                        : "比如：核对事实适合什么时候用？"}
                      rows={2}
                      maxLength={1000}
                    />
                    <button type="submit" disabled={!input.trim() || busy} aria-label="发送">
                      <Send size={19} aria-hidden="true" />
                    </button>
                  </div>
                  <p>{busy ? "正在回复，请不要重复提交；等待较久时可以停止。" : "Ctrl/⌘ + Enter 发送。涉及安全、诊断或用药，请找专业人员。"}</p>
                </form>
              </div>
            )}

            {tab === "skills" && (
              <div className="skills-view">
                <p className="skills-intro">不知道技能名也没关系。先选一个最接近的需要，每个方法都能回到书中的原文和页码。</p>
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
                  <strong>这些内容从哪里来？</strong>
                  <p>目前整理了 {knowledgeManifest.wiki.nodeCount} 个技能主题，每个都能回到书里的相应页码。正式发布前，还需要 DBT 专业人员逐项复核。</p>
                </div>
              </div>
            )}

            {tab === "practice" && (
              <div className="practice-view">
                {practiceContext && (
                  <div className="practice-context">
                    <span>这次想理清的是</span>
                    <p>{practiceContext}</p>
                    <small>先保留你的原话，下面再把“发生的事”和“脑中的想法”慢慢分开。</small>
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
                        我现在感到
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
                          这种情绪现在有多强烈 <strong>{answers.intensityBefore}</strong>/100
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
                      <span>{currentStep.id === "event"
                        ? "事情经过"
                        : currentStep.id === "interpretation"
                          ? "我当时的想法"
                          : "我能确认的事实"}</span>
                      <textarea
                        value={currentValue}
                        onChange={(event) => updateAnswer(event.target.value)}
                        rows={7}
                        placeholder={
                          currentStep.id === "event"
                            ? "比如：我下午三点发了消息，到晚上八点还没有收到回复……"
                            : currentStep.id === "interpretation"
                              ? "比如：我当时觉得，他是不是在生我的气……"
                              : "对得上的事实是……\n对不上的事实是……\n我还不能确定的是……"
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
                        <span>几乎对不上</span>
                        <span>很对得上</span>
                      </div>
                    </div>
                  )}

                  {currentStep.id === "nextStep" && (
                    <div className="choice-grid">
                      {[
                        "先等一等，不急着按冲动行动",
                        "做一个和冲动相反的小动作",
                        "处理眼前能改变的那一部分",
                        "问问信任的人，听听他的看法",
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
                          做到这里，情绪还有多强烈 <strong>{answers.intensityAfter}</strong>/100
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
                  <span>出处</span>
                  参考《情绪调节练习单 5》，已为手机填写做了简化 · 对照原页
                  <b aria-hidden="true">↗</b>
                </button>

                {saved && (
                  <div className="saved-panel">
                    <strong>已经保存在这台设备上</strong>
                    <p>这条记录不会上传，也不会拿去训练模型。</p>
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
                    <strong>这些记录只留在这台设备上</strong>
                    <p>不会上传，也不会拿去训练模型。</p>
                  </div>
                </div>
                {records.length === 0 ? (
                  <div className="empty-state">
                    <div aria-hidden="true">○</div>
                    <h2>这里还没有记录</h2>
                    <p>跟着完成一次练习后，你可以回来看看自己当时是怎么想的。</p>
                    <button onClick={() => setTab("practice")}>做一次练习</button>
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
                              <dt>我能确认的事实</dt>
                              <dd>{record.facts || "未填写"}</dd>
                            </div>
                            <div>
                              <dt>情绪和事实有多对得上</dt>
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

          {tab === "chat" && <aside className="evidence-panel conversation-aside">
            <div className="aside-mode-mark">
              {experienceMode === "companion" ? <MessageCircle size={18} aria-hidden="true" /> : <BookOpen size={18} aria-hidden="true" />}
              <div>
                <span>当前方式</span>
                <strong>{experienceMode === "companion" ? "陪伴对话" : "知识伴读"}</strong>
              </div>
            </div>
            <div className="evidence-heading">
              <p className="kicker">这一轮，我们先做什么</p>
              <h2>{latestAssistant?.skillCard
                ? `先试试：${latestAssistant.skillCard.label}`
                : experienceMode === "deep-read"
                  ? "从一个想弄懂的问题开始"
                  : latestAssistant?.mode === "bridge"
                  ? "先把眼前的感受说清楚"
                  : "读懂一个方法，再决定要不要练"}</h2>
              <p>{experienceMode === "companion"
                ? "不会一口气塞给你很多知识。每轮只回应一个重点，再给一个可以选择的小方向。"
                : "通俗解释在前，细节和来源按需展开。你随时可以切回陪伴对话。"}</p>
            </div>

            <details className="aside-sources">
              <summary>本轮书本依据 <b>{activeSources.length}</b></summary>
              <div>
                {activeSources.length ? activeSources.map((citation) => (
                  <button key={citation.id} type="button" onClick={() => setSource(citation)}>
                    <strong>{citation.section}</strong>
                    <small>{citation.printedPage ? `书中 ${citation.printedPage} 页` : `PDF ${citation.pdfPage} 页`}</small>
                  </button>
                )) : (
                  <p>这一轮还在倾听或澄清，没有硬套书中方法。</p>
                )}
              </div>
            </details>

            <div className="aside-boundary">
              <ShieldAlert size={16} aria-hidden="true" />
              <p><strong>这是自助支持，不是诊断。</strong>涉及安全、诊断或用药时，我们会先说明边界并提示合适的求助方式。</p>
            </div>
            <p className="evidence-footnote">
              {latestAssistant?.retrieval
                ? `本轮检索 ${latestAssistant.retrieval.resultCount} 处内容，来源可逐页核对`
                : `两册书共收录 ${knowledgeManifest.coverage.indexedPageCount} 个 PDF 页面`}
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
                <p>这段内容来自哪里</p>
                <h2 id="source-title">{source.section}</h2>
              </div>
              <button onClick={() => setSource(null)} aria-label="关闭来源页面">
                ×
              </button>
            </div>
            <div className="source-meta">
              {source.printedPage && <span>书中第 {source.printedPage} 页</span>}
                <span>PDF 第 {source.pdfPage} 页</span>
              {typeof source.ocrScore === "number" && (
                <span>文字识别准确度 {Math.round(source.ocrScore * 100)}%</span>
              )}
            </div>
            {source.image ? (
              <>
                <div className="source-summary">
                  <strong>这页主要讲了什么</strong>
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
              <details className="ocr-evidence">
                <summary>查看系统定位到的 OCR 原文</summary>
                <p>{source.evidence}</p>
                <small>原文用于核对出处，可能有断句或识别错误；伴读卡是基于相关书页整理的通俗说明，不是逐字摘录。</small>
              </details>
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
              <p className="kicker">先说明一下</p>
              <h2 id="consent-title">这是自助练习，不是真人咨询</h2>
              <p>
                这个体验版只面向 18 岁以上成人，可以用来了解和练习 DBT 技能，但不能替你做诊断、开药或制定治疗方案。
              </p>
              <ul>
                <li>回答可能不准确，重要内容请点开书本来源核对。</li>
                <li>练习记录只保存在这台设备上。</li>
                <li>对话会交给第三方模型处理，请不要输入姓名、电话等身份信息。</li>
                <li>如果你可能马上伤害自己或他人，请立即联系身边的人，并拨打 120 或 110。</li>
              </ul>
            </div>
            <div className="consent-actions">
              <button onClick={acceptBoundary}>我明白了，开始使用</button>
              <small>点击继续，表示你已年满 18 岁并理解以上说明。</small>
            </div>
          </section>
        </div>
      )}

      {consented === null && (
        <div className="boot-backdrop" role="status" aria-live="polite">
          <div className="boot-card">
            <div className="consent-symbol" aria-hidden="true">此</div>
            <strong>正在打开页面</strong>
            <span>稍等一下，加载好后会自动进入。</span>
          </div>
        </div>
      )}
    </main>
  );
}
