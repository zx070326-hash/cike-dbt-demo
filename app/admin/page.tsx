"use client";

import { FormEvent, useState } from "react";
import { Check, FileCheck2, LockKeyhole, RefreshCw, Settings2, ShieldCheck } from "lucide-react";

type ConfigVersion = { id: string; version: string; status: string; config: Record<string, unknown>; evaluationReport?: Record<string, unknown>; createdAt: string; activatedAt?: string };

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [versions, setVersions] = useState<ConfigVersion[]>([]);
  const [defaultConfig, setDefaultConfig] = useState<Record<string, unknown> | null>(null);
  const [version, setVersion] = useState("nssi-phase1-0.1.0");
  const [configText, setConfigText] = useState("");
  const [reportText, setReportText] = useState(JSON.stringify({ metrics: { explicitCrisisRecall: 0, overallSafetyRecall: 0, benignFalseUpgradeRate: 1, bannedLeakageCount: 1, citationCoverage: 0, fabricatedCitationCount: 1, outOfDomainHandlingRate: 0 } }, null, 2));
  const [error, setError] = useState("");

  async function staffFetch(path: string, init?: RequestInit) { const response = await fetch(path, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, cache: "no-store" }); const body = await response.json() as Record<string, unknown>; if (!response.ok) throw new Error(String(body.error ?? "访问失败")); return body; }
  async function load(event?: FormEvent) { event?.preventDefault(); setError(""); try { const body = await staffFetch("/api/nssi/admin/config"); const base = body.defaultConfig as Record<string, unknown>; setDefaultConfig(base); setConfigText((current) => current || JSON.stringify(base, null, 2)); setVersions(body.versions as ConfigVersion[]); } catch (cause) { setError(cause instanceof Error ? cause.message : "访问失败"); } }
  async function createDraft() { setError(""); try { await staffFetch("/api/nssi/admin/config", { method: "POST", body: JSON.stringify({ action: "create-draft", version, config: JSON.parse(configText), evaluationReport: JSON.parse(reportText), adminId: "admin-web" }) }); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "创建失败"); } }
  async function activate(id: string) { setError(""); try { await staffFetch("/api/nssi/admin/config", { method: "POST", body: JSON.stringify({ action: "activate", id, adminId: "admin-web" }) }); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "评测门禁未通过"); } }

  if (!defaultConfig) return <main className="staff-login"><form onSubmit={load}><span className="staff-mark"><Settings2 /></span><small>此刻 · 管理配置</small><h1>版本与质量门禁</h1><p>配置修改不会直接上线。每个版本必须绑定完整评测报告并通过预注册阈值。</p><label><span>管理员访问令牌</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" /></label>{error && <p className="form-error">{error}</p>}<button type="submit" disabled={!token}>进入配置中心</button></form></main>;

  return <main className="staff-app admin-app"><header><div><small>此刻 · NSSI 一期</small><h1>配置与发布门禁</h1></div><button type="button" onClick={() => load()}><RefreshCw />刷新</button></header>{error && <p className="staff-error">{error}</p>}<section className="admin-warning"><ShieldCheck /><span><strong>不会在这里存放风险词原文</strong>风险词库仅以临床外部配置版本引用；危机模板、阈值、课程和 Prompt 的任何变更都必须重新评测。</span></section><section className="config-editor"><div className="staff-section-head"><div><small>新建不可变草稿</small><h2>配置版本</h2></div></div><label><span>版本号</span><input value={version} onChange={(event) => setVersion(event.target.value)} /></label><label><span>配置 JSON</span><textarea value={configText} onChange={(event) => setConfigText(event.target.value)} /></label><label><span>冻结评测报告 JSON</span><textarea value={reportText} onChange={(event) => setReportText(event.target.value)} /></label><button type="button" onClick={createDraft}><FileCheck2 />创建草稿版本</button></section><section className="config-versions"><div className="staff-section-head"><div><small>激活前强制检查评测指标</small><h2>版本历史</h2></div></div>{versions.length ? versions.map((item) => <article key={item.id}><span className={`config-status ${item.status}`}>{item.status === "active" ? <Check /> : <LockKeyhole />}{item.status}</span><div><strong>{item.version}</strong><small>创建于 {new Date(item.createdAt).toLocaleString("zh-CN")}</small></div>{item.status === "draft" && <button type="button" onClick={() => activate(item.id)}>通过门禁后激活</button>}</article>) : <p className="staff-empty">还没有配置版本。</p>}</section></main>;
}
