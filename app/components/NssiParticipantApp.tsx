"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowLeft, ArrowRight, BarChart3, BookOpen, Check, ChevronRight,
  CircleAlert, ClipboardCheck, Download, HeartHandshake, Home, Info, ListChecks,
  LockKeyhole, MessageCircle, Phone, RefreshCw, Send, ShieldCheck, Sparkles,
  Trash2, UserRoundCheck, WifiOff, X,
} from "lucide-react";
import type { ChatPayload, ExperienceMode, SourceCitation } from "../../lib/dbt-content";
import type {
  EmaRecord, ParticipantSnapshot, ProtocolModule, SafetyPlanSections,
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
};
type Snapshot = ParticipantSnapshot & { recentEma: EmaRecord[] };
type ModuleDetail = { module: ProtocolModule; citations: SourceCitation[] };
type Message = { id: string; role: "user" | "assistant"; text?: string; payload?: ChatPayload & { riskEventId?: string } };
type EmiResult = { trigger: boolean; intervention: "none" | "stop" | "self-reminder" | "safety-plan" | "crisis"; reasonCodes: string[]; suggestedSkillId?: string };
type OverlayState = EmiResult | { trigger: true; intervention: "help" | "crisis"; reasonCodes: string[] };
type SnapshotLoadResult = { status: "ok"; snapshot: Snapshot } | { status: "invalid" | "empty"; snapshot: null };

const tokenKey = "nssi-participant-token-v1";
const safetyCacheKey = "nssi-safety-plan-offline-v1";
const conversationKey = "nssi-conversation-id-v1";
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
function statusLabel(status: string) { return status === "completed" ? "已完成" : status === "in-progress" ? "进行中" : status === "available" ? "可开始" : "未解锁"; }
function safeVisibleMessage(payload: ChatPayload) { return [payload.title, payload.message, payload.followUpQuestion, ...(payload.steps ?? [])].filter(Boolean).join(" "); }

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
        <label className="consent-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>我已阅读并同意 AI 参与、数据用途和风险监测说明</span></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="nssi-primary" type="submit" disabled={busy || !adult || !accepted}>{busy ? "正在建立训练计划…" : "建立我的训练计划"}<ArrowRight /></button>
        <small>一期内部开发版本 · 未成年人暂不纳入</small>
      </form>
    </main>
  );
}

function TodayView({ snapshot, modules, onView, onModule, onEma, onNotification }: { snapshot: Snapshot; modules: ProtocolModule[]; onView: (view: AppView) => void; onModule: (id: string) => void; onEma: () => void; onNotification: (id: string) => void }) {
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
      <section className="today-grid">
        <article className="current-module-card"><div className="card-headline"><span><BookOpen />今天的课程</span><small>约 {current.estimatedMinutes} 分钟</small></div><p>第 {current.ordinal} 模块</p><h2>{current.title}</h2><p>{current.purpose}</p><button type="button" onClick={() => onModule(current.id)}>{snapshot.protocol.progress[current.id]?.status === "in-progress" ? "继续这一课" : "开始这一课"}<ArrowRight /></button></article>
        <article className={`ema-card ${emaDone ? "done" : ""}`}><div className="card-headline"><span><Activity />今日状态记录</span><small>{streak ? `连续 ${streak} 天` : emaDone ? "已完成" : "约 60 秒"}</small></div><h2>{emaDone ? "今天已经记录好了" : "现在的冲动和情绪怎么样？"}</h2><p>{emaDone ? `本次冲动强度 ${snapshot.todayEma?.urge}/10。需要时仍可直接求助。` : "这不是考试。简短记录能帮助系统在合适的时候给出技能入口。"}</p><button type="button" onClick={onEma}>{emaDone ? "更新今天的记录" : "开始记录或补记"}<ArrowRight /></button>{emaDone && <span className="done-mark"><Check />已记录</span>}</article>
      </section>
      <section className="today-insight"><div><span className="eyebrow">近 7 次记录</span><h2>不是给情绪打分，是看见它怎样变化</h2></div>{recent.length ? <div className="mini-trend" aria-label="近期冲动强度趋势">{recent.map((record) => <div key={record.id}><i style={{ height: `${Math.max(8, record.urge * 9)}%` }} /><span>{record.urge}</span></div>)}</div> : <p>完成第一次 EMA 后，这里会出现只对你可见的趋势。</p>}<button type="button" onClick={() => onView("records")}>查看记录与技能效果<ChevronRight /></button></section>
      <section className="today-shortcuts"><button type="button" onClick={() => onView("chat")}><MessageCircle /><span><strong>和伴读助手说说</strong>先回应你，再找当前阶段可用的方法</span><ChevronRight /></button><button type="button" onClick={() => onView("safety")}><ShieldCheck /><span><strong>查看安全计划</strong>{snapshot.safetyPlan ? `已保存第 ${snapshot.safetyPlan.version} 版` : "提前准备，风险升高时少做决定"}</span><ChevronRight /></button></section>
    </div>
  );
}

function ModulesView({ snapshot, modules, selectedId, onSelect, token, onRefresh, onSafety }: { snapshot: Snapshot; modules: ProtocolModule[]; selectedId: string | null; onSelect: (id: string | null) => void; token: string; onRefresh: () => Promise<void>; onSafety: () => void }) {
  const [detail, setDetail] = useState<ModuleDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [notice, setNotice] = useState("");
  useEffect(() => { if (!selectedId) return; let cancelled = false; fetch(`/api/nssi/module?moduleId=${encodeURIComponent(selectedId)}&evidenceVersion=${moduleEvidenceVersion}`, { cache: "no-store" }).then((response) => response.json()).then((value) => { if (!cancelled) setDetail(value as ModuleDetail); }); return () => { cancelled = true; }; }, [selectedId]);
  async function stateAction(body: Record<string, unknown>) { const response = await fetch("/api/nssi/state", { method: "POST", headers: participantHeaders(token), body: JSON.stringify(body) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? "保存失败"); await onRefresh(); }
  async function markRead() { if (!detail) return; setNotice(""); try { await stateAction({ action: "protocol.reading", moduleId: detail.module.id, progress: 1 }); setNotice("阅读进度已保存。完成下面的练习后，这一模块才会结束。"); } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); } }
  async function submitExercise(event: FormEvent) { event.preventDefault(); if (!detail) return; const required = detail.module.exercise.fields.filter((field) => field.required); if (required.some((field) => !answers[field.id] || (Array.isArray(answers[field.id]) && !(answers[field.id] as string[]).length))) return setNotice("先完成标有必填的内容。可以写得很短，不需要一次做到完美。"); try { await stateAction({ action: "protocol.exercise", moduleId: detail.module.id, payload: answers }); setNotice("这一模块已完成，下一模块会按计划和前置条件开放。"); } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); } }
  if (!selectedId) return <div className="nssi-page modules-view"><header className="page-intro"><span className="eyebrow">8 周 · 16 个模块</span><h1>每周两小步，顺着同一条路径往前走</h1><p>解锁与完成由协议状态机判断。AI 可以解释内容，但不能跳过前置练习或替你完成。</p></header><div className="week-list">{Array.from({ length: 8 }, (_, index) => index + 1).map((week) => <section key={week}><div className="week-heading"><span>第 {week} 周</span><i /></div><div className="week-modules">{modules.filter((module) => module.week === week).map((module) => { const status = snapshot.protocol.progress[module.id]?.status ?? "locked"; return <button key={module.id} type="button" disabled={status === "locked"} onClick={() => onSelect(module.id)}><span className={`module-number ${status}`}>{status === "completed" ? <Check /> : status === "locked" ? <LockKeyhole /> : module.ordinal}</span><span><small>{statusLabel(status)} · 约 {module.estimatedMinutes} 分钟</small><strong>{module.title}</strong><p>{module.purpose}</p></span><ChevronRight /></button>; })}</div></section>)}</div></div>;
  if (!detail || detail.module.id !== selectedId) return <div className="nssi-page loading-state"><RefreshCw className="spin" /><p>正在准备课程与原文段落索引…</p></div>;
  const progress = snapshot.protocol.progress[detail.module.id];
  const primaryCitationCount = detail.citations.filter((citation) => citation.presentationRole === "primary").length;
  const supportingCitationCount = detail.citations.length - primaryCitationCount;
  return (
    <div className="nssi-page module-detail-view">
      <button className="back-button" type="button" onClick={() => onSelect(null)}><ArrowLeft />返回课程</button>
      <header className="module-hero"><span className="eyebrow">第 {detail.module.week} 周 · 第 {detail.module.ordinal} 模块 · {statusLabel(progress.status)}</span><h1>{detail.module.title}</h1><p>{detail.module.purpose}</p><div><span>约 {detail.module.estimatedMinutes} 分钟</span><span>内容状态：内部草案，待专业审核</span></div></header>
      <section className="learning-card"><span className="section-kicker"><Sparkles />先理解这一点</span><p>{detail.module.introduction}</p><div className="module-boundary"><Info />这段课程正文是版本化内容，不由聊天模型临时生成。涉及现实危险时，优先使用全局求助入口。</div><button type="button" className="nssi-secondary" onClick={markRead} disabled={progress.readingProgress >= 0.9}>{progress.readingProgress >= 0.9 ? <><Check />已完成阅读</> : <>我已经读完这一节<ArrowRight /></>}</button></section>
      <section className="module-media-placeholder" aria-label="课程音视频"><span className="section-kicker"><BookOpen />音视频课程</span><h2>{detail.module.media?.status === "available" ? "本节配套内容" : "本节音视频素材待接入"}</h2>{detail.module.media?.status === "available" && detail.module.media.url ? <a href={detail.module.media.url} target="_blank" rel="noreferrer">打开经审核的音视频内容<ArrowRight /></a> : <p>播放器位置和版本接口已经保留；甲方提供经授权素材后可直接配置，不由 AI 自动生成课程。</p>}</section>
      {detail.module.id === "module-03" ? <section className="exercise-card safety-exercise-card"><span className="section-kicker"><ShieldCheck />本节练习</span><h2>{detail.module.exercise.title}</h2><p>课程中的安全计划和全局安全计划使用同一份数据，不需要重复填写。</p><button className="nssi-primary" type="button" onClick={onSafety}>打开并完成安全计划<ArrowRight /></button></section> : (
        <form className="exercise-card" onSubmit={submitExercise}><span className="section-kicker"><ClipboardCheck />本节练习</span><h2>{detail.module.exercise.title}</h2><p>{detail.module.exercise.prompt}</p>{detail.module.exercise.fields.map((field) => <label key={field.id} className="exercise-field"><span>{field.label}{field.required && <i>必填</i>}</span>{field.kind === "textarea" && <textarea value={String(answers[field.id] ?? "")} onChange={(event) => setAnswers((current) => ({ ...current, [field.id]: event.target.value }))} placeholder="写一两句就可以" />}{field.kind === "text" && <input value={String(answers[field.id] ?? "")} onChange={(event) => setAnswers((current) => ({ ...current, [field.id]: event.target.value }))} />}{field.kind === "scale" && <div className="scale-choices">{field.options?.map((option) => <button key={option} type="button" className={answers[field.id] === option ? "selected" : ""} onClick={() => setAnswers((current) => ({ ...current, [field.id]: option }))}>{option}</button>)}</div>}{field.kind === "multi-select" && <div className="chip-choices">{field.options?.map((option) => { const selected = (answers[field.id] as string[] | undefined)?.includes(option); return <button key={option} type="button" className={selected ? "selected" : ""} onClick={() => setAnswers((current) => { const before = current[field.id] as string[] | undefined ?? []; return { ...current, [field.id]: selected ? before.filter((item) => item !== option) : [...before, option] }; })}>{option}</button>; })}</div>}</label>)}{notice && <p className="save-notice" role="status">{notice}</p>}<button className="nssi-primary" type="submit">提交练习并检查完成条件<ArrowRight /></button></form>
      )}
      {detail.module.id === "module-03" && notice && <p className="save-notice">{notice}</p>}
      <details className="module-sources"><summary><BookOpen /><span><strong>查看本节原文依据</strong><small>{primaryCitationCount} 条核心原文{supportingCitationCount ? ` · ${supportingCitationCount} 条补充材料` : ""}</small></span><ChevronRight /></summary><div className="module-source-list">{detail.citations.map((citation, index) => <details className="module-source-item" key={citation.id} open={index === 0}><summary><span><i>{citation.presentationRole === "primary" ? "核心原文" : citation.contentType === "worksheet" ? "练习材料" : "补充说明"}</i><strong>{citation.section}</strong></span><small>{citation.printedPage ? `书中 ${citation.printedPage} 页` : `PDF ${citation.pdfPage} 页`}<ChevronRight /></small></summary><div><blockquote>{citation.evidence}</blockquote><small>{citation.paragraphAnchor ?? citation.chunkId} · OCR 派生原文，专业核对时需回看扫描页</small></div></details>)}</div></details>
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

function EmiOverlay({ result, onSafety, onClose, onMarkSafe }: { result: OverlayState; onSafety: () => void; onClose: () => void; onMarkSafe: () => Promise<void> }) {
  const type = result.intervention;
  const urgent = type === "crisis" || type === "help" || type === "safety-plan";
  const remembered = type === "self-reminder";
  return <div className="crisis-backdrop" role="dialog" aria-modal="true" aria-labelledby="crisis-title"><section className="crisis-panel"><span className="crisis-symbol"><HeartHandshake /></span><span className="eyebrow">{urgent ? "安全支持已打开" : remembered ? "先回到曾经有一点帮助的做法" : "先停一下，不急着解决全部"}</span><h2 id="crisis-title">{urgent ? "现在先把现实中的安全放在第一位" : remembered ? "不必临时想出全新的办法" : "冲动已经比较强，先为自己争取一点停顿"}</h2><p>{urgent ? "风险事件已进入教练端队列，但系统不承诺实时人工回复。危险正在发生或可能很快行动时，请直接联系现实中的人并拨打紧急电话。" : remembered ? `按你自己的前后记录，${"suggestedSkillId" in result && result.suggestedSkillId ? practiceOptionLabel(result.suggestedSkillId) : "之前练过的方法"}曾带来过一点变化。可以先重复一次；这只是规则汇总，不是疗效判断。` : "先停止手上的动作，退后一步，观察身体和周围。然后从安全计划里选一个现实支持。"}</p><div className="crisis-now-steps"><span><strong>1</strong>移动到有人、相对安全的地方</span><span><strong>2</strong>联系一个能保持通话或到场的人</span><span><strong>3</strong>危险迫近时拨打 120 或 110</span></div><div className="crisis-phone-actions"><a href="tel:12356"><Phone />拨打 12356</a><a href="tel:120"><Phone />拨打 120</a></div><button className="nssi-primary" type="button" onClick={onSafety}>打开我的安全计划<ShieldCheck /></button><button className="nssi-quiet" type="button" onClick={() => void onMarkSafe()}>我现在已联系到现实中的支持</button><button className="nssi-quiet" type="button" onClick={onClose}>暂时关闭此页</button></section></div>;
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

function ChatView({ snapshot, token, onRisk }: { snapshot: Snapshot; token: string; onRisk: () => void }) {
  const [mode, setMode] = useState<ExperienceMode>("companion");
  const [messages, setMessages] = useState<Message[]>([{ id: "welcome", role: "assistant", payload: { kind: "answer", title: "先从今天最难的那一点开始", message: "你不需要先知道该用什么技能。可以说说刚才发生了什么，或者现在最难受的是什么；我会先听懂，再从已经解锁的内容里找一小步。", suggestedReplies: ["我现在情绪很强", "一件事在脑子里反复转", "我想学当前模块"], nextAction: "none", mode: "bridge", experienceMode: "companion" } }]);
  const [input, setInput] = useState(""); const [busy, setBusy] = useState(false); const [source, setSource] = useState<SourceCitation | null>(null); const scrollRef = useRef<HTMLDivElement | null>(null);
  const conversationId = useMemo(() => { const saved = localStorage.getItem(conversationKey); if (saved) return saved; const created = crypto.randomUUID(); localStorage.setItem(conversationKey, created); return created; }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);
  async function send(value = input) {
    const message = value.trim();
    if (!message || busy) return;
    const user: Message = { id: crypto.randomUUID(), role: "user", text: message };
    const history = messages.slice(-6).map((item) => ({
      role: item.role,
      content: item.role === "user" ? item.text ?? "" : item.payload ? safeVisibleMessage(item.payload) : "",
    }));
    setMessages((current) => [...current, user]); setInput(""); setBusy(true);
    try {
      const response = await fetch("/api/nssi/chat", {
        method: "POST",
        headers: { ...participantHeaders(token), accept: "text/event-stream" },
        body: JSON.stringify({ message, history, experienceMode: mode, conversationId }),
      });
      const payload = await readStreamedChat(response);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", payload }]);
      if (payload.kind === "crisis") onRisk();
    } catch (cause) {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", payload: { kind: "refusal", refusalReason: "transport", title: "刚才没有完整连上", message: cause instanceof Error ? cause.message : "请稍后再试。", nextAction: "none", mode: "bridge", experienceMode: mode } }]);
    } finally { setBusy(false); }
  }
  return <div className="nssi-page chat-view"><header className="chat-header"><div><span className="eyebrow">第 {snapshot.protocol.currentWeek} 周 · 只使用已解锁知识</span><h1>先说说，再一起找一小步</h1></div><div className="mode-switch" role="group" aria-label="回答模式"><button className={mode === "companion" ? "selected" : ""} type="button" onClick={() => setMode("companion")}><MessageCircle />日常引导</button><button className={mode === "deep-read" ? "selected" : ""} type="button" onClick={() => setMode("deep-read")}><BookOpen />专家核对</button></div></header><div className="chat-mode-note"><Info />{mode === "deep-read" ? "显示专业主张、完整原文段落、页码、片段 ID 和验证状态。" : "先回应你的话，专业内容仍附段落级来源，但默认折叠。"}</div><div className="nssi-chat-stream" ref={scrollRef}>{messages.map((message, index) => message.role === "user" ? <div className="nssi-user-bubble" key={message.id}>{message.text}</div> : <article className={`nssi-assistant-card ${message.payload?.kind ?? "answer"}`} key={message.id}><ConversationAnswer payload={message.payload} mode={mode} sources={message.payload?.citations ?? []} isLatest={index === messages.length - 1} busy={busy} onPrompt={send} onPractice={() => send("请带我用当前已解锁的技能练一小步。")} onSource={setSource} /></article>)}{busy && <div className="chat-thinking"><i /><i /><i /><span>正在先做安全检查，再核对书内依据…</span></div>}</div><form className="nssi-chat-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea value={input} onChange={(event) => setInput(event.target.value.slice(0, 1000))} placeholder="说说刚才发生了什么，或问一个已解锁的技能…" rows={1} /><button type="submit" disabled={!input.trim() || busy} aria-label="发送"><Send /></button><small>AI 可能出错；专业内容请核对来源。危险迫近时直接联系现实中的人和紧急服务。</small></form>{source && <div className="source-modal" role="dialog" aria-modal="true"><section><button type="button" onClick={() => setSource(null)} aria-label="关闭"><X /></button><span className="eyebrow">{source.paragraphAnchor ?? source.chunkId}</span><h2>{source.section}</h2><p>{source.book} · PDF 第 {source.pdfPage} 页{source.printedPage ? ` · 书中第 ${source.printedPage} 页` : ""} · 第 {(source.paragraphOrdinal ?? 0) + 1} 段</p><blockquote>{source.evidence}</blockquote><small>这是 OCR 派生原文。专业核对时应回看扫描页；引用存在不等于结论已经专业审核。</small></section></div>}</div>;
}

function RecordsView({ snapshot, token, onRefresh, onRisk }: { snapshot: Snapshot; token: string; onRefresh: () => Promise<void>; onRisk: () => void }) {
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [targetType, setTargetType] = useState("");
  const [before, setBefore] = useState<number | null>(null);
  const [after, setAfter] = useState<number | null>(null);
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState<7 | 30>(7);
  const logs = snapshot.recentSkillLogs;
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
      const response = await fetch("/api/nssi/state", { method: "POST", headers: participantHeaders(token), body: JSON.stringify({ action: "skill.log", payload: { skillIds: selectedSkillIds, targetType: targetType || undefined, intensityBefore: before, intensityAfter: after, outcomes, note } }) });
      const body = await response.json() as { riskEventId?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "这次没有保存成功，请稍后再试。");
      await onRefresh();
      setSelectedSkillIds([]); setTargetType(""); setBefore(null); setAfter(null); setOutcomes([]); setNote("");
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
  function exportCsv() { const rows = [["类型", "日期", "项目", "应对目标", "使用前", "使用后", "实际变化"], ...snapshot.recentEma.map((item) => ["EMA", item.localDate, "自伤冲动", "", item.urge, "", ""]), ...logs.map((item) => ["技能练习", item.usedAt, (item.skillIds?.length ? item.skillIds : [item.skillId]).map(practiceOptionLabel).join("、"), skillTargetLabel(item.targetType) ?? "", item.intensityBefore, item.intensityAfter, (item.outcomes ?? []).map(skillOutcomeLabel).join("、")])].map((row) => row.map(csvCell).join(",")); const blob = new Blob([`\uFEFF${rows.join("\n")}`], { type: "text/csv;charset=utf-8" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `此刻-个人记录-${todayLocalDate()}.csv`; link.click(); URL.revokeObjectURL(link.href); }
  const displayedEma = snapshot.recentEma.slice(0, range).reverse();
  const intensityName = skillTargetIntensityLabel(targetType) ?? "困扰或冲动";
  const canSave = selectedSkillIds.length > 0 && before !== null && after !== null && outcomes.length > 0;
  return <div className="nssi-page nssi-records-view">
    <header className="page-intro"><span className="eyebrow">只用规则计算，不用模型替你下结论</span><h1>看见变化，也保留不确定</h1><p>趋势用于自我观察和与授权的专业人员沟通，不代表诊断或疗效判断。</p><button type="button" onClick={exportCsv}><Download />导出我的 CSV</button></header>
    <section className="trend-card"><div><span className="section-kicker"><BarChart3 />冲动强度记录</span><h2>最近 {range} 天</h2><div className="range-switch"><button type="button" className={range === 7 ? "selected" : ""} onClick={() => setRange(7)}>7 天</button><button type="button" className={range === 30 ? "selected" : ""} onClick={() => setRange(30)}>30 天</button></div></div>{displayedEma.length ? <div className="record-bars">{displayedEma.map((item) => <div key={item.id}><span>{item.urge}</span><i style={{ height: `${Math.max(6, item.urge * 9)}%` }} /><small>{item.localDate.slice(5)}</small></div>)}</div> : <p>还没有记录。完成 EMA 后，这里才开始画趋势。</p>}</section>
    <section className="mood-card"><span className="section-kicker"><Activity />情绪分布</span><h2>这段时间记录过什么情绪？</h2>{moodDistribution.length ? <div>{moodDistribution.map(([mood, count]) => <span key={mood}><strong>{mood}</strong><i style={{ width: `${Math.max(8, count / Math.max(...moodDistribution.map((item) => item[1])) * 100)}%` }} /><small>{count} 次</small></span>)}</div> : <p>还没有可汇总的情绪记录。</p>}</section>
    <section className="effect-card"><span className="section-kicker"><Sparkles />近期观察</span><h2>哪些做法值得继续观察？</h2>{observations.length ? <div>{observations.map((item) => <article key={item.id}><strong>{practiceOptionLabel(item.id)}</strong><span>记录 {item.uses} 次</span><b>平均强度变化 {item.average > 0 ? "-" : item.average < 0 ? "+" : ""}{Math.abs(item.average).toFixed(1)}</b>{item.describedHelpful > 0 && <small>{item.describedHelpful} 次记录了正向变化{item.worse ? ` · ${item.worse} 次更难受` : ""}</small>}</article>)}</div> : <p>同一技能至少记录 5 次后才显示个人模式；这里只呈现共同出现的变化，不判断疗效，也不替你选“最佳技能”。</p>}</section>
    <form className="skill-log-card" onSubmit={saveSkill}>
      <span className="section-kicker"><ListChecks />约 45 秒 · 记录一次完整练习</span><h2>刚才用了什么？实际发生了什么？</h2><p className="skill-log-intro">可以组合使用多个技能。没有改善也可以如实记录。</p>
      <section className="skill-form-step"><header><i>1</i><span><strong>刚才用了什么？</strong><small>至少选一项</small></span></header><SkillPicker selected={selectedSkillIds} onChange={setSelectedSkillIds} quickIds={quickIds} /></section>
      <section className="skill-form-step"><header><i>2</i><span><strong>主要想应对什么？</strong><small>可不选</small></span></header><div className="compact-choice-grid">{SKILL_TARGETS.map((target) => <button type="button" key={target.id} className={targetType === target.id ? "selected" : ""} aria-pressed={targetType === target.id} onClick={() => setTargetType(targetType === target.id ? "" : target.id)}>{target.label}</button>)}</div></section>
      <section className="skill-form-step"><header><i>3</i><span><strong>使用前和现在有多强？</strong><small>系统不会预填</small></span></header><div className="skill-intensity-grid"><IntensityField label={`使用前的${intensityName}强度`} value={before} onChange={setBefore} /><IntensityField label={`现在的${intensityName}强度`} value={after} onChange={setAfter} /></div></section>
      <section className="skill-form-step"><header><i>4</i><span><strong>它带来了什么变化？</strong><small>至少选一项，最多 4 项</small></span></header><div className="compact-choice-grid outcome-grid">{SKILL_OUTCOMES.map((outcome) => <button type="button" key={outcome.id} className={outcomes.includes(outcome.id) ? "selected" : ""} aria-pressed={outcomes.includes(outcome.id)} onClick={() => toggleOutcome(outcome.id)}>{outcome.label}</button>)}</div></section>
      <details className="skill-log-more"><summary>补充一点背景（可选）<ChevronRight /></summary><label><span>只写对自己之后回看有帮助的一句话</span><textarea value={note} onChange={(event) => setNote(event.target.value.slice(0, 300))} placeholder="例如：争执后先离开房间，再做了节律呼吸……" /><small>{note.length} / 300 · 保存前会经过安全识别</small></label></details>
      {notice && <p className="save-notice" role="status">{notice}</p>}<div className="skill-log-boundary"><Info />前后变化可能受到时间、环境和其他行动影响，因此这里只做个人观察，不作疗效判断。</div><button className="nssi-primary" type="submit" disabled={busy || !canSave}>{busy ? "正在保存…" : canSave ? "保存这次练习" : "完成必填项后保存"}<Check /></button>
    </form>
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
  return <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="privacy-title"><section className="nssi-sheet privacy-sheet"><button type="button" className="sheet-close" onClick={onClose} aria-label="关闭"><X /></button><span className="eyebrow">知情同意 · 数据权利</span><h2 id="privacy-title">你的数据与退出选择</h2><p>你可以导出自己的结构化记录。申请删除后，课程、EMA、安全计划、技能和对话等普通数据会被清除；风险事件与审计事件只保留不可逆去标识化记录，不能再与你的访问令牌关联。</p><div className="privacy-actions"><button type="button" onClick={downloadArchive} disabled={busy}><Download />导出完整个人数据</button><label><span>删除是不可恢复的。继续请输入“确认删除”</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" placeholder="确认删除" /></label><button className="danger-action" type="button" onClick={eraseData} disabled={busy || confirmation !== "确认删除"}><Trash2 />删除普通数据并退出</button></div>{notice && <p className="save-notice" role="status">{notice}</p>}<small>生产上线前，数据保留期限与法律依据仍需由甲方和合规方最终确认。</small></section></div>;
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
      {view === "today" && <TodayView snapshot={snapshot} modules={catalog.modules} onView={setView} onModule={(id) => { setSelectedModule(id); setView("modules"); }} onEma={() => setEmaOpen(true)} onNotification={async (id) => { await fetch("/api/nssi/state", { method: "POST", headers: participantHeaders(token), body: JSON.stringify({ action: "notification.read", notificationId: id }) }); await refreshSnapshot(); }} />}
      {view === "modules" && <ModulesView snapshot={snapshot} modules={catalog.modules} selectedId={selectedModule} onSelect={setSelectedModule} token={token} onRefresh={() => refreshSnapshot()} onSafety={() => setView("safety")} />}
      {view === "chat" && <ChatView snapshot={snapshot} token={token} onRisk={() => { setEmi({ trigger: true, intervention: "crisis", reasonCodes: ["CHAT_RISK"] }); void refreshSnapshot(); }} />}
      {view === "safety" && <SafetyView snapshot={snapshot} token={token} onRefresh={() => refreshSnapshot()} />}
      {view === "records" && <RecordsView snapshot={snapshot} token={token} onRefresh={() => refreshSnapshot()} onRisk={() => setEmi({ trigger: true, intervention: "crisis", reasonCodes: ["SKILL_NOTE_RISK"] })} />}
    </div>
    <nav className="nssi-bottom-nav" aria-label="主要页面">{([["today", "今天", Home], ["modules", "课程", BookOpen], ["chat", "对话", MessageCircle], ["safety", "安全计划", ShieldCheck], ["records", "记录", BarChart3]] as const).map(([id, label, Icon]) => <button key={id} type="button" className={view === id ? "selected" : ""} onClick={() => { setView(id); if (id !== "modules") setSelectedModule(null); }}><Icon /><span>{label}</span></button>)}</nav>
    {emaOpen && <EmaSheet token={token} initial={snapshot.todayEma} allowBackfill={!snapshot.recentEma.some((item) => item.localDate === yesterdayLocalDate())} onClose={() => setEmaOpen(false)} onSaved={async (result) => { setEmaOpen(false); await refreshSnapshot(); if (result.trigger) setEmi(result); }} />}
    {privacyOpen && <PrivacySheet token={token} onClose={() => setPrivacyOpen(false)} onDeleted={() => { setPrivacyOpen(false); setToken(""); setSnapshot(null); }} />}
    {emi && <EmiOverlay result={emi} onSafety={() => { setEmi(null); setView("safety"); }} onClose={() => setEmi(null)} onMarkSafe={async () => { const riskEventId = snapshot.activeRiskEvent?.id; if (riskEventId) { await fetch("/api/nssi/state", { method: "POST", headers: participantHeaders(token), body: JSON.stringify({ action: "risk.mark-safe", riskEventId }) }); await refreshSnapshot(); } setEmi(null); }} />}
  </main>;
}
