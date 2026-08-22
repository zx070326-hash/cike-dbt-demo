import { modulesById, nssiPhase1Modules } from "./curriculum";
import type { ModuleProgress, ProtocolModuleStatus, ProtocolState } from "./types";

export type ProtocolCommand =
  | { type: "record-reading"; moduleId: string; progress: number; at?: string }
  | { type: "submit-exercise"; moduleId: string; at?: string }
  | { type: "recalculate"; at?: string };

export class ProtocolInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolInvariantError";
  }
}

function isoNow(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new ProtocolInvariantError("Invalid protocol timestamp");
  return date.toISOString();
}

function mondayOfWeekInShanghai(date: Date) {
  // Phase 1 is fixed to Asia/Shanghai. Shift into local wall-clock time,
  // calculate Monday there, then shift the release instant back to UTC.
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const day = local.getUTCDay() || 7;
  const releaseUtcMs = Date.UTC(
    local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - day + 1,
    1, 0, 0, 0,
  );
  return new Date(releaseUtcMs);
}

const releaseDayOffsets: Record<string, number> = {
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6,
};

export function scheduledReleaseAt(enrollmentAt: string, moduleId: string, releaseDays: readonly string[] = ["monday", "thursday"]) {
  const curriculumModule = modulesById.get(moduleId);
  if (!curriculumModule) throw new ProtocolInvariantError(`Unknown module: ${moduleId}`);
  const start = mondayOfWeekInShanghai(new Date(enrollmentAt));
  const configuredDay = releaseDays[curriculumModule.ordinal % 2 === 1 ? 0 : 1] ?? curriculumModule.releaseDay;
  const dayOffset = releaseDayOffsets[configuredDay];
  if (!Number.isInteger(dayOffset)) throw new ProtocolInvariantError(`Invalid release day: ${configuredDay}`);
  start.setUTCDate(start.getUTCDate() + (curriculumModule.week - 1) * 7 + dayOffset);
  return start.toISOString();
}

function deriveStatus(
  state: ProtocolState,
  moduleId: string,
  at: string,
): ProtocolModuleStatus {
  const curriculumModule = modulesById.get(moduleId);
  if (!curriculumModule) throw new ProtocolInvariantError(`Unknown module: ${moduleId}`);
  const progress = state.progress[moduleId];
  if (progress?.completedAt) return "completed";
  const prereqsComplete = curriculumModule.prerequisiteIds.every((id) => Boolean(state.progress[id]?.completedAt));
  const released = Date.parse(at) >= Date.parse(scheduledReleaseAt(state.enrollmentAt, moduleId, state.releaseDays));
  if (!prereqsComplete || !released) return "locked";
  if ((progress?.readingProgress ?? 0) > 0 || progress?.exerciseSubmittedAt) return "in-progress";
  return "available";
}

export function createProtocolState(
  enrollmentAt = new Date().toISOString(),
  timezone = "Asia/Shanghai",
  releaseDays: [string, string] = ["monday", "thursday"],
): ProtocolState {
  const at = isoNow(enrollmentAt);
  const progress = Object.fromEntries(nssiPhase1Modules.map((curriculumModule) => [
    curriculumModule.id,
    {
      moduleId: curriculumModule.id,
      status: "locked" as ProtocolModuleStatus,
      readingProgress: 0,
      exerciseSubmittedAt: null,
      startedAt: null,
      completedAt: null,
    } satisfies ModuleProgress,
  ]));
  return recalculateProtocol({
    schemaVersion: "1.0",
    enrollmentAt: at,
    timezone,
    releaseDays,
    currentWeek: 1,
    currentModuleId: nssiPhase1Modules[0].id,
    completedModuleIds: [],
    progress,
    updatedAt: at,
  }, at);
}

export function recalculateProtocol(input: ProtocolState, at = new Date().toISOString()): ProtocolState {
  const now = isoNow(at);
  const state: ProtocolState = structuredClone(input);
  for (const curriculumModule of nssiPhase1Modules) {
    const progress = state.progress[curriculumModule.id];
    if (!progress) throw new ProtocolInvariantError(`Missing progress: ${curriculumModule.id}`);
    if (progress.readingProgress >= 0.9 && progress.exerciseSubmittedAt && !progress.completedAt) {
      progress.completedAt = progress.exerciseSubmittedAt;
    }
    progress.status = deriveStatus(state, curriculumModule.id, now);
  }
  state.completedModuleIds = nssiPhase1Modules
    .filter((curriculumModule) => Boolean(state.progress[curriculumModule.id].completedAt))
    .map((curriculumModule) => curriculumModule.id);
  const current = nssiPhase1Modules.find((curriculumModule) => state.progress[curriculumModule.id].status !== "completed")
    ?? nssiPhase1Modules[nssiPhase1Modules.length - 1];
  state.currentModuleId = current.id;
  state.currentWeek = current.week;
  state.updatedAt = now;
  return state;
}

/**
 * The sole write path for protocol progress. The Agent receives only the
 * returned snapshot and can never submit a ProtocolCommand.
 */
export function applyProtocolCommand(state: ProtocolState, command: ProtocolCommand): ProtocolState {
  const at = isoNow(command.at);
  const next = recalculateProtocol(state, at);
  if (command.type === "recalculate") return next;
  const curriculumModule = modulesById.get(command.moduleId);
  const progress = next.progress[command.moduleId];
  if (!curriculumModule || !progress) throw new ProtocolInvariantError(`Unknown module: ${command.moduleId}`);
  if (progress.status === "locked") throw new ProtocolInvariantError("Locked modules cannot be changed");

  if (command.type === "record-reading") {
    if (!Number.isFinite(command.progress)) throw new ProtocolInvariantError("Reading progress must be numeric");
    progress.readingProgress = Math.max(progress.readingProgress, Math.min(1, Math.max(0, command.progress)));
    progress.startedAt ??= at;
  }
  if (command.type === "submit-exercise") {
    progress.exerciseSubmittedAt = at;
    progress.startedAt ??= at;
  }
  return recalculateProtocol(next, at);
}

export function protocolSummaryForAgent(state: ProtocolState) {
  const current = modulesById.get(state.currentModuleId);
  return Object.freeze({
    currentWeek: state.currentWeek,
    currentModuleId: state.currentModuleId,
    currentModuleTitle: current?.title ?? "",
    unlockedModuleIds: nssiPhase1Modules
      .filter((curriculumModule) => state.progress[curriculumModule.id].status !== "locked")
      .map((curriculumModule) => curriculumModule.id),
    completedModuleIds: [...state.completedModuleIds],
  });
}
