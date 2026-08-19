"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowLeft, ArrowRight, BarChart3, BellRing, BookOpen, Check, ChevronRight,
  CircleAlert, ClipboardCheck, Download, HeartHandshake, Home, Info, ListChecks,
  LockKeyhole, MessageCircle, Phone, RefreshCw, Send, ShieldCheck, Sparkles,
  Trash2, UserRoundCheck, WifiOff, X,
} from "lucide-react";
import type { ChatPayload, ExperienceMode, SourceCitation } from "../../lib/dbt-content";
import type {
  EmaRecord, ParticipantSnapshot, ProtocolModule, SafetyPlanSections, SkillLog,
  LearningFeedback, ConversationReview, ConversationRetention, ConversationTranscriptTurn,
} from "../../lib/nssi/types";
import {
  DBT_SKILL_CATEGORIES,
  DBT_SKILLS,
  EMA_MOODS,
  normalizePracticeOptionId,
  practiceOptionLabel,
  QUICK_SKILL_IDS,
  SKILL_OUTCOMES,
  SKILL_TARGETS,
  skillOutcomeLabel,
  skillTargetIntensityLabel,
  skillTargetLabel,
  SUPPORT_ACTIONS,
} from "../../lib/nssi/skills";
import { nssiPhase1Modules } from "../../lib/nssi/curriculum";
import { ConversationAnswer } from "./ConversationAnswer";

type AppView = "today" | "modules" | "chat" | "safety" | "records";
type CatalogPayload = {
  modules: ProtocolModule[];
  skillCatalog: { version: string; skills: typeof DBT_SKILLS; supportActions: typeof SUPPORT_ACTIONS };
  knowledge: { indexedPages: number; chunks: number; characterCoverage: number; professionallyReviewedSkillCards: number; sourceAuthorization: string };
  runtime: { persistent: boolean; encryptionReady: boolean; productionReady: boolean };
  delivery: { configured: boolean; publicKey: string };
};
type Snapshot = ParticipantSnapshot & { recentEma: EmaRecord[] };
type ModuleDetail = { module: ProtocolModule; citations: SourceCitation[] };
type Message = { id: string; role: "user" | "assistant"; text?: string; payload?: ChatPayload & { riskEventId?: string } };
type EmiResult = { trigger: boolean; intervention: "none" | "stop" | "self-reminder" | "safety-plan" | "crisis"; reasonCodes: string[]; suggestedSkillId?: string; personalizedMessage?: string; personalizationStatus?: "agent-generated" | "template-fallback" };
type OverlayState = EmiResult | { trigger: true; intervention: "help" | "crisis"; reasonCodes: string[] };
type SnapshotLoadResult = { status: "ok"; snapshot: Snapshot } | { status: "invalid" | "empty"; snapshot: null };

const tokenKey = "nssi-participant-token-v1";
const safetyCacheKey = "nssi-safety-plan-offline-v1";
const conversationKey = "nssi-conversation-id-v1";
const conversationRetentionKey = (conversationId: string) => `nssi-conversation-retention:${conversationId}`;
const moduleEvidenceVersion = "display-quality-v2";
const moods = EMA_MOODS;
const emptySafetyPlan: SafetyPlanSections = {
  warningSigns: [], internalCoping: [], peopleAndPlaces: [], supportContacts: [],
  professionalResources: [
    { name: "全国统一心理援助热线", phone: "12356" },
    { name: "紧急医疗与警务支持", phone: "120 / 110", note: "危险迫近时立即联系" },
  ],
  environmentSafetyAcknowledgement: "我已阅读由临床团队维护的环境安全提醒，并愿意在风险升高时联系现实中的支持者协助执行。",
};

function todayLocalDate() {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date()).replace(/\//gu, "-");
}
function yesterdayLocalDate() {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() - 24 * 60 * 60 * 1000)).replace(/\//gu, "-");
}
function splitLines(value: string) { return value.split(/\r?\n|[；;]/u).map((item) => item.trim()).filter(Boolean).slice(0, 12); }
function joinLines(value: string[] | undefined) { return (value ?? []).join("\n"); }
function readCachedSafetyPlan() {
  try {
    return JSON.parse(localStorage.getItem(safetyCacheKey) ?? "null") as SafetyPlanSections | null;
  } catch { return null; }
}
function participantHeaders(token: string) { return { "content-type": "application/json", "x-participant-token": token }; }
function pushApplicationKey(value: string) {
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function statusLabel(status: string) { return status === "completed" ? "已完成" : status === "in-progress" ? "进行中" : status === "available" ? "可开始" : "未解锁"; }
function safeVisibleMessage(payload: ChatPayload) { return [payload.title, payload.message, payload.followUpQuestion, ...(payload.steps ?? [])].filter(Boolean).join(" "); }
function welcomeConversationMessage(): Message {
  return { id: "welcome", role: "assistant", payload: { kind: "answer", title: "先从今天最难的那一点开始", message: "你不需要先知道该用什么技能。可以说说刚才发生了什么，或者现在最难受的是什么；我会先听懂，再从已经解锁的内容里找一小步。", suggestedReplies: ["我现在情绪很强", "一件事在脑子里反复转", "我想学当前模块"], nextAction: "none", mode: "bridge", experienceMode: "companion" } };
}

function SkillPicker({ selected, onChange, quickIds = [...QUICK_SKILL_IDS], includeSupport = true }: {
  selected: string[];
  onChange: (value: string[]) => void;
  quickIds?: string[];
  includeSupport?: boolean;
}) {
  function toggle(id: string) {
    if (selected.includes(id)) return onChange(selected.filter((value) => value !== id));
    if (selected.length >= 8) return;
    onChange([...selected, id]);
  }
  const quick = [...new Set([...selected, ...quickIds])]
    .map((id) => DBT_SKILLS.find((skill) => skill.id === id))
    .filter((skill): skill is (typeof DBT_SKILLS)[number] => Boolean(skill))
    .slice(0, 8);
  return <div className="skill-picker">
    <div className="skill-picker-heading"><strong>最近使用与课程技能</strong><small>可多选，最多 8 项</small></div>
    <div className="skill-choice-grid">{quick.map((skill) => <button type="button" key={skill.id} className={selected.includes(skill.id) ? "selected" : ""} aria-pressed={selected.includes(skill.id)} onClick={() => toggle(skill.id)}><strong>{skill.label}</strong><small>{skill.summary}</small></button>)}</div>
    <details className="all-skills-picker"><summary><span>查看全部 18 个 DBT 技能</span><small>按五组展开</small><ChevronRight /></summary><div>{DBT_SKILL_CATEGORIES.map((category) => <section key={category.id}><h4>{category.label}</h4><div className="skill-choice-grid">{DBT_SKILLS.filter((skill) => skill.category === category.id).map((skill) => <button type="button" key={skill.id} className={selected.includes(skill.id) ? "selected" : ""} aria-pressed={selected.includes(skill.id)} onClick={() => toggle(skill.id)}><strong>{skill.label}</strong><small>{skill.summary}</small></button>)}</div></section>)}</div></details>
    {includeSupport && <div className="support-action-picker"><span>现实支持行动</span>{SUPPORT_ACTIONS.map((action) => <button type="button" key={action.id} className={selected.includes(action.id) ? "selected" : ""} aria-pressed={selected.includes(action.id)} onClick={() => toggle(action.id)}><strong>{action.label}</strong><small>{action.summary}</small></button>)}</div>}
  </div>;
}

function IntensityField({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number) => void }) {
  return <div className="skill-intensity-field" role="group" aria-label={label}><span><strong>{label}</strong><output>{value === null ? "未选择" : `${value} / 10`}</output></span><div className="skill-scale-options">{Array.from({ length: 11 }, (_, index) => <button type="button" key={index} className={value === index ? "selected" : ""} aria-pressed={value === index} aria-label={`${label} ${index}`} onClick={() => onChange(index)}>{index}</button>)}</div><small><i>0 · 没有</i><i>10 · 非常强</i></small></div>;
}
async function readStreamedChat(response: Response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "回答没有送达");
  }
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    return response.json() as Promise<ChatPayload & { error?: string; riskEventId?: string }>;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: (ChatPayload & { error?: string; riskEventId?: string }) | null = null;
  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = frame.match(/^event:\s*(.+)$/mu)?.[1]?.trim();
      const data = frame.match(/^data:\s*(.+)$/mu)?.[1];
      if (data && event === "result") result = JSON.parse(data) as ChatPayload & { riskEventId?: string };
      if (data && event === "error") {
        const error = JSON.parse(data) as { error?: string };
        throw new Error(error.error ?? "回答没有送达");
      }
      boundary = buffer.indexOf("\n\n");
    }
    if (chunk.done) break;
  }
  if (!result) throw new Error("回答没有完整送达，请重试。");
  return result;
}
function emaStreak(records: EmaRecord[]) {
  const dates = new Set(records.map((item) => item.localDate));
  let cursor = dates.has(todayLocalDate()) ? new Date() : new Date(Date.now() - 24 * 60 * 60 * 1000);
  let streak = 0;
  while (streak < 365) {
    const localDate = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(cursor).replace(/\//gu, "-");
    if (!dates.has(localDate)) break;
    streak += 1; cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  return streak;
}

function Enrollment({ onEnrolled }: { onEnrolled: (token: string, snapshot: Snapshot) => void }) {
  const [adult, setAdult] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!adult || !accepted) return setError("请先确认年龄，并阅读同意与监测说明。");
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/nssi/enroll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ageDeclaredAdult: adult, accepted, timezone: "Asia/Shanghai" }) });
      const body = await response.json() as { token?: string; snapshot?: Snapshot; error?: string };
      if (!response.ok || !body.token || !body.snapshot) throw new Error(body.error ?? "登记失败");
      localStorage.setItem(tokenKey, body.token); onEnrolled(body.token, body.snapshot);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "登记失败，请稍后再试。"); }
    finally { setBusy(false); }
  }
  return (
    <main className="nssi-onboarding">
      <section className="onboarding-visual" aria-hidden="true"><div className="brand-mark">此</div><div><span>此刻 · NSSI 数字化干预一期</span><h1>不是一个人硬撑，<br />也不是交给 AI 决定。</h1><p>八周结构化 DBT 自助训练，配合每日记录、即时技能、安全计划与远程人工协助。</p></div></section>
      <form className="onboarding-card" onSubmit={submit}>
        <span className="eyebrow">开始前，请先了解</span><h2>这是心理自助训练工具</h2>
        <p>它不提供医疗诊断、药物建议或紧急救援，也不替代医生、咨询师和现实中的支持。AI 会参与解释与表达，专业内容会附来源。</p>
        <div className="disclosure-list">
          <div><BookOpen /><span><strong>结构化训练</strong>按课程进度学习和练习，AI 不能替你解锁或完成模块。</span></div>
          <div><ShieldCheck /><span><strong>安全优先</strong>高风险信号和相关对话可能进入教练端风险队列，不承诺保密或实时人工回复。</span></div>
          <div><UserRoundCheck /><span><strong>人工协助</strong>系统无法代替现实支持；危险迫近时请直接拨打 120 或 110。</span></div>
        </div>
        <label className="consent-check"><input type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} /><span>我确认自己已满 18 周岁</span></label>
        <label className="consent-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>我已阅读并同意 AI 参与、默认保存对话回顾及风险监测说明；完整原文由我另行选择</span></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="nssi-primary" type="submit" disabled={busy || !adult || !accepted}>{busy ? "正在建立训练计划…" : "建立我的训练计划"}<ArrowRight /></button>
        <small>一期内部开发版本 · 未成年人暂不纳入</small>
      </form>
    </main>
  );
}

function LearningLoop({ snapshot, current, onView, onModule, onEma }: {
  snapshot: Snapshot;
  current: ProtocolModule;
  onView: (view: AppView) => void;
  onModule: (id: string) => void;
  onEma: () => void;
}) {
  const learned = snapshot.protocol.progress[current.id]?.readingProgress >= 0.9;
  const practiced = snapshot.recentSkillLogs.length > 0;
  const reflected = Boolean(snapshot.recentSkillLogs[0]?.outcomes?.length);
  const steps = [
    { label: "学一点", detail: learned ? "今天的内容已读" : `继续第 ${current.ordinal} 模块`, done: learned, action: () => onModule(current.id) },
    { label: "练一次", detail: practiced ? "已有练习记录" : "把方法放进真实情境", done: practiced, action: () => onView("records") },
    { label: "看变化", detail: reflected ? "已记录前后变化" : "如实记录有没有帮助", done: reflected, action: () => onView("records") },
    { label: "定下一步", detail: snapshot.todayEma ? "今天的状态已记录" : "用一分钟更新状态", done: Boolean(snapshot.todayEma), action: onEma },
  ];
  return <section className="learning-loop-card"><header><div><span className="eyebrow">你的练习闭环</span><h2>学习不是终点，试过以后才知道下一步</h2></div><strong>{steps.filter((item) => item.done).length}/4</strong></header><div className="learning-loop-steps">{steps.map((step, index) => <button type="button" key={step.label} className={step.done ? "done" : ""} onClick={step.action}><i>{step.done ? <Check /> : index + 1}</i><span><strong>{step.label}</strong><small>{step.detail}</small></span><ChevronRight /></button>)}</div></section>;
}

function PushEnableCard({ snapshot, configured, onEnable }: { snapshot: Snapshot; configured: boolean; onEnable: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  if (!configured || snapshot.push?.subscribed) return null;
  return <section className="push-enable-card"><BellRing /><span><strong>想在没打开页面时收到提醒？</strong><small>开启后，课程和每日记录提醒会由浏览器送达；你可以随时在系统设置里关闭。</small>{notice && <em role="status">{notice}</em>}</span><button type="button" disabled={busy} onClick={async () => { setBusy(true); setNotice(""); try { await onEnable(); setNotice("提醒已经开启"); } catch (error) { setNotice(error instanceof Error ? error.message : "暂时无法开启提醒"); } finally { setBusy(false); } }}>{busy ? "正在开启…" : "开启提醒"}</button></section>;
}

function TodayView({ snapshot, modules, pushConfigured, onEnablePush, onView, onModule, onEma, onNotification }: { snapshot: Snapshot; modules: ProtocolModule[]; pushConfigured: boolean; onEnablePush: () => Promise<void>; onView: (view: AppView) => void; onModule: (id: string) => void; onEma: () => void; onNotification: (id: string) => void }) {
  const current = modules.find((module) => module.id === snapshot.protocol.currentModuleId) ?? modules[0];
  const completed = snapshot.protocol.completedModuleIds.length;
  const emaDone = snapshot.todayEma?.localDate === todayLocalDate();
  const recent = snapshot.recentEma.slice(0, 7).reverse();
  const streak = emaStreak(snapshot.recentEma);
  return (
    <div className="nssi-page today-view">
      <section className="today-hero"><div><span className="eyebrow">第 {snapshot.protocol.currentWeek} 周 · 你的训练路径</span><h1>今天不用做很多，<br />完成眼前的一小步。</h1><p>{completed} / 16 个模块已完成。课程、记录与安全计划都由同一套进度管理。</p></div><div className="week-orbit" aria-label={`已完成 ${completed} 个模块`}><strong>{completed}</strong><span>/ 16</span><small>已完成</small></div></section>
      {snapshot.activeRiskEvent && <button className="active-risk-banner" type="button" onClick={() => onView("safety")}><CircleAlert /><span><strong>安全支持仍在进行</strong>你可以随时打开安全计划。即使标记“现在安全”，风险事件仍需教练确认后关闭。</span><ChevronRight /></button>}
      {snapshot.notifications?.some((item) => !item.readAt) && <section className="notification-stack" aria-label="未读提醒">{snapshot.notifications.filter((item) => !item.readAt).slice(0, 3).map((item) => <button type="button" key={item.id} aria-label={`标记“${item.title}”为已读`} onClick={() => onNotification(item.id)}><span><strong>{item.title}</strong><small>{item.body}</small></span><b className="notification-mark"><Check /><span>标记已读</span></b></button>)}</section>}
      <PushEnableCard snapshot={snapshot} configured={pushConfigured} onEnable={onEnablePush} />
      <section className="today-grid">
        <article className="current-module-card"><div className="card-headline"><span><BookOpen />今天的课程</span><small>约 {current.estimatedMinutes} 分钟</small></div><p>第 {current.ordinal} 模块</p><h2>{current.title}</h2><p>{current.purpose}</p><button type="button" onClick={() => onModule(current.id)}>{snapshot.protocol.progress[current.id]?.status === "in-progress" ? "继续这一课" : "开始这一课"}<ArrowRight /></button></article>
        <article className={`ema-card ${emaDone ? "done" : ""}`}><div className="card-headline"><span><Activity />今日状态记录</span><small>{streak ? `连续 ${streak} 天` : emaDone ? "已完成" : "约 60 秒"}</small></div><h2>{emaDone ? "今天已经记录好了" : "现在的冲动和情绪怎么样？"}</h2><p>{emaDone ? `本次冲动强度 ${snapshot.todayEma?.urge}/10。需要时仍可直接求助。` : "这不是考试。简短记录能帮助系统在合适的时候给出技能入口。"}</p><button type="button" onClick={onEma}>{emaDone ? "更新今天的记录" : "开始记录或补记"}<ArrowRight /></button>{emaDone && <span className="done-mark"><Check />已记录</span>}</article>
      </section>
      <LearningLoop snapshot={snapshot} current={current} onView={onView} onModule={onModule} onEma={onEma} />
      <section className="today-insight"><div><span className="eyebrow">近 7 次记录</span><h2>不是给情绪打分，是看见它怎样变化</h2></div>{recent.length ? <div className="mini-trend" aria-label="近期冲动强度趋势">{recent.map((record) => <div key={record.id}><i style={{ height: `${Math.max(8, record.urge * 9)}%` }} /><span>{record.urge}</span></div>)}</div> : <p>完成第一次 EMA 后，这里会出现只对你可见的趋势。</p>}<button type="button" onClick={() => onView("records")}>查看记录与技能效果<ChevronRight /></button></section>
      <section className="today-shortcuts"><button type="button" onClick={() => onView("chat")}><MessageCircle /><span><strong>和伴读助手说说</strong>先回应你，再找当前阶段可用的方法</span><ChevronRight /></button><button type="button" onClick={() => onView("safety")}><ShieldCheck /><span><strong>查看安全计划</strong>{snapshot.safetyPlan ? `已保存第 ${snapshot.safetyPlan.version} 版` : "提前准备，风险升高时少做决定"}</span><ChevronRight /></button></section>
    </div>
  );
}

function ModuleSources({ citations }: { citations: SourceCitation[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(citations[0]?.id ?? null);
  const primaryCount = citations.filter((citation) => citation.presentationRole === "primary").length;
  const supportingCount = citations.length - primaryCount;
  return (
    <details className="module-sources">
      <summary>
        <BookOpen />
        <span>
          <strong>查看本节原文依据</strong>
          <small>{primaryCount} 条核心原文{supportingCount ? ` · ${supportingCount} 条补充材料` : ""}</small>
        </span>
        <ChevronRight />
      </summary>
      <div className="module-source-list">
        {citations.map((citation) => {
          const expanded = citation.id === expandedId;
          const page = citation.printedPage ? `书中 ${citation.printedPage} 页` : `PDF ${citation.pdfPage} 页`;
          return (
            <details className="module-source-item" key={citation.id} open={expanded}>
              <summary onClick={(event) => { event.preventDefault(); setExpandedId(expanded ? null : citation.id); }}>
                <span className="module-source-title">
                  <span className="module-source-meta">
                    <i>{citation.presentationRole === "primary" ? "核心原文" : citation.contentType === "worksheet" ? "练习材料" : "补充说明"}</i>
                    <small>{page}</small>
                  </span>
                  <strong>{citation.section}</strong>
                </span>
                <ChevronRight />
              </summary>
              <div className="module-source-content">
                <blockquote>{citation.evidence}</blockquote>
                <small><span>{citation.paragraphAnchor ?? citation.chunkId}</span><span>OCR 派生原文 · 专业核对时请回看扫描页</span></small>
              </div>
            </details>
          );
        })}
      </div>
    </details>
  );
}

function ModulesView({ snapshot, modules, selectedId, onSelect, token, onRefresh, onSafety, onPractice, onChat, onEma }: { snapshot: Snapshot; modules: ProtocolModule[]; selectedId: string | null; onSelect: (id: string | null) => void; token: string; onRefresh: () => Promise<void>; onSafety: () => void; onPractice: () => void; onChat: () => void; onEma: () => void }) {
  const [detail, setDetail] = useState<ModuleDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [notice, setNotice] = useState("");
  const [feedback, setFeedback] = useState<LearningFeedback | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { if (!selectedId) return; let cancelled = false; const load = async () => { await Promise.resolve(); if (cancelled) return; setDetail(null); setAnswers({}); setFeedback(null); setNotice(""); try { const response = await fetch(`/api/nssi/module?moduleId=${encodeURIComponent(selectedId)}&evidenceVersion=${moduleEvidenceVersion}`, { headers: participantHeaders(token), cache: "no-store" }); const value = await response.json() as ModuleDetail & { error?: string }; if (!response.ok) throw new Error(value.error ?? "课程暂时无法打开"); if (!cancelled) setDetail(value); } catch (error) { if (!cancelled) setNotice(error instanceof Error ? error.message : "课程暂时无法打开"); } }; void load(); return () => { cancelled = true; }; }, [selectedId, token]);
  async function stateAction(body: Record<string, unknown>) { const response = await fetch("/api/nssi/state", { method: "POST", headers: participantHeaders(token), body: JSON.stringify(body) }); const payload = await response.json() as { error?: string; learningFeedback?: LearningFeedback }; if (!response.ok) throw new Error(payload.error ?? "保存失败"); await onRefresh(); return payload; }
  async function markRead() { if (!detail) return; setNotice(""); try { await stateAction({ action: "protocol.reading", moduleId: detail.module.id, progress: 1 }); setNotice("阅读进度已保存。完成下面的练习后，这一模块才会结束。"); } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); } }
  async function submitExercise(event: FormEvent) { event.preventDefault(); if (!detail || submitting) return; const required = detail.module.exercise.fields.filter((field) => field.required); if (required.some((field) => !answers[field.id] || (Array.isArray(answers[field.id]) && !(answers[field.id] as string[]).length))) return setNotice("先完成标有必填的内容。可以写得很短，不需要一次做到完美。"); setSubmitting(true); try { const result = await stateAction({ action: "protocol.exercise", moduleId: detail.module.id, payload: answers }); setFeedback(result.learningFeedback ?? null); setNotice("这一模块已完成。现在可以把内容放进一次真实练习，再根据结果决定下一步。"); } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); } finally { setSubmitting(false); } }
  if (!selectedId) return <div className="nssi-page modules-view"><header className="page-intro"><span className="eyebrow">8 周 · 16 个模块</span><h1>每周两小步，顺着同一条路径往前走</h1><p>解锁与完成由协议状态机判断。AI 可以解释内容，但不能跳过前置练习或替你完成。</p></header><div className="week-list">{Array.from({ length: 8 }, (_, index) => index + 1).map((week) => <section key={week}><div className="week-heading"><span>第 {week} 周</span><i /></div><div className="week-modules">{modules.filter((module) => module.week === week).map((module) => { const status = snapshot.protocol.progress[module.id]?.status ?? "locked"; return <button key={module.id} type="button" disabled={status === "locked"} onClick={() => onSelect(module.id)}><span className={`module-number ${status}`}>{status === "completed" ? <Check /> : status === "locked" ? <LockKeyhole /> : module.ordinal}</span><span><small>{statusLabel(status)} · 约 {module.estimatedMinutes} 分钟</small><strong>{module.title}</strong><p>{module.purpose}</p></span><ChevronRight /></button>; })}</div></section>)}</div></div>;
  if (!detail || detail.module.id !== selectedId) return <div className={`nssi-page loading-state ${notice ? "has-error" : ""}`}>{notice ? <><CircleAlert /><p role="alert">{notice}</p><button type="button" className="nssi-secondary" onClick={() => onSelect(null)}>返回课程列表</button></> : <><RefreshCw className="spin" /><p>正在准备课程与原文段落索引…</p></>}</div>;
  const progress = snapshot.protocol.progress[detail.module.id];
  return (
    <div className="nssi-page module-detail-view">
      <button className="back-button" type="button" onClick={() => onSelect(null)}><ArrowLeft />返回课程</button>
      <header className="module-hero"><span className="eyebrow">第 {detail.module.week} 周 · 第 {detail.module.ordinal} 模块 · {statusLabel(progress.status)}</span><h1>{detail.module.title}</h1><p>{detail.module.purpose}</p><div><span>约 {detail.module.estimatedMinutes} 分钟</span><span>内容状态：内部草案，待专业审核</span></div></header>
      <section className="learning-card"><span className="section-kicker"><Sparkles />先理解这一点</span><p>{detail.module.introduction}</p><div className="module-boundary"><Info />这段课程正文是版本化内容，不由聊天模型临时生成。涉及现实危险时，优先使用全局求助入口。</div><button type="button" className="nssi-secondary" onClick={markRead} disabled={progress.readingProgress >= 0.9}>{progress.readingProgress >= 0.9 ? <><Check />已完成阅读</> : <>我已经读完这一节<ArrowRight /></>}</button></section>
      <section className="module-media-placeholder" aria-label="课程音视频"><span className="section-kicker"><BookOpen />音视频课程</span><h2>{detail.module.media?.status === "available" ? "本节配套内容" : "本节音视频素材待接入"}</h2>{detail.module.media?.status === "available" && detail.module.media.url ? <a href={detail.module.media.url} target="_blank" rel="noreferrer">打开经审核的音视频内容<ArrowRight /></a> : <p>播放器位置和版本接口已经保留；甲方提供经授权素材后可直接配置，不由 AI 自动生成课程。</p>}</section>
      {detail.module.id === "module-03" ? <section className="exercise-card safety-exercise-card"><span className="section-kicker"><ShieldCheck />本节练习</span><h2>{detail.module.exercise.title}</h2><p>课程中的安全计划和全局安全计划使用同一份数据，不需要重复填写。</p><button className="nssi-primary" type="button" onClick={onSafety}>打开并完成安全计划<ArrowRight /></button></section> : (
        <form className="exercise-card" onSubmit={submitExercise}><span className="section-kicker"><ClipboardCheck />本节练习</span><h2>{detail.module.exercise.title}</h2><p>{detail.module.exercise.prompt}</p>{detail.module.exercise.fields.map((field) => <label key={field.id} className="exercise-field"><span>{field.label}{field.required && <i>必填</i>}</span>{field.kind === "textarea" && <textarea value={String(answers[field.id] ?? "")} onChange={(event) => setAnswers((current) => ({ ...current, [field.id]: event.target.value }))} placeholder="写一两句就可以" />}{field.kind === "text" && <input value={String(answers[field.id] ?? "")} onChange={(event) => setAnswers((current) => ({ ...current, [field.id]: event.target.value }))} />}{field.kind === "scale" && <div className="scale-choices">{field.options?.map((option) => <button key={option} type="button" className={answers[field.id] === option ? "selected" : ""} onClick={() => setAnswers((current) => ({ ...current, [field.id]: option }))}>{option}</button>)}</div>}{field.kind === "multi-select" && <div className="chip-choices">{field.options?.map((option) => { const selected = (answers[field.id] as string[] | undefined)?.includes(option); return <button key={option} type="button" className={selected ? "selected" : ""} onClick={() => setAnswers((current) => { const before = current[field.id] as string[] | undefined ?? []; return { ...current, [field.id]: selected ? before.filter((item) => item !== option) : [...before, option] }; })}>{option}</button>; })}</div>}</label>)}{notice && <p className="save-notice" role="status">{notice}</p>}<button className="nssi-primary" type="submit" disabled={submitting || Boolean(progress.completedAt)}>{submitting ? "正在保存…" : progress.completedAt ? "这一练习已完成" : "提交练习并获得下一步"}<ArrowRight /></button></form>
      )}
      {detail.module.id === "module-03" && notice && <p className="save-notice">{notice}</p>}
      {(feedback || progress.completedAt) && <section className="learning-feedback-card"><span className="section-kicker"><Check />从学习走向使用</span><h2>{feedback?.title ?? "这一节已经完成"}</h2><p>{feedback?.reflection ?? "下一步可以把这个技能放进一次真实情境，记录练习前后发生了什么。"}</p><div><button type="button" onClick={onPractice}><ListChecks />现在练一次</button><button type="button" onClick={onChat}><MessageCircle />带着刚才的答案聊一聊</button><button type="button" onClick={onEma}><Activity />记录现在的状态</button></div></section>}
      <ModuleSources key={detail.module.id} citations={detail.citations} />
    </div>
  );
}

function EmaSheet({ token, initial, allowBackfill, onClose, onSaved }: { token: string; initial?: EmaRecord | null; allowBackfill: boolean; onClose: () => void; onSaved: (emi: EmiResult) => void }) {
  const [urge, setUrge] = useState(initial?.urge ?? 4); const [selectedMoods, setSelectedMoods] = useState<string[]>(initial?.moods ?? []); const [selectedSkills, setSelectedSkills] = useState<string[]>((initial?.skills ?? []).map(normalizePracticeOptionId)); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [recordDate, setRecordDate] = useState(todayLocalDate()); const startedAt = useRef<number | null>(null);
  useEffect(() => { startedAt.current = Date.now(); }, []);
  function toggle(value: string, selected: string[], setSelected: (value: string[]) => void) { setSelected(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]); }
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { const response = await fetch("/api/nssi/state", { method: "POST", headers: participantHeaders(token), body: JSON.stringify({ action: "ema.submit", payload: { localDate: recordDate, urge, moods: selectedMoods, skills: selectedSkills, note, isBackfill: recordDate !== todayLocalDate(), completionDurationMs: startedAt.current === null ? undefined : Date.now() - startedAt.current } }) }); const body = await response.json() as { emi?: EmiResult; error?: string }; if (!response.ok || !body.emi) throw new Error(body.error ?? "记录失败"); onSaved(body.emi); } catch (cause) { setError(cause instanceof Error ? cause.message : "记录失败"); } finally { setBusy(false); } }
  return <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="ema-title"><form className="nssi-sheet ema-sheet" onSubmit={submit}><button type="button" className="sheet-close" onClick={onClose} aria-label="关闭"><X /></button><span className="eyebrow">每日 EMA · 约 60 秒</span><h2 id="ema-title">{recordDate === todayLocalDate() ? "现在的状态怎么样？" : "补记昨天的状态"}</h2><p>只记录，不评判。补录会明确标记，也不会触发即时干预。</p>{allowBackfill && <div className="ema-date-switch"><button type="button" className={recordDate === todayLocalDate() ? "selected" : ""} onClick={() => setRecordDate(todayLocalDate())}>记录今天</button><button type="button" className={recordDate === yesterdayLocalDate() ? "selected" : ""} onClick={() => setRecordDate(yesterdayLocalDate())}>补记昨天</button></div>}<label className="urge-scale"><span>自伤冲动强度 <strong>{urge} / 10</strong></span><input type="range" min="0" max="10" step="1" value={urge} onChange={(event) => setUrge(Number(event.target.value))} /><div><small>没有</small><small>非常强</small></div></label><fieldset><legend>{recordDate === todayLocalDate() ? "现在有哪些情绪？" : "昨天主要有哪些情绪？"}<small>可多选</small></legend><div className="chip-choices">{moods.map((item) => <button type="button" key={item} className={selectedMoods.includes(item) ? "selected" : ""} onClick={() => toggle(item, selectedMoods, setSelectedMoods)}>{item}</button>)}</div></fieldset><fieldset><legend>{recordDate === todayLocalDate() ? "今天用过哪些方法？" : "昨天用过哪些方法？"}<small>没有也可以</small></legend><SkillPicker selected={selectedSkills} onChange={setSelectedSkills} /></fieldset><label className="ema-note"><span>还想补充一句吗？<small>可不填，内容仍会先经过安全识别</small></span><textarea value={note} onChange={(event) => setNote(event.target.value.slice(0, 300))} placeholder="例如：今天最难的是……" /></label>{error && <p className="form-error">{error}</p>}<button className="nssi-primary" type="submit" disabled={busy}>{busy ? "正在保存…" : recordDate === todayLocalDate() ? "保存今天的记录" : "保存补记"}<Check /></button></form></div>;
}

function EmiOverlay({ result, plan, token, onSafety, onClose, onMarkSafe }: { result: OverlayState; plan: SafetyPlanSections | null; token: string; onSafety: () => void; onClose: () => void; onMarkSafe: () => Promise<void> }) {
  const type = result.intervention;
  const urgent = type === "crisis" || type === "help" || type === "safety-plan";
  const remembered = type === "self-reminder";
  const [step, setStep] = useState(0);
  const sessionId = useRef(crypto.randomUUID());
  const stopSteps = [
    { title: "停下", body: "先暂停正在做的动作。双脚踩稳，不急着处理整件事。" },
    { title: "退一步", body: "如果可以，和触发你冲动的人、地点或物品拉开一点距离。" },
    { title: "观察", body: "只看三个信息：身体哪里最紧、情绪是什么、冲动现在几分。" },
    { title: "带着觉察行动", body: "从安全计划里选一个不会让情况恶化的动作，先做这一件。" },
  ];
  const log = useCallback((event: string, metadata: Record<string, unknown> = {}) => {
    void fetch("/api/nssi/state", { method: "POST", headers: participantHeaders(token), body: JSON.stringify({ action: "emi.event", event, metadata: { ...metadata, sessionId: sessionId.current, intervention: type } }) });
  }, [token, type]);
  useEffect(() => { log("displayed", { reasonCodes: result.reasonCodes.join(",") }); }, [log, result.reasonCodes]);
  function close() { log("closed", { step }); onClose(); }
  function openSafety() { log("safety-plan-opened", { step }); onSafety(); }
  return <div className="crisis-backdrop" role="dialog" aria-modal="true" aria-labelledby="crisis-title"><section className={`crisis-panel ${urgent ? "urgent" : "guided"}`}><span className="crisis-symbol"><HeartHandshake /></span><span className="eyebrow">{urgent ? "安全支持已打开" : remembered ? "先回到曾经有一点帮助的做法" : `STOP · 第 ${step + 1} / ${stopSteps.length} 步`}</span><h2 id="crisis-title">{urgent ? "现在先把现实中的安全放在第一位" : remembered ? "不用临时想出全新的办法" : stopSteps[step].title}</h2><p>{urgent ? "风险事件已进入教练端队列，但系统不承诺实时人工回复。危险正在发生或可能很快行动时，请直接联系现实中的人并拨打紧急电话。" : remembered ? result.personalizedMessage ?? `你之前记录过${"suggestedSkillId" in result && result.suggestedSkillId ? practiceOptionLabel(result.suggestedSkillId) : "这个方法"}带来过一点变化。可以先重复一次，再看看现在有没有不同。` : stopSteps[step].body}</p>{!urgent && !remembered && <div className="emi-stepper"><div>{stopSteps.map((item, index) => <i key={item.title} className={index <= step ? "active" : ""} />)}</div><button type="button" className="nssi-primary" onClick={() => { const next = Math.min(stopSteps.length - 1, step + 1); log("step-viewed", { step: next + 1 }); if (step === stopSteps.length - 1) openSafety(); else setStep(next); }}>{step === stopSteps.length - 1 ? "从安全计划选一个动作" : "完成这一步，继续"}<ArrowRight /></button></div>}{urgent && <div className="crisis-now-steps"><span><strong>1</strong>移动到有人、相对安全的地方</span><span><strong>2</strong>联系一个能保持通话或到场的人</span><span><strong>3</strong>危险迫近时拨打 120 或 110</span></div>}<div className="crisis-phone-actions"><a href="tel:12356" onClick={() => log("contact-opened", { contact: "12356" })}><Phone />拨打 12356</a><a href="tel:120" onClick={() => log("contact-opened", { contact: "120" })}><Phone />拨打 120</a></div>{plan?.supportContacts.length ? <div className="emi-support-contacts"><span>联系我的支持者</span>{plan.supportContacts.slice(0, 3).map((contact) => <a key={`${contact.name}-${contact.phone}`} href={`tel:${contact.phone}`} onClick={() => log("contact-opened", { contact: "saved-support" })}><Phone /><strong>{contact.name}</strong><small>{contact.relationship || contact.phone}</small></a>)}</div> : null}<button className="nssi-secondary" type="button" onClick={openSafety}>打开完整安全计划<ShieldCheck /></button>{urgent && <button className="nssi-quiet" type="button" onClick={() => { log("marked-supported"); void onMarkSafe(); }}>我已经联系到现实中的支持</button>}<button className="nssi-quiet" type="button" onClick={close}>暂时关闭此页</button></section></div>;
}

function OfflineSafety({ plan, onRetry }: { plan: SafetyPlanSections; onRetry: () => void }) {
  return <main className="offline-safety-page"><section><div className="brand-mark">此</div><span className="eyebrow">离线安全副本</span><h1>先用已经准备好的安全计划</h1><p>现在无法连接服务端。下面只显示这台设备上最后一次保存的内容；不会调用 AI，也不会自动通知教练。</p><div className="crisis-phone-actions"><a href="tel:12356"><Phone />拨打 12356</a><a href="tel:120"><Phone />危险迫近拨打 120</a></div><div className="offline-plan-grid"><article><strong>我的预警信号</strong>{plan.warningSigns.length ? <ul>{plan.warningSigns.map((item) => <li key={item}>{item}</li>)}</ul> : <p>尚未填写</p>}</article><article><strong>我可以先做的应对</strong>{plan.internalCoping.length ? <ul>{plan.internalCoping.map((item) => <li key={item}>{item}</li>)}</ul> : <p>尚未填写</p>}</article><article><strong>去更安全的人或地方</strong>{plan.peopleAndPlaces.length ? <ul>{plan.peopleAndPlaces.map((item) => <li key={item}>{item}</li>)}</ul> : <p>尚未填写</p>}</article><article><strong>马上联系</strong>{plan.supportContacts.length ? <div className="offline-contacts">{plan.supportContacts.map((item) => <a key={`${item.name}-${item.phone}`} href={`tel:${item.phone}`}><Phone />{item.name}<small>{item.phone}</small></a>)}</div> : <p>尚未填写</p>}</article></div><div className="offline-environment"><ShieldCheck /><p>{plan.environmentSafetyAcknowledgement || emptySafetyPlan.environmentSafetyAcknowledgement}</p></div><button className="nssi-secondary" type="button" onClick={onRetry}><RefreshCw />重新连接服务端</button><small>如果危险正在发生或可能很快行动，不要等待页面恢复，直接联系现实中的人并拨打 120 或 110。</small></section></main>;
}

function SafetyView({ snapshot, token, onRefresh }: { snapshot: Snapshot; token: string; onRefresh: () => Promise<void> }) {
  const cached = typeof window === "undefined" ? null : (() => { try { return JSON.parse(localStorage.getItem(safetyCacheKey) ?? "null") as SafetyPlanSections | null; } catch { return null; } })();
  const initial = snapshot.safetyPlan?.sections ?? cached ?? emptySafetyPlan;
  const [form, setForm] = useState({ warningSigns: joinLines(initial.warningSigns), internalCoping: joinLines(initial.internalCoping), peopleAndPlaces: joinLines(initial.peopleAndPlaces), supportContacts: initial.supportContacts.map((item) => `${item.name}｜${item.phone}`).join("\n"), acknowledged: Boolean((snapshot.safetyPlan?.sections ?? cached)?.environmentSafetyAcknowledgement) });
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  async function save(event: FormEvent) { event.preventDefault(); if (!form.acknowledged) return setNotice("请先阅读并确认环境安全提醒。"); const sections: SafetyPlanSections = { warningSigns: splitLines(form.warningSigns), internalCoping: splitLines(form.internalCoping), peopleAndPlaces: splitLines(form.peopleAndPlaces), supportContacts: splitLines(form.supportContacts).map((line) => { const [name, phone = ""] = line.split(/[｜|]/u); return { name: name.trim(), phone: phone.trim() }; }).filter((item) => item.name && item.phone), professionalResources: emptySafetyPlan.professionalResources, environmentSafetyAcknowledgement: emptySafetyPlan.environmentSafetyAcknowledgement }; if (!sections.warningSigns.length || !sections.internalCoping.length || !sections.supportContacts.length) return setNotice("预警信号、内部应对和支持联系人至少各填写一项。"); setBusy(true); setNotice(""); try { const response = await fetch("/api/nssi/state", { method: "POST", headers: participantHeaders(token), body: JSON.stringify({ action: "safety-plan.save", payload: sections }) }); const payload = await response.json() as { version?: number; error?: string }; if (!response.ok) throw new Error(payload.error ?? "保存失败"); localStorage.setItem(safetyCacheKey, JSON.stringify(sections)); const moduleThree = snapshot.protocol.progress["module-03"]; if (moduleThree && moduleThree.status !== "locked" && moduleThree.status !== "completed") { await fetch("/api/nssi/state", { method: "POST", headers: participantHeaders(token), body: JSON.stringify({ action: "protocol.exercise", moduleId: "module-03", payload: { safetyPlanVersion: payload.version } }) }); } await onRefresh(); setNotice(`第 ${payload.version} 版已加密保存，并更新了本机离线副本。${moduleThree && moduleThree.status !== "locked" ? "安全计划课程也已同步完成。" : ""}`); } catch (cause) { setNotice(cause instanceof Error ? cause.message : "保存失败"); } finally { setBusy(false); } }
  return <div className="nssi-page safety-view"><header className="safety-hero"><span><ShieldCheck /></span><div><span className="eyebrow">两步内可达 · 支持离线副本</span><h1>我的数字安全计划</h1><p>在相对平静时写好。风险升高时，少做临时决定，直接照着已经准备的路径走。</p></div></header><div className="offline-note"><WifiOff /><span>热线卡片与最近保存的计划会保留在本机。退出公共设备前请清除本地数据。</span></div><form className="safety-plan-form" onSubmit={save}><label><span><i>1</i><strong>我开始变得不安全时，会出现哪些信号？</strong></span><textarea value={form.warningSigns} onChange={(event) => setForm({ ...form, warningSigns: event.target.value })} placeholder="每行一项，例如身体、情绪或行为上的变化" /></label><label><span><i>2</i><strong>在联系别人前，我可以先做哪些安全的内部应对？</strong></span><textarea value={form.internalCoping} onChange={(event) => setForm({ ...form, internalCoping: event.target.value })} placeholder="每行一项，只写你愿意实际尝试的办法" /></label><label><span><i>3</i><strong>哪些人或地方能帮助我转移到更安全的环境？</strong></span><textarea value={form.peopleAndPlaces} onChange={(event) => setForm({ ...form, peopleAndPlaces: event.target.value })} placeholder="每行一项" /></label><label><span><i>4</i><strong>我可以直接联系谁？</strong></span><textarea value={form.supportContacts} onChange={(event) => setForm({ ...form, supportContacts: event.target.value })} placeholder="每行一位：姓名｜电话" /></label><section className="professional-resources"><span><i>5</i><strong>专业与紧急资源</strong></span><div><a href="tel:12356"><Phone />12356<small>全国统一心理援助热线</small></a><a href="tel:120"><Phone />120 / 110<small>危险迫近时立即联系</small></a></div></section><label className="environment-ack"><span><i>6</i><strong>环境安全确认</strong></span><p>这一部分只显示临床团队维护的固定内容，不由 AI 生成：风险升高时，和可能造成伤害的物品或地点拉开距离，并请现实中的支持者协助执行安全安排。</p><b><input type="checkbox" checked={form.acknowledged} onChange={(event) => setForm({ ...form, acknowledged: event.target.checked })} />我已阅读并愿意在需要时联系现实中的支持者</b></label>{notice && <p className="save-notice">{notice}</p>}<button className="nssi-primary" type="submit" disabled={busy}>{busy ? "正在加密保存…" : snapshot.safetyPlan ? "保存为新版本" : "保存我的安全计划"}<ShieldCheck /></button>{snapshot.safetyPlan && <small>当前服务端版本：第 {snapshot.safetyPlan.version} 版 · {new Date(snapshot.safetyPlan.createdAt).toLocaleString("zh-CN")}</small>}</form></div>;
}

function ChatView({ snapshot, token, onRisk, onPractice, onRefresh }: { snapshot: Snapshot; token: string; onRisk: () => void; onPractice: () => void; onRefresh: () => Promise<void> }) {
  const [mode, setMode] = useState<ExperienceMode>("companion");
  const [conversationId, setConversationId] = useState(() => { const saved = localStorage.getItem(conversationKey); if (saved) return saved; const created = crypto.randomUUID(); localStorage.setItem(conversationKey, created); return created; });
  const [messages, setMessages] = useState<Message[]>([welcomeConversationMessage()]);
  const [retention, setRetention] = useState<ConversationRetention>(() => (localStorage.getItem(conversationRetentionKey(localStorage.getItem(conversationKey) ?? "")) as ConversationRetention | null) ?? "summary-only");
  const [archiveNotice, setArchiveNotice] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [input, setInput] = useState(""); const [busy, setBusy] = useState(false); const [source, setSource] = useState<SourceCitation | null>(null); const scrollRef = useRef<HTMLDivElement | null>(null); const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoadingHistory(true);
    fetch(`/api/nssi/conversations?conversationId=${encodeURIComponent(conversationId)}`, { headers: participantHeaders(token), cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ review: ConversationReview; transcript: ConversationTranscriptTurn[] }> : null)
      .then((detail) => {
        if (!detail) return;
        setRetention(detail.review.rawRetention);
        localStorage.setItem(conversationRetentionKey(conversationId), detail.review.rawRetention);
        if (detail.transcript.length) {
          setMessages(detail.transcript.map((turn) => turn.role === "user"
            ? { id: turn.id, role: "user", text: turn.content }
            : { id: turn.id, role: "assistant", payload: { kind: "answer", title: "上次的回复", message: turn.content, nextAction: "none", mode: "bridge", experienceMode: "companion" } }));
        } else {
          setMessages([{ id: `recap-${detail.review.id}`, role: "assistant", payload: { kind: "answer", title: detail.review.title, message: `上次你留下的回顾是：“${detail.review.userFocus}”${detail.review.assistantTakeaway ? `。当时整理出的一小步是：${detail.review.assistantTakeaway}` : ""}`, followUpQuestion: detail.review.followUpQuestion ?? "你想从哪一点继续？", suggestedReplies: ["继续说这件事", "回看相关知识", "把它转成一次练习"], nextAction: detail.review.nextAction, mode: "bridge", experienceMode: "companion" } }]);
        }
      })
      .catch(() => undefined)
      .finally(() => setLoadingHistory(false));
    return () => controller.abort();
  }, [conversationId, token]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);
  async function changeRetention(next: ConversationRetention) {
    const previous = retention;
    setRetention(next); setArchiveNotice("");
    localStorage.setItem(conversationRetentionKey(conversationId), next);
    const transcript = messages.filter((item) => item.id !== "welcome" && !item.id.startsWith("recap-")).map((item) => ({ role: item.role, content: item.role === "user" ? item.text ?? "" : item.payload ? safeVisibleMessage(item.payload) : "" })).filter((item) => item.content);
    if (!messages.some((item) => item.role === "user")) return;
    try {
      const response = await fetch("/api/nssi/conversations", { method: "PATCH", headers: participantHeaders(token), body: JSON.stringify({ action: "retention.update", conversationId, retention: next, transcript }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "留存设置没有保存成功");
      setArchiveNotice(next === "summary-only" ? "完整原文已删除；结构化回顾仍保留。" : next === "keep" ? "本次完整对话将保留到你主动删除。" : `本次完整对话将在${next === "7-days" ? "7" : "30"}天后自动删除。`);
      await onRefresh();
    } catch (cause) {
      setRetention(previous); localStorage.setItem(conversationRetentionKey(conversationId), previous);
      setArchiveNotice(cause instanceof Error ? cause.message : "留存设置没有保存成功");
    }
  }
  function startNewConversation() {
    abortRef.current?.abort();
    const created = crypto.randomUUID();
    localStorage.setItem(conversationKey, created);
    localStorage.setItem(conversationRetentionKey(created), "summary-only");
    setConversationId(created); setMessages([welcomeConversationMessage()]); setInput(""); setRetention("summary-only"); setArchiveNotice("已开始一个新话题，上一段对话可以在“记录”中回看。");
  }
  async function send(value = input) {
    const message = value.trim();
    if (!message || busy) return;
    const user: Message = { id: crypto.randomUUID(), role: "user", text: message };
    const history = messages.slice(-6).map((item) => ({
      role: item.role,
      content: item.role === "user" ? item.text ?? "" : item.payload ? safeVisibleMessage(item.payload) : "",
    }));
    setMessages((current) => [...current, user]); setInput(""); setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort("timeout"), 35_000);
    try {
      const response = await fetch("/api/nssi/chat", {
        method: "POST",
        headers: { ...participantHeaders(token), accept: "text/event-stream" },
        body: JSON.stringify({ message, history, experienceMode: mode, conversationId, rawRetention: retention }),
        signal: controller.signal,
      });
      const payload = await readStreamedChat(response);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", payload }]);
      void onRefresh();
      if (payload.kind === "crisis") onRisk();
    } catch (cause) {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", payload: { kind: "refusal", refusalReason: "transport", title: "刚才没有完整连上", message: cause instanceof Error ? cause.message : "请稍后再试。", nextAction: "none", mode: "bridge", experienceMode: mode } }]);
    } finally { window.clearTimeout(timeout); abortRef.current = null; setBusy(false); }
  }
  return <div className="nssi-page chat-view"><header className="chat-header"><div><span className="eyebrow">第 {snapshot.protocol.currentWeek} 周 · 只使用已解锁知识</span><h1>先说说，再一起找一小步</h1></div><div className="mode-switch" role="group" aria-label="回答模式"><button className={mode === "companion" ? "selected" : ""} type="button" onClick={() => setMode("companion")}><MessageCircle />日常引导</button><button className={mode === "deep-read" ? "selected" : ""} type="button" onClick={() => setMode("deep-read")}><BookOpen />专家核对</button></div></header><div className="chat-data-controls"><label><LockKeyhole /><span><strong>本次对话怎么保存</strong><small>{retention === "summary-only" ? "只留可编辑回顾，不保存完整原文" : retention === "keep" ? "完整原文保留到你主动删除" : `完整原文保留 ${retention === "7-days" ? "7" : "30"} 天`}</small></span><select value={retention} onChange={(event) => void changeRetention(event.target.value as ConversationRetention)} aria-label="完整对话保存期限"><option value="summary-only">仅保存回顾</option><option value="7-days">全文保存 7 天</option><option value="30-days">全文保存 30 天</option><option value="keep">长期保存，直到我删除</option></select></label><button type="button" onClick={startNewConversation}><RefreshCw />开始新话题</button></div>{archiveNotice && <p className="chat-archive-notice" role="status">{archiveNotice}</p>}<div className="chat-mode-note"><Info />{mode === "deep-read" ? "显示专业主张、完整原文段落、页码、片段 ID 和验证状态。" : "先回应你的话，专业内容仍附段落级来源，但默认折叠。"}</div><div className="nssi-chat-stream" ref={scrollRef}>{loadingHistory && <div className="chat-history-loading"><RefreshCw className="spin" />正在读取这段对话的回顾…</div>}{messages.map((message, index) => message.role === "user" ? <div className="nssi-user-bubble" key={message.id}>{message.text}</div> : <article className={`nssi-assistant-card ${message.payload?.kind ?? "answer"}`} key={message.id}><ConversationAnswer payload={message.payload} mode={mode} sources={message.payload?.citations ?? []} isLatest={index === messages.length - 1} busy={busy} onPrompt={send} onPractice={onPractice} onSource={setSource} /></article>)}{busy && <div className="chat-thinking"><i /><i /><i /><span>正在先做安全检查，再核对书内依据…</span></div>}</div><form className="nssi-chat-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea value={input} onChange={(event) => setInput(event.target.value.slice(0, 1000))} placeholder="说说刚才发生了什么，或问一个已解锁的技能…" rows={1} /><button type="submit" disabled={!input.trim() || busy || loadingHistory} aria-label="发送"><Send /></button><small>AI 可能出错；专业内容请核对来源。危险迫近时直接联系现实中的人和紧急服务。</small></form>{source && <div className="source-modal" role="dialog" aria-modal="true"><section><button type="button" onClick={() => setSource(null)} aria-label="关闭"><X /></button><span className="eyebrow">{source.paragraphAnchor ?? source.chunkId}</span><h2>{source.section}</h2><p>{source.book} · PDF 第 {source.pdfPage} 页{source.printedPage ? ` · 书中第 ${source.printedPage} 页` : ""} · 第 {(source.paragraphOrdinal ?? 0) + 1} 段</p><blockquote>{source.evidence}</blockquote><small>这是 OCR 派生原文。专业核对时应回看扫描页；引用存在不等于结论已经专业审核。</small></section></div>}</div>;
}

function PracticeDetailSheet({ log, sequence, onClose, onRepeat, onReview }: { log: SkillLog; sequence: number; onClose: () => void; onRepeat: () => void; onReview: () => void }) {
  const skillIds = log.skillIds?.length ? log.skillIds : [log.skillId];
  const change = log.intensityBefore - log.intensityAfter;
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);
  return <div className="practice-detail-backdrop" role="dialog" aria-modal="true" aria-labelledby="practice-detail-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="practice-detail-sheet">
      <button type="button" className="sheet-close" onClick={onClose} aria-label="关闭训练详情"><X /></button>
      <span className="eyebrow">第 {sequence} 次训练 · {new Date(log.usedAt).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
      <h2 id="practice-detail-title">这一次，我具体做了什么？</h2>
      <p>回看不是为了给自己打分，而是找到下次更容易重复的一小步。</p>
      <div className="practice-detail-skills"><small>使用的技能或支持行动</small><div>{skillIds.map((id) => <span key={id}>{practiceOptionLabel(id)}</span>)}</div></div>
      <article className="practice-detail-context"><small>当时主要想应对</small><strong>{log.targetCustom || skillTargetLabel(log.targetType) || "这次没有填写具体情境"}</strong></article>
      <div className="practice-detail-change">
        <span><small>练习前</small><strong>{log.intensityBefore}</strong></span><i><ArrowRight /></i><span><small>练习后</small><strong>{log.intensityAfter}</strong></span>
        <b className={change > 0 ? "down" : change < 0 ? "up" : "same"}>{change > 0 ? `下降 ${change}` : change < 0 ? `升高 ${Math.abs(change)}` : "没有变化"}</b>
      </div>
      <div className="practice-detail-outcomes"><small>我实际观察到</small><div>{log.outcomes.map((outcome) => <span key={outcome}>{skillOutcomeLabel(outcome)}</span>)}</div></div>
      {log.note && <blockquote><small>当时留下的背景</small>{log.note}</blockquote>}
      <div className="practice-review-prompt"><BookOpen /><p><strong>把练习带回学习里</strong><span>回看相关课程时，可以对照：哪些步骤做到了、哪一步最难、下次想保留什么。</span></p></div>
      <div className="practice-detail-actions"><button type="button" className="nssi-secondary" onClick={onReview}><BookOpen />回看相关课程</button><button type="button" className="nssi-primary" onClick={onRepeat}><RefreshCw />按这次再练</button></div>
      <small className="practice-detail-boundary">前后变化可能同时受时间、环境和其他行动影响，只用于个人复盘，不代表疗效。</small>
    </section>
  </div>;
}

function ConversationReviewSheet({ initial, token, onClose, onContinue, onPractice, onChanged }: {
  initial: ConversationReview;
  token: string;
  onClose: () => void;
  onContinue: (review: ConversationReview) => void;
  onPractice: (review: ConversationReview) => void;
  onChanged: () => Promise<void>;
}) {
  const [review, setReview] = useState(initial);
  const [transcript, setTranscript] = useState<ConversationTranscriptTurn[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initial.title);
  const [focus, setFocus] = useState(initial.userFocus);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    fetch(`/api/nssi/conversations?conversationId=${encodeURIComponent(initial.conversationId)}`, { headers: participantHeaders(token), cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("暂时无法读取这次回顾"); return response.json() as Promise<{ review: ConversationReview; transcript: ConversationTranscriptTurn[] }>; })
      .then((detail) => { setReview(detail.review); setTranscript(detail.transcript); setTitle(detail.review.title); setFocus(detail.review.userFocus); })
      .catch((cause) => { if (!controller.signal.aborted) setNotice(cause instanceof Error ? cause.message : "暂时无法读取这次回顾"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [initial.conversationId, onClose, token]);
  async function saveReview() {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/nssi/conversations", { method: "PATCH", headers: participantHeaders(token), body: JSON.stringify({ action: "review.update", conversationId: review.conversationId, title, userFocus: focus }) });
      const detail = await response.json() as { review?: ConversationReview; error?: string };
      if (!response.ok || !detail.review) throw new Error(detail.error ?? "回顾没有保存成功");
      setReview(detail.review); setEditing(false); setNotice("回顾已经按你的表达更新。"); await onChanged();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "回顾没有保存成功"); }
    finally { setBusy(false); }
  }
  async function changeRetention(next: ConversationRetention) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/nssi/conversations", { method: "PATCH", headers: participantHeaders(token), body: JSON.stringify({ action: "retention.update", conversationId: review.conversationId, retention: next, transcript: transcript.map((item) => ({ role: item.role, content: item.content })) }) });
      const detail = await response.json() as { review?: ConversationReview; transcript?: ConversationTranscriptTurn[]; error?: string };
      if (!response.ok || !detail.review) throw new Error(detail.error ?? "留存设置没有保存成功");
      setReview(detail.review); setTranscript(detail.transcript ?? []); setNotice(next === "summary-only" ? "完整原文已删除，只保留这张回顾。" : "完整原文的保存期限已更新。"); await onChanged();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "留存设置没有保存成功"); }
    finally { setBusy(false); }
  }
  async function removeReview() {
    if (!confirmDelete) { setConfirmDelete(true); setNotice("再点一次即可删除这张回顾及其完整原文；安全事件不在这里删除。"); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/nssi/conversations", { method: "DELETE", headers: participantHeaders(token), body: JSON.stringify({ conversationId: review.conversationId }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "删除没有完成");
      await onChanged(); onClose();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "删除没有完成"); setBusy(false); }
  }
  return <div className="conversation-detail-backdrop" role="dialog" aria-modal="true" aria-labelledby="conversation-review-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="conversation-detail-sheet"><button type="button" className="sheet-close" onClick={onClose} aria-label="关闭对话回顾"><X /></button><span className="eyebrow">对话回顾 · {new Date(review.updatedAt).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>{editing ? <div className="conversation-review-editor"><label><span>这次回顾的标题</span><input value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} /></label><label><span>我真正想留下的重点</span><textarea value={focus} maxLength={240} onChange={(event) => setFocus(event.target.value)} /></label><div><button type="button" onClick={() => { setEditing(false); setTitle(review.title); setFocus(review.userFocus); }}>取消</button><button type="button" className="nssi-primary" onClick={() => void saveReview()} disabled={busy || !title.trim()}>保存我的表达<Check /></button></div></div> : <><div className="conversation-review-heading"><h2 id="conversation-review-title">{review.title}</h2><button type="button" onClick={() => setEditing(true)}>修改回顾</button></div><blockquote><small>你明确留下的重点</small>{review.userFocus}</blockquote></>}<article className="conversation-takeaway"><small>当时整理出的一小步</small><p>{review.assistantTakeaway || "这次没有形成需要长期保留的建议。"}</p>{review.followUpQuestion && <strong>{review.followUpQuestion}</strong>}</article>{review.skillLabel && <div className="conversation-linked-skill"><ListChecks /><span><small>关联技能</small><strong>{review.skillLabel}</strong></span></div>}<details className="conversation-transcript" open={review.rawAvailable}><summary><span><strong>完整对话原文</strong><small>{review.rawAvailable ? `${transcript.length} 条 · ${review.rawRetention === "keep" ? "保存至主动删除" : review.rawExpiresAt ? `${new Date(review.rawExpiresAt).toLocaleDateString("zh-CN")} 自动删除` : "按当前设置保存"}` : "本次只保存了回顾"}</small></span><ChevronRight /></summary>{loading ? <p>正在读取…</p> : transcript.length ? <div>{transcript.map((turn) => <article key={turn.id} className={turn.role}><small>{turn.role === "user" ? "我" : "AI"}</small><p>{turn.content}</p></article>)}</div> : <p>没有保存完整原文。结构化回顾仍可用于继续话题和连接练习。</p>}</details><label className="conversation-retention-setting"><LockKeyhole /><span><strong>完整原文保存期限</strong><small>{review.rawAvailable ? "可以缩短期限或立即删除原文" : "如需保存后续原文，请继续对话后开启"}</small></span><select value={review.rawRetention} disabled={busy || !review.rawAvailable} onChange={(event) => void changeRetention(event.target.value as ConversationRetention)}><option value="summary-only">仅保存回顾</option><option value="7-days">全文保存 7 天</option><option value="30-days">全文保存 30 天</option><option value="keep">长期保存</option></select></label>{review.sources.length ? <details className="conversation-review-sources"><summary>查看这次对话引用的书本依据（{review.sources.length}）<ChevronRight /></summary><div>{review.sources.map((source) => <article key={source.chunkId}><strong>{source.section}</strong><small>{source.book} · PDF 第 {source.pdfPage} 页{source.printedPage ? ` · 书中第 ${source.printedPage} 页` : ""}</small><blockquote>{source.evidence}</blockquote></article>)}</div></details> : null}{notice && <p className="save-notice" role="status">{notice}</p>}<div className="conversation-review-actions"><button type="button" onClick={() => onContinue(review)}><MessageCircle />继续这个话题</button><button type="button" className="nssi-primary" onClick={() => onPractice(review)}><ListChecks />转成一次练习</button></div><button type="button" className={`conversation-delete ${confirmDelete ? "confirm" : ""}`} disabled={busy} onClick={() => void removeReview()}><Trash2 />{confirmDelete ? "确认删除这张回顾及原文" : "删除这次对话回顾"}</button><small className="conversation-review-boundary">这是一份用户可编辑的自助回顾，不是诊断、病历或专业人员的临床记录。风险事件采用独立的最小化安全留痕。</small></section></div>;
}

function RecordsView({ snapshot, token, onRefresh, onRisk, onReviewSkill, onContinueConversation }: { snapshot: Snapshot; token: string; onRefresh: () => Promise<void>; onRisk: () => void; onReviewSkill: (skillId: string) => void; onContinueConversation: (conversationId: string) => void }) {
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [targetType, setTargetType] = useState("");
  const [customTargetOpen, setCustomTargetOpen] = useState(false);
  const [targetCustom, setTargetCustom] = useState("");
  const [before, setBefore] = useState<number | null>(null);
  const [after, setAfter] = useState<number | null>(null);
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState<7 | 30>(7);
  const [practiceStep, setPracticeStep] = useState(1);
  const [selectedLog, setSelectedLog] = useState<SkillLog | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<ConversationReview | null>(null);
  const practiceFormRef = useRef<HTMLFormElement | null>(null);
  const logs = snapshot.recentSkillLogs;
  const conversationReviews = snapshot.recentConversationReviews ?? [];
  const practiceStats = snapshot.practiceStats ?? {
    totalSessions: logs.length,
    sessionsLast7Days: logs.length,
    averageIntensityChange: logs.length ? Math.round(logs.reduce((sum, log) => sum + log.intensityBefore - log.intensityAfter, 0) / logs.length * 10) / 10 : null,
    improvedSessions: logs.filter((log) => log.intensityBefore > log.intensityAfter).length,
    unchangedSessions: logs.filter((log) => log.intensityBefore === log.intensityAfter).length,
    worsenedSessions: logs.filter((log) => log.intensityBefore < log.intensityAfter).length,
  };
  const quickIds = useMemo(() => {
    const recent = logs.flatMap((log) => log.skillIds?.length ? log.skillIds : [log.skillId]).map(normalizePracticeOptionId);
    const unlocked = nssiPhase1Modules
      .filter((module) => snapshot.protocol.progress[module.id]?.status !== "locked")
      .flatMap((module) => module.skillCardIds);
    return [...new Set([...recent, ...unlocked, ...QUICK_SKILL_IDS])]
      .filter((id) => DBT_SKILLS.some((skill) => skill.id === id))
      .slice(0, 8);
  }, [logs, snapshot.protocol.progress]);
  const observations = useMemo(() => {
    const groups = new Map<string, { uses: number; change: number; describedHelpful: number; worse: number }>();
    logs.forEach((log) => (log.skillIds?.length ? log.skillIds : [log.skillId]).map(normalizePracticeOptionId).forEach((id) => {
      const value = groups.get(id) ?? { uses: 0, change: 0, describedHelpful: 0, worse: 0 };
      value.uses += 1;
      value.change += log.intensityBefore - log.intensityAfter;
      if (log.outcomes?.some((outcome) => ["paused", "safer", "less-intense", "goal-action", "clearer"].includes(outcome))) value.describedHelpful += 1;
      if (log.outcomes?.includes("worse")) value.worse += 1;
      groups.set(id, value);
    }));
    return [...groups.entries()]
      .filter(([, value]) => value.uses >= 5)
      .map(([id, value]) => ({ id, ...value, average: value.change / value.uses }))
      .sort((left, right) => right.uses - left.uses || right.describedHelpful - left.describedHelpful);
  }, [logs]);
  const moodDistribution = useMemo(() => { const counts = new Map<string, number>(); snapshot.recentEma.slice(0, range).flatMap((item) => item.moods).forEach((mood) => counts.set(mood, (counts.get(mood) ?? 0) + 1)); return [...counts.entries()].sort((a, b) => b[1] - a[1]); }, [snapshot.recentEma, range]);
  async function saveSkill(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    if (!selectedSkillIds.length) return setNotice("请至少选择一个刚才用过的技能或支持行动。");
    if (before === null || after === null) return setNotice("请分别选择使用前和现在的强度；系统不会替你预填答案。");
    if (!outcomes.length) return setNotice("请选择至少一项实际变化；“暂时没感觉”也可以。");
    setBusy(true);
    try {
      const response = await fetch("/api/nssi/state", { method: "POST", headers: participantHeaders(token), body: JSON.stringify({ action: "skill.log", payload: { skillIds: selectedSkillIds, targetType: targetType || undefined, targetCustom: targetCustom.trim() || undefined, intensityBefore: before, intensityAfter: after, outcomes, note } }) });
      const body = await response.json() as { riskEventId?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "这次没有保存成功，请稍后再试。");
      await onRefresh();
      setSelectedSkillIds([]); setTargetType(""); setCustomTargetOpen(false); setTargetCustom(""); setBefore(null); setAfter(null); setOutcomes([]); setNote(""); setPracticeStep(1);
      setNotice("已保存为一次完整练习事件。这里呈现的是你的近期观察，不是疗效结论。");
      if (body.riskEventId) onRisk();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "这次没有保存成功，请稍后再试。");
    } finally { setBusy(false); }
  }
  function toggleOutcome(id: string) {
    if (outcomes.includes(id)) return setOutcomes(outcomes.filter((value) => value !== id));
    if (outcomes.length < 4) setOutcomes([...outcomes, id]);
  }
  function csvCell(value: string | number) { const safe = String(value).replace(/^([=+\-@])/u, "'$1"); return `"${safe.replace(/"/gu, '""')}"`; }
  function exportCsv() { const rows = [["类型", "日期", "项目", "应对目标", "使用前", "使用后", "实际变化"], ...snapshot.recentEma.map((item) => ["EMA", item.localDate, "自伤冲动", "", item.urge, "", ""]), ...logs.map((item) => ["技能练习", item.usedAt, (item.skillIds?.length ? item.skillIds : [item.skillId]).map(practiceOptionLabel).join("、"), item.targetCustom || skillTargetLabel(item.targetType) || "", item.intensityBefore, item.intensityAfter, (item.outcomes ?? []).map(skillOutcomeLabel).join("、")])].map((row) => row.map(csvCell).join(",")); const blob = new Blob([`\uFEFF${rows.join("\n")}`], { type: "text/csv;charset=utf-8" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `此刻-个人记录-${todayLocalDate()}.csv`; link.click(); URL.revokeObjectURL(link.href); }
  const displayedEma = snapshot.recentEma.slice(0, range).reverse();
  const intensityName = targetCustom.trim() || skillTargetIntensityLabel(targetType) || "困扰或冲动";
  const canSave = selectedSkillIds.length > 0 && before !== null && after !== null && outcomes.length > 0;
  function nextPracticeStep() {
    if (practiceStep === 1 && !selectedSkillIds.length) return setNotice("先选一个刚才真正用过的技能或支持行动。");
    if (practiceStep === 3 && (before === null || after === null)) return setNotice("先分别记录练习前和现在的强度。");
    setNotice("");
    setPracticeStep((current) => Math.min(4, current + 1));
  }
  function repeatFromLog(log: SkillLog) {
    setSelectedSkillIds(log.skillIds?.length ? log.skillIds : [log.skillId]);
    setTargetType(log.targetType ?? "");
    setCustomTargetOpen(Boolean(log.targetCustom));
    setTargetCustom(log.targetCustom ?? "");
    setBefore(null); setAfter(null); setOutcomes([]); setNote(""); setNotice("");
    setPracticeStep(3); setSelectedLog(null);
    window.setTimeout(() => practiceFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }
  function practiceFromConversation(review: ConversationReview) {
    const skillId = review.skillId ? normalizePracticeOptionId(review.skillId) : "";
    const hasSkill = skillId && DBT_SKILLS.some((skill) => skill.id === skillId);
    setSelectedSkillIds(hasSkill ? [skillId] : []);
    setTargetType(""); setCustomTargetOpen(Boolean(review.userFocus)); setTargetCustom(review.userFocus.slice(0, 80));
    setBefore(null); setAfter(null); setOutcomes([]); setNote(""); setNotice("");
    setPracticeStep(hasSkill ? 2 : 1); setSelectedConversation(null);
    window.setTimeout(() => practiceFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }
  return <div className="nssi-page nssi-records-view">
    <header className="page-intro"><span className="eyebrow">只用规则计算，不用模型替你下结论</span><h1>看见变化，也保留不确定</h1><p>趋势用于自我观察和与授权的专业人员沟通，不代表诊断或疗效判断。</p><button type="button" onClick={exportCsv}><Download />导出我的 CSV</button></header>
    <section className="conversation-review-card"><header><div><span className="section-kicker"><MessageCircle />对话回顾</span><h2>谈过的话，可以接着往前走</h2><p>默认只保存一张可编辑回顾，不保存完整原文。点开后可以继续话题、连接知识或转成一次练习。</p></div><span>{conversationReviews.length} 次回顾</span></header>{conversationReviews.length ? <div className="conversation-review-list">{conversationReviews.slice(0, 6).map((review) => <button type="button" key={review.id} onClick={() => setSelectedConversation(review)}><span><small>{new Date(review.updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} · {review.exchangeCount} 轮</small><strong>{review.title}</strong><p>{review.userFocus}</p></span><b>{review.skillLabel ? <><ListChecks />{review.skillLabel}</> : <><MessageCircle />继续梳理</>}<small><LockKeyhole />{review.rawAvailable ? review.rawRetention === "keep" ? "全文长期保存" : `全文${review.rawRetention === "7-days" ? "7" : "30"}天` : "仅回顾"}</small></b><ChevronRight /></button>)}</div> : <div className="conversation-review-empty"><MessageCircle /><p><strong>第一次对话后，这里会出现回顾卡</strong><span>它只保存继续学习真正需要的信息；完整原文由你自己决定是否保留。</span></p></div>}</section>
    <section className="trend-card"><div><span className="section-kicker"><BarChart3 />冲动强度记录</span><h2>最近 {range} 天</h2><div className="range-switch"><button type="button" className={range === 7 ? "selected" : ""} onClick={() => setRange(7)}>7 天</button><button type="button" className={range === 30 ? "selected" : ""} onClick={() => setRange(30)}>30 天</button></div></div>{displayedEma.length ? <div className="record-bars">{displayedEma.map((item) => <div key={item.id}><span>{item.urge}</span><i style={{ height: `${Math.max(6, item.urge * 9)}%` }} /><small>{item.localDate.slice(5)}</small></div>)}</div> : <p>还没有记录。完成 EMA 后，这里才开始画趋势。</p>}</section>
    <section className="mood-card"><span className="section-kicker"><Activity />情绪分布</span><h2>这段时间记录过什么情绪？</h2>{moodDistribution.length ? <div>{moodDistribution.map(([mood, count]) => <span key={mood}><strong>{mood}</strong><i style={{ width: `${Math.max(8, count / Math.max(...moodDistribution.map((item) => item[1])) * 100)}%` }} /><small>{count} 次</small></span>)}</div> : <p>还没有可汇总的情绪记录。</p>}</section>
    <section className="effect-card practice-side-card"><span className="section-kicker"><Sparkles />训练积累</span><h2>每一次练习都算数</h2><div className="practice-stat-grid"><article><strong>{practiceStats.totalSessions}</strong><span>累计训练</span></article><article><strong>{practiceStats.sessionsLast7Days}</strong><span>近 7 天</span></article><article><strong>{practiceStats.averageIntensityChange === null ? "—" : practiceStats.averageIntensityChange > 0 ? `↓ ${practiceStats.averageIntensityChange.toFixed(1)}` : practiceStats.averageIntensityChange < 0 ? `↑ ${Math.abs(practiceStats.averageIntensityChange).toFixed(1)}` : "0"}</strong><span>平均前后变化</span></article></div><div className="practice-outcome-strip" aria-label="训练变化分布"><span style={{ flex: practiceStats.improvedSessions || 0 }}><i />缓和 {practiceStats.improvedSessions}</span><span style={{ flex: practiceStats.unchangedSessions || 0 }}><i />不变 {practiceStats.unchangedSessions}</span><span style={{ flex: practiceStats.worsenedSessions || 0 }}><i />升高 {practiceStats.worsenedSessions}</span></div><div className="practice-history"><header><strong>最近几次</strong><small>点击查看完整复盘</small></header>{logs.length ? logs.slice(0, 5).map((log, index) => { const change = log.intensityBefore - log.intensityAfter; return <button type="button" key={log.id} onClick={() => setSelectedLog(log)} aria-label={`查看第 ${practiceStats.totalSessions - index} 次训练详情`}><i>{practiceStats.totalSessions - index}</i><span><strong>{(log.skillIds?.length ? log.skillIds : [log.skillId]).map(practiceOptionLabel).join(" + ")}</strong><small>{log.targetCustom || skillTargetLabel(log.targetType) || new Date(log.usedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</small></span><b className={change > 0 ? "down" : change < 0 ? "up" : "same"}>{log.intensityBefore} → {log.intensityAfter}<small>{change > 0 ? `下降 ${change}` : change < 0 ? `升高 ${Math.abs(change)}` : "没有变化"}</small></b><ChevronRight /></button>; }) : <p>保存第一次练习后，这里会按时间留下轨迹。</p>}</div><details className="practice-observations"><summary>查看重复练习后的共同模式<ChevronRight /></summary>{observations.length ? <div>{observations.map((item) => <article key={item.id}><strong>{practiceOptionLabel(item.id)}</strong><span>记录 {item.uses} 次</span><b>平均强度变化 {item.average > 0 ? "-" : item.average < 0 ? "+" : ""}{Math.abs(item.average).toFixed(1)}</b></article>)}</div> : <p>同一技能至少记录 5 次后才显示个人模式，不凭一次变化下结论。</p>}</details></section>
    <form ref={practiceFormRef} className="skill-log-card" data-practice-step={practiceStep} onSubmit={saveSkill}>
      <span className="section-kicker"><ListChecks />约 45 秒 · 记录一次完整练习</span><h2>刚才用了什么？实际发生了什么？</h2><p className="skill-log-intro">可以组合使用多个技能。没有改善也可以如实记录。</p>
      <div className="practice-progress" aria-label={`练习记录第 ${practiceStep} 步，共 4 步`}><span>{practiceStep} / 4</span><i><b style={{ width: `${practiceStep * 25}%` }} /></i></div>
      <section className="skill-form-step"><header><i>1</i><span><strong>刚才用了什么？</strong><small>至少选一项</small></span></header><SkillPicker selected={selectedSkillIds} onChange={setSelectedSkillIds} quickIds={quickIds} /></section>
      <section className="skill-form-step"><header><i>2</i><span><strong>主要想应对什么？</strong><small>可选常见情境，也可以写自己的</small></span></header><div className="compact-choice-grid">{SKILL_TARGETS.map((target) => <button type="button" key={target.id} className={targetType === target.id ? "selected" : ""} aria-pressed={targetType === target.id} onClick={() => { setTargetType(targetType === target.id ? "" : target.id); setCustomTargetOpen(false); setTargetCustom(""); }}>{target.label}</button>)}<button type="button" className={customTargetOpen ? "selected custom-choice" : "custom-choice"} aria-pressed={customTargetOpen} onClick={() => { setCustomTargetOpen(!customTargetOpen); setTargetType(""); }}>自己填写</button></div>{customTargetOpen && <label className="custom-target-field"><span>用自己的话写下这次情境</span><input autoFocus value={targetCustom} onChange={(event) => setTargetCustom(event.target.value.slice(0, 80))} placeholder="例如：开会前脑子一片空白" /><small>{targetCustom.length} / 80 · 加密保存，并经过安全识别</small></label>}</section>
      <section className="skill-form-step"><header><i>3</i><span><strong>使用前和现在有多强？</strong><small>系统不会预填</small></span></header><div className="skill-intensity-grid"><IntensityField label={`使用前的${intensityName}强度`} value={before} onChange={setBefore} /><IntensityField label={`现在的${intensityName}强度`} value={after} onChange={setAfter} /></div></section>
      <section className="skill-form-step"><header><i>4</i><span><strong>它带来了什么变化？</strong><small>至少选一项，最多 4 项</small></span></header><div className="compact-choice-grid outcome-grid">{SKILL_OUTCOMES.map((outcome) => <button type="button" key={outcome.id} className={outcomes.includes(outcome.id) ? "selected" : ""} aria-pressed={outcomes.includes(outcome.id)} onClick={() => toggleOutcome(outcome.id)}>{outcome.label}</button>)}</div></section>
      <div className="practice-step-nav">{practiceStep > 1 && <button type="button" onClick={() => { setNotice(""); setPracticeStep((current) => Math.max(1, current - 1)); }}><ArrowLeft />上一步</button>}{practiceStep < 4 && <button type="button" onClick={nextPracticeStep}>继续<ArrowRight /></button>}</div>
      <details className="skill-log-more"><summary>补充一点背景（可选）<ChevronRight /></summary><label><span>只写对自己之后回看有帮助的一句话</span><textarea value={note} onChange={(event) => setNote(event.target.value.slice(0, 300))} placeholder="例如：争执后先离开房间，再做了节律呼吸……" /><small>{note.length} / 300 · 保存前会经过安全识别</small></label></details>
      {notice && <p className="save-notice" role="status">{notice}</p>}<div className="skill-log-boundary"><Info />前后变化可能受到时间、环境和其他行动影响，因此这里只做个人观察，不作疗效判断。</div>{practiceStep === 4 && <button className="nssi-primary" type="submit" disabled={busy || !canSave}>{busy ? "正在保存…" : canSave ? "保存这次练习" : "先选择实际变化"}<Check /></button>}
    </form>
    {selectedLog && <PracticeDetailSheet log={selectedLog} sequence={practiceStats.totalSessions - Math.max(0, logs.findIndex((item) => item.id === selectedLog.id))} onClose={() => setSelectedLog(null)} onRepeat={() => repeatFromLog(selectedLog)} onReview={() => { const firstSkill = (selectedLog.skillIds?.length ? selectedLog.skillIds : [selectedLog.skillId]).map(normalizePracticeOptionId).find((id) => DBT_SKILLS.some((skill) => skill.id === id)); setSelectedLog(null); onReviewSkill(firstSkill ?? ""); }} />}
    {selectedConversation && <ConversationReviewSheet initial={selectedConversation} token={token} onClose={() => setSelectedConversation(null)} onContinue={(review) => onContinueConversation(review.conversationId)} onPractice={practiceFromConversation} onChanged={onRefresh} />}
  </div>;
}

function PrivacySheet({ token, onClose, onDeleted }: { token: string; onClose: () => void; onDeleted: () => void }) {
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function downloadArchive() {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/nssi/privacy", { headers: participantHeaders(token), cache: "no-store" });
      if (!response.ok) throw new Error("暂时无法生成导出");
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob); link.download = `此刻-个人数据-${todayLocalDate()}.json`; link.click();
      URL.revokeObjectURL(link.href); setNotice("个人数据已导出到本机。请妥善保存。 ");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "导出失败"); }
    finally { setBusy(false); }
  }
  async function eraseData() {
    if (confirmation !== "确认删除") return setNotice("请输入“确认删除”后再继续。");
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/nssi/privacy", { method: "DELETE", headers: participantHeaders(token), body: JSON.stringify({ confirmation: "DELETE_MY_NSSI_DATA" }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "删除失败");
      localStorage.removeItem(tokenKey); localStorage.removeItem(safetyCacheKey); localStorage.removeItem(conversationKey);
      onDeleted();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "删除失败"); }
    finally { setBusy(false); }
  }
  return <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="privacy-title"><section className="nssi-sheet privacy-sheet"><button type="button" className="sheet-close" onClick={onClose} aria-label="关闭"><X /></button><span className="eyebrow">知情同意 · 数据权利</span><h2 id="privacy-title">你的数据与退出选择</h2><p>日常对话默认只形成加密的、可编辑的回顾，不保存完整原文；你可以在每段对话中另选 7 天、30 天或保留至主动删除。导出包含结构化回顾，不会把未选择保存的原文重新生成出来。</p><p>申请删除后，课程、EMA、安全计划、技能、对话回顾和已保存原文等普通数据会被清除；风险事件与审计事件只保留不可逆去标识化记录，不能再与你的访问令牌关联。</p><div className="privacy-actions"><button type="button" onClick={downloadArchive} disabled={busy}><Download />导出完整个人数据</button><label><span>删除是不可恢复的。继续请输入“确认删除”</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" placeholder="确认删除" /></label><button className="danger-action" type="button" onClick={eraseData} disabled={busy || confirmation !== "确认删除"}><Trash2 />删除普通数据并退出</button></div>{notice && <p className="save-notice" role="status">{notice}</p>}<small>生产上线前，数据保留期限与法律依据仍需由甲方和合规方最终确认。</small></section></div>;
}

export function NssiParticipantApp() {
  const [ready, setReady] = useState(false); const [token, setToken] = useState(""); const [catalog, setCatalog] = useState<CatalogPayload | null>(null); const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const [offlinePlan, setOfflinePlan] = useState<SafetyPlanSections | null>(null); const [view, setView] = useState<AppView>("today"); const [selectedModule, setSelectedModule] = useState<string | null>(null); const [emaOpen, setEmaOpen] = useState(false); const [privacyOpen, setPrivacyOpen] = useState(false); const [emi, setEmi] = useState<OverlayState | null>(null); const [networkError, setNetworkError] = useState("");
  const refreshSnapshot = useCallback(async (currentToken = token) => { if (!currentToken) return; const response = await fetch("/api/nssi/state", { headers: participantHeaders(currentToken), cache: "no-store" }); if (response.status === 401) { localStorage.removeItem(tokenKey); setToken(""); setSnapshot(null); return; } if (!response.ok) throw new Error("暂时无法同步服务端状态"); setSnapshot(await response.json() as Snapshot); }, [token]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [view, selectedModule, token]);
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const savedToken = localStorage.getItem(tokenKey) ?? "";
    const cachedPlan = readCachedSafetyPlan();
    const catalogRequest = fetch("/api/nssi/catalog", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("CATALOG_UNAVAILABLE");
        return response.json() as Promise<CatalogPayload>;
      });
    const snapshotRequest: Promise<SnapshotLoadResult> = savedToken
      ? fetch("/api/nssi/state", { headers: participantHeaders(savedToken), cache: "no-store" })
        .then(async (response): Promise<SnapshotLoadResult> => {
          if (response.status === 401) return { status: "invalid" as const, snapshot: null };
          if (!response.ok) throw new Error("STATE_UNAVAILABLE");
          return { status: "ok" as const, snapshot: await response.json() as Snapshot };
        })
      : Promise.resolve({ status: "empty" as const, snapshot: null });
    Promise.allSettled([catalogRequest, snapshotRequest]).then(([catalogResult, snapshotResult]) => {
      setOfflinePlan(cachedPlan);
      setToken(savedToken);
      if (catalogResult.status === "fulfilled") setCatalog(catalogResult.value);
      if (snapshotResult.status === "fulfilled") {
        setSnapshot(snapshotResult.value.snapshot);
        if (snapshotResult.value.status === "invalid") {
          localStorage.removeItem(tokenKey); setToken("");
        }
      }
      if (catalogResult.status === "rejected" || snapshotResult.status === "rejected") {
        setNetworkError("服务端状态暂时没有同步。安全计划的本机副本仍然可用。");
      }
    }).finally(() => setReady(true));
  }, []);
  async function help() { if (!token) return; setEmi({ trigger: true, intervention: "help", reasonCodes: ["HELP_BUTTON"] }); try { await fetch("/api/nssi/state", { method: "POST", headers: participantHeaders(token), body: JSON.stringify({ action: "risk.help" }) }); await refreshSnapshot(); } catch { /* Crisis UI remains available. */ } }
  async function enablePush() {
    const delivery = catalog?.delivery;
    if (!delivery?.configured || !delivery.publicKey) throw new Error("服务端还没有配置推送通道");
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("当前浏览器不支持网页提醒");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("你没有授权浏览器提醒，可以稍后在浏览器设置中开启");
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: pushApplicationKey(delivery.publicKey),
    });
    const response = await fetch("/api/nssi/push", {
      method: "POST",
      headers: participantHeaders(token),
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error ?? "提醒订阅没有保存成功");
    await refreshSnapshot();
  }
  if (ready && token && !snapshot && offlinePlan) return <OfflineSafety plan={offlinePlan} onRetry={() => location.reload()} />;
  if (!ready || !catalog) return <main className="nssi-loading"><div className="brand-mark">此</div><RefreshCw className="spin" /><h1>{ready ? "暂时无法连接服务端" : "正在打开页面"}</h1><p>{ready ? "如果这台设备保存过安全计划，系统会优先显示离线副本。请检查网络后重试。" : "正在准备 8 周训练计划、书本内容收录情况与安全支持入口。"}</p>{ready && <div className="crisis-phone-actions"><a href="tel:12356"><Phone />拨打 12356</a><a href="tel:120"><Phone />危险迫近拨打 120</a></div>}<small>DBT 自助练习助手 · 日常引导与专家核对双模式</small></main>;
  if (!token || !snapshot) return <Enrollment onEnrolled={(newToken, newSnapshot) => { setToken(newToken); setSnapshot(newSnapshot); }} />;
  return <main className={`nssi-app view-${view}`}>
    <header className="nssi-topbar">
      <button className="nssi-brand" type="button" onClick={() => { setView("today"); setSelectedModule(null); }}><span className="brand-mark">此</span><span><strong>此刻</strong><small>NSSI · DBT 数字化干预</small></span></button>
      <div className="topbar-status"><span className={navigator.onLine ? "online" : "offline"}>{navigator.onLine ? "已安全连接" : "离线模式"}</span><small>内部开发版 · 内容待专业审核</small></div>
      <button className="privacy-link" type="button" onClick={() => setPrivacyOpen(true)}>数据与退出</button>
      <button className="global-help" type="button" onClick={help}><CircleAlert />我现在需要帮助</button>
    </header>
    {networkError && <button className="network-banner" type="button" onClick={() => location.reload()}>{networkError}<RefreshCw /></button>}
    <div className="nssi-content">
      {view === "today" && <TodayView snapshot={snapshot} modules={catalog.modules} pushConfigured={catalog.delivery?.configured === true} onEnablePush={enablePush} onView={setView} onModule={(id) => { setSelectedModule(id); setView("modules"); }} onEma={() => setEmaOpen(true)} onNotification={async (id) => { await fetch("/api/nssi/state", { method: "POST", headers: participantHeaders(token), body: JSON.stringify({ action: "notification.read", notificationId: id }) }); await refreshSnapshot(); }} />}
      {view === "modules" && <ModulesView snapshot={snapshot} modules={catalog.modules} selectedId={selectedModule} onSelect={setSelectedModule} token={token} onRefresh={() => refreshSnapshot()} onSafety={() => setView("safety")} onPractice={() => setView("records")} onChat={() => setView("chat")} onEma={() => setEmaOpen(true)} />}
      {view === "chat" && <ChatView snapshot={snapshot} token={token} onPractice={() => setView("records")} onRefresh={() => refreshSnapshot()} onRisk={() => { setEmi({ trigger: true, intervention: "crisis", reasonCodes: ["CHAT_RISK"] }); void refreshSnapshot(); }} />}
      {view === "safety" && <SafetyView snapshot={snapshot} token={token} onRefresh={() => refreshSnapshot()} />}
      {view === "records" && <RecordsView snapshot={snapshot} token={token} onRefresh={() => refreshSnapshot()} onRisk={() => setEmi({ trigger: true, intervention: "crisis", reasonCodes: ["SKILL_NOTE_RISK"] })} onContinueConversation={(conversationId) => { localStorage.setItem(conversationKey, conversationId); setView("chat"); }} onReviewSkill={(skillId) => { const related = catalog.modules.find((module) => module.skillCardIds.includes(skillId) && snapshot.protocol.progress[module.id]?.status !== "locked"); setSelectedModule(related?.id ?? null); setView("modules"); }} />}
    </div>
    <nav className="nssi-bottom-nav" aria-label="主要页面">{([["today", "今天", Home], ["modules", "课程", BookOpen], ["chat", "对话", MessageCircle], ["safety", "安全计划", ShieldCheck], ["records", "记录", BarChart3]] as const).map(([id, label, Icon]) => <button key={id} type="button" className={view === id ? "selected" : ""} onClick={() => { setView(id); if (id !== "modules") setSelectedModule(null); }}><Icon /><span>{label}</span></button>)}</nav>
    {emaOpen && <EmaSheet token={token} initial={snapshot.todayEma} allowBackfill={!snapshot.recentEma.some((item) => item.localDate === yesterdayLocalDate())} onClose={() => setEmaOpen(false)} onSaved={async (result) => { setEmaOpen(false); await refreshSnapshot(); if (result.trigger) setEmi(result); }} />}
    {privacyOpen && <PrivacySheet token={token} onClose={() => setPrivacyOpen(false)} onDeleted={() => { setPrivacyOpen(false); setToken(""); setSnapshot(null); }} />}
    {emi && <EmiOverlay result={emi} plan={snapshot.safetyPlan?.sections ?? offlinePlan} token={token} onSafety={() => { setEmi(null); setView("safety"); }} onClose={() => setEmi(null)} onMarkSafe={async () => { const riskEventId = snapshot.activeRiskEvent?.id; if (riskEventId) { await fetch("/api/nssi/state", { method: "POST", headers: participantHeaders(token), body: JSON.stringify({ action: "risk.mark-safe", riskEventId }) }); await refreshSnapshot(); } setEmi(null); }} />}
  </main>;
}
