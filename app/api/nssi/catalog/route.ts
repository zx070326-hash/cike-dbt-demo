import { NextResponse } from "next/server";
import { getActivePhase1Config, modulesWithConfig, pushDeliveryConfig, storageReadiness } from "../../../../lib/nssi/store";
import { DBT_SKILL_CATEGORIES, DBT_SKILLS, SKILL_OUTCOMES, SKILL_TARGETS, SUPPORT_ACTIONS } from "../../../../lib/nssi/skills";
import knowledgeManifest from "../../../../data/knowledge/manifest-v2.json";

export async function GET() {
  const activeConfig = await getActivePhase1Config();
  const modules = modulesWithConfig(activeConfig.config);
  const runtime = storageReadiness();
  const releaseChecks = {
    persistentEncryptedStorage: runtime.productionReady,
    allModulesProfessionallyReviewed: modules.every((module) => module.reviewStatus === "professionally-reviewed"),
    skillCardsProfessionallyReviewed: activeConfig.config.content.reviewedSkillCardIds.length >= 18,
    sourceAuthorized: activeConfig.config.content.authorization === "authorized-for-production",
    externalRiskNotificationConfigured: runtime.riskWebhookConfigured,
    browserPushConfigured: runtime.pushConfigured,
    humanResponseSlaConfirmed: activeConfig.config.crisis.humanResponseSla !== "pending-client-confirmation",
    ethicsResolved: activeConfig.config.governance.ethicsReviewStatus !== "pending",
    medicalBoundaryReviewed: activeConfig.config.governance.medicalBoundaryStatus === "reviewed",
    retentionAndLegalBasisConfirmed: activeConfig.config.governance.dataRetentionDays !== null && activeConfig.config.governance.privacyLegalBasis !== "pending-client-confirmation",
  };
  return NextResponse.json({
    product: {
      id: "cike-nssi-phase1",
      protocolVersion: "nssi-phase1-0.1",
      population: "adults-18-plus",
      medicalPositioning: "self-help-with-remote-human-support-not-diagnosis-or-treatment",
    },
    modules,
    skillCatalog: {
      version: "dbt-skill-catalog-1.0",
      categories: DBT_SKILL_CATEGORIES,
      skills: DBT_SKILLS,
      supportActions: SUPPORT_ACTIONS,
      targets: SKILL_TARGETS,
      outcomes: SKILL_OUTCOMES,
    },
    knowledge: {
      schemaVersion: knowledgeManifest.schemaVersion,
      indexedPages: knowledgeManifest.coverage.indexedPageCount,
      chunks: knowledgeManifest.coverage.chunkCount,
      characterCoverage: knowledgeManifest.coverage.characterCoverage,
      professionallyReviewedSkillCards: knowledgeManifest.wiki.professionallyReviewedCount,
      sourceAuthorization: "internal-development-only-pending-production-authorization",
    },
    runtime: { ...runtime, phase1ReleaseReady: Object.values(releaseChecks).every(Boolean), releaseChecks },
    delivery: pushDeliveryConfig(),
    activeConfig: {
      id: activeConfig.id,
      version: activeConfig.version,
      ema: activeConfig.config.ema,
      release: activeConfig.config.release,
      content: activeConfig.config.content,
      humanResponseSla: activeConfig.config.crisis.humanResponseSla,
    },
  }, { headers: { "cache-control": "no-store" } });
}
