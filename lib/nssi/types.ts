export type ReviewStatus = "draft-internal" | "professionally-reviewed";

export type ProtocolModuleStatus = "locked" | "available" | "in-progress" | "completed";

export type ProtocolModule = {
  id: string;
  ordinal: number;
  week: number;
  releaseDay: "monday" | "thursday";
  title: string;
  shortTitle: string;
  purpose: string;
  introduction: string;
  estimatedMinutes: number;
  prerequisiteIds: string[];
  skillCardIds: string[];
  sourceQueries: string[];
  exercise: {
    id: string;
    title: string;
    prompt: string;
    fields: Array<{
      id: string;
      label: string;
      kind: "text" | "textarea" | "scale" | "multi-select";
      required: boolean;
      options?: string[];
    }>;
  };
  reviewStatus: ReviewStatus;
  contentVersion: string;
  media?: { kind: "audio-video"; status: "placeholder" | "available"; url?: string; transcript?: string };
};

export type ModuleProgress = {
  moduleId: string;
  status: ProtocolModuleStatus;
  readingProgress: number;
  exerciseSubmittedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type ModuleExerciseSummary = {
  id: string;
  moduleId: string;
  moduleTitle: string;
  exerciseId: string;
  submittedAt: string;
  answers: Array<{ fieldId: string; label: string; value: string }>;
};

export type LearningFeedback = {
  moduleId: string;
  title: string;
  reflection: string;
  suggestedSkillIds: string[];
  nextSteps: Array<"practice" | "chat" | "ema">;
};

export type ProtocolState = {
  schemaVersion: "1.0";
  enrollmentAt: string;
  timezone: string;
  releaseDays?: [string, string];
  currentWeek: number;
  currentModuleId: string;
  completedModuleIds: string[];
  progress: Record<string, ModuleProgress>;
  updatedAt: string;
};

export type EmaRecord = {
  id: string;
  userId: string;
  localDate: string;
  submittedAt: string;
  urge: number;
  moods: string[];
  skills: string[];
  note?: string;
  isBackfill: boolean;
  completionDurationMs?: number;
  riskEvaluation: {
    threshold: number;
    thresholdTriggered: boolean;
    semanticTriggered: boolean;
    riskEventId?: string;
  };
};

export type SafetyPlanSections = {
  warningSigns: string[];
  internalCoping: string[];
  peopleAndPlaces: string[];
  supportContacts: Array<{ name: string; relationship?: string; phone: string }>;
  professionalResources: Array<{ name: string; phone: string; note?: string }>;
  environmentSafetyAcknowledgement: string;
};

export type SafetyPlanVersion = {
  id: string;
  userId: string;
  version: number;
  sections: SafetyPlanSections;
  createdAt: string;
  createdBy: "participant" | "coach";
  contentReviewVersion: string;
};

export type SkillLog = {
  id: string;
  userId: string;
  /** Primary option retained for compatibility with earlier exports. */
  skillId: string;
  /** One practice event can contain several skills or a support action. */
  skillIds: string[];
  usedAt: string;
  intensityBefore: number;
  intensityAfter: number;
  targetType?: string;
  /** Optional participant-authored context, stored encrypted and excluded from research exports. */
  targetCustom?: string;
  outcomes: string[];
  note?: string;
};

export type PracticeStats = {
  totalSessions: number;
  sessionsLast7Days: number;
  averageIntensityChange: number | null;
  improvedSessions: number;
  unchangedSessions: number;
  worsenedSessions: number;
};

export type ConversationRetention = "summary-only" | "7-days" | "30-days" | "keep";

export type ConversationReviewSource = {
  chunkId: string;
  book: string;
  section: string;
  pdfPage: number;
  printedPage?: number;
  paragraphAnchor?: string;
  evidence: string;
};

/**
 * A participant-facing recap, not a diagnostic note and not an AI memory dump.
 * User-authored text remains distinguishable from the assistant's response.
 */
export type ConversationReview = {
  id: string;
  conversationId: string;
  title: string;
  userFocus: string;
  assistantTakeaway: string;
  followUpQuestion?: string;
  skillId?: string;
  skillLabel?: string;
  nextAction: "practice" | "none";
  sources: ConversationReviewSource[];
  exchangeCount: number;
  rawRetention: ConversationRetention;
  rawExpiresAt?: string;
  rawAvailable: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConversationTranscriptTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type RiskLevel = "suspected" | "high" | "imminent";
export type RiskSource = "ema-threshold" | "help-button" | "deterministic-text" | "semantic-text";
export type RiskEventStatus = "open" | "acknowledged" | "participant-marked-safe" | "closed";

export type RiskEvent = {
  id: string;
  userId: string;
  level: RiskLevel;
  sources: RiskSource[];
  status: RiskEventStatus;
  createdAt: string;
  notificationDeadlineAt?: string;
  humanSlaDeadlineAt?: string;
  acknowledgedAt?: string;
  participantMarkedSafeAt?: string;
  closedAt?: string;
  closedBy?: string;
  deidentifiedAt?: string;
};

export type AuditEvent = {
  id: string;
  actorId: string | null;
  actorRole: "participant" | "coach" | "admin" | "system";
  eventType: string;
  targetType: string;
  targetId: string | null;
  occurredAt: string;
  metadata: Record<string, unknown>;
};

export type ProductNotification = {
  id: string;
  userId: string;
  kind: "module-release" | "ema-reminder" | "inactivity-recall" | "coach-message";
  title: string;
  body: string;
  templateVersion: string;
  createdAt: string;
  readAt?: string;
};

export type PushDeliveryStatus = {
  supported: boolean;
  configured: boolean;
  subscribed: boolean;
};

export type ParticipantSnapshot = {
  userId: string;
  protocol: ProtocolState;
  todayEma: EmaRecord | null;
  safetyPlan: SafetyPlanVersion | null;
  recentSkillLogs: SkillLog[];
  practiceStats?: PracticeStats;
  activeRiskEvent: RiskEvent | null;
  notifications?: ProductNotification[];
  recentModuleExercises?: ModuleExerciseSummary[];
  recentConversationReviews?: ConversationReview[];
  push?: PushDeliveryStatus;
};
