"use client";

import { FormEvent, useState } from "react";
import { Activity, Check, CircleAlert, Clock3, Download, Eye, RefreshCw, ShieldCheck, UsersRound } from "lucide-react";

type Risk = { id: string; userId: string; level: string; sources: string[]; status: string; createdAt: string; acknowledgedAt?: string };
type Participant = { userId: string; pseudonym: string; currentWeek: number; currentModuleId: string; completedModules: number; lastEmaAt: string | null; lastUrge: number | null; openRiskCount: number; lastActivityAt: string };
type Audit = { id?: string; userId: string; pseudonym: string; conversationId: string; role?: string; mode: string; content?: Record<string, unknown>; userMessage?: string; assistantPayload?: Record<string, unknown>; validator: Record<string, unknown>; createdAt: string };
type SafetyPlanHistory = { id: string; version: number; createdAt: string; createdBy: string; sections: { warningSigns: string[]; internalCoping: string[]; peopleAndPlaces: string[]; supportContacts: Array<{ name: string; phone: string }>; professionalResources: Array<{ name: string; phone: string }>; environmentSafetyAcknowledgement: string } };

export default function CoachPage() {
  const [token, setToken] = useState("");
  const [risks, setRisks] = useState<Risk[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [safetyPlans, setSafetyPlans] = useState<SafetyPlanHistory[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function staffFetch(path: string, init?: RequestInit) {
    const response = await fetch(path, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init?.headers ?? {}) }, cache: "no-store" });
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(String(body.error ?? "访问失败"));
    return body;
  }

  async function load(event?: FormEvent) {
    event?.preventDefault(); setBusy(true); setError("");
    try {
      const [riskBody, dashboardBody] = await Promise.all([staffFetch("/api/nssi/coach/risks"), staffFetch("/api/nssi/coach/dashboard")]);
      setRisks(riskBody.risks as Risk[]); setParticipants(dashboardBody.participants as Participant[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "访问失败"); }
    finally { setBusy(false); }
  }

  async function loadAudit(userId: string) {
    setSelectedUser(userId); setError("");
    try { const [body, safetyBody] = await Promise.all([staffFetch(`/api/nssi/coach/audit?userId=${encodeURIComponent(userId)}`), staffFetch(`/api/nssi/coach/safety-plans?userId=${encodeURIComponent(userId)}`)]); setAudits(body.messages as Audit[]); setSafetyPlans(safetyBody.plans as SafetyPlanHistory[]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "读取审计失败"); }
  }

  async function act(riskEventId: string, action: "acknowledge" | "close") {
    try { await staffFetch("/api/nssi/coach/risks", { method: "PATCH", body: JSON.stringify({ riskEventId, action, coachId: "coach-web" }) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败"); }
  }

  async function exportResearch(userId: string) {
    setError("");
    try {
      const response = await fetch(`/api/nssi/coach/export?userId=${encodeURIComponent(userId)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error("研究导出失败");
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/u)?.[1] ?? "nssi-research-export.csv";
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "研究导出失败"); }
  }

  if (!participants.length && !risks.length) return <main className="staff-login"><form onSubmit={load}><span className="staff-mark"><ShieldCheck /></span><small>此刻 · 教练工作台</small><h1>风险与依从性后台</h1><p>仅面向被授权的远程协助人员。所有查看和处理动作都会进入审计记录。</p><label><span>教练访问令牌</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" /></label>{error && <p className="form-error">{error}</p>}<button type="submit" disabled={!token || busy}>{busy ? "正在验证…" : "进入工作台"}</button></form></main>;

  return <main className="staff-app"><header><div><small>此刻 · NSSI 一期</small><h1>教练工作台</h1></div><button type="button" onClick={() => load()}><RefreshCw />刷新</button></header>{error && <p className="staff-error">{error}</p>}<section className="staff-metrics"><article><CircleAlert /><span><strong>{risks.filter((risk) => risk.status !== "closed").length}</strong>开放风险事件</span></article><article><UsersRound /><span><strong>{participants.length}</strong>参与者</span></article><article><Activity /><span><strong>{participants.filter((item) => item.lastEmaAt).length}</strong>已有 EMA 记录</span></article></section><section className="risk-queue"><div className="staff-section-head"><div><small>按风险等级与时间排序</small><h2>风险事件队列</h2></div><span>通知目标 ≤ 60 秒；人工响应 SLA 待甲方确认</span></div>{risks.length ? <div className="risk-list">{risks.map((risk) => <article key={risk.id} className={`risk-${risk.level}`}><div><span>{risk.level === "imminent" ? "迫近" : risk.level === "high" ? "高" : "待确认"}</span><small>{new Date(risk.createdAt).toLocaleString("zh-CN")}</small></div><h3>{risk.userId === "deidentified" ? "已去标识事件" : `参与者-${risk.userId.slice(0, 6)}`}</h3><p>来源：{risk.sources.join("、")} · 状态：{risk.status}</p><div>{risk.status === "open" && <button type="button" onClick={() => act(risk.id, "acknowledge")}><Eye />确认已看到</button>}{risk.status !== "closed" && <button type="button" onClick={() => act(risk.id, "close")}><Check />完成跟进并关闭</button>}</div></article>)}</div> : <p className="staff-empty">当前没有风险事件。</p>}</section><section className="participant-panel"><div className="staff-section-head"><div><small>依从性与近期状态</small><h2>参与者总览</h2></div></div><div className="participant-table"><div className="table-row table-head"><span>参与者</span><span>进度</span><span>最近 EMA</span><span>开放风险</span><span>审计</span></div>{participants.map((item) => <div className="table-row" key={item.userId}><strong>{item.pseudonym}</strong><span>第 {item.currentWeek} 周 · {item.completedModules}/16</span><span>{item.lastEmaAt ? `${item.lastUrge}/10 · ${new Date(item.lastEmaAt).toLocaleDateString("zh-CN")}` : "暂无"}</span><span>{item.openRiskCount}</span><button type="button" onClick={() => loadAudit(item.userId)}><Eye />查看</button></div>)}</div></section>{selectedUser && <section className="audit-panel"><div className="staff-section-head"><div><small>对话、来源、验证器与安全计划版本</small><h2>参与者-{selectedUser.slice(0, 6)} 审计</h2></div><div><button type="button" onClick={() => exportResearch(selectedUser)}><Download />匿名研究 CSV</button><button type="button" onClick={() => { setSelectedUser(null); setAudits([]); setSafetyPlans([]); }}>关闭</button></div></div><details className="coach-safety-history" open><summary>安全计划历史（{safetyPlans.length}）</summary>{safetyPlans.length ? safetyPlans.map((plan) => <article key={plan.id}><header><strong>第 {plan.version} 版</strong><small>{new Date(plan.createdAt).toLocaleString("zh-CN")} · {plan.createdBy}</small></header><pre>{JSON.stringify(plan.sections, null, 2)}</pre></article>) : <p className="staff-empty">尚未保存安全计划。</p>}</details>{audits.length ? audits.map((item, index) => <article key={item.id ?? `${item.conversationId}-${index}`}><header><span>{item.role ?? "会话轮次"} · {item.mode}</span><small><Clock3 />{new Date(item.createdAt).toLocaleString("zh-CN")}</small></header><pre>{JSON.stringify(item.content ?? { userMessage: item.userMessage, assistantPayload: item.assistantPayload }, null, 2)}</pre><details><summary>验证与引用状态</summary><pre>{JSON.stringify(item.validator, null, 2)}</pre></details></article>) : <p className="staff-empty">没有可显示的对话审计。</p>}</section>}</main>;
}
