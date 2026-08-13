import type { SourceCitation } from "./dbt-content";

export type ClaimKind = "definition" | "applicability" | "practice" | "boundary";

export type GroundedClaim = {
  text: string;
  citationIds: string[];
  kind: ClaimKind;
};

export type ClaimValidation = {
  valid: boolean;
  claims: GroundedClaim[];
  citationIds: string[];
  errors: string[];
};

const internalLanguage = /\bE\d+\b|证据编号|检索结果|召回|向量库|chunk|提示词/iu;

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

/**
 * Keeps professional claims and their citations together. Emotional
 * acknowledgement is intentionally not represented here because it is grounded
 * in the user's own words rather than in the book.
 */
export function validateGroundedClaims(
  value: unknown,
  allowedCitationIds: ReadonlySet<string>,
  options: { maxClaims?: number; maxTextLength?: number } = {},
): ClaimValidation {
  const maxClaims = options.maxClaims ?? 6;
  const maxTextLength = options.maxTextLength ?? 220;
  const errors: string[] = [];
  if (!Array.isArray(value)) {
    return { valid: false, claims: [], citationIds: [], errors: ["claims_not_array"] };
  }

  const claims: GroundedClaim[] = [];
  for (const [index, raw] of value.slice(0, maxClaims).entries()) {
    if (!raw || typeof raw !== "object") {
      errors.push(`claim_${index}_not_object`);
      continue;
    }
    const record = raw as Record<string, unknown>;
    const text = cleanText(record.text, maxTextLength);
    const kind: ClaimKind = ["definition", "applicability", "practice", "boundary"].includes(
      String(record.kind),
    )
      ? record.kind as ClaimKind
      : "definition";
    const citationIds = Array.isArray(record.citationIds)
      ? [...new Set(record.citationIds
        .filter((id): id is string => typeof id === "string" && allowedCitationIds.has(id)))]
      : [];

    if (!text) errors.push(`claim_${index}_empty`);
    if (internalLanguage.test(text)) errors.push(`claim_${index}_leaks_internal_language`);
    if (!citationIds.length) errors.push(`claim_${index}_missing_citation`);
    if (text && citationIds.length && !internalLanguage.test(text)) {
      claims.push({ text, kind, citationIds });
    }
  }

  if (!claims.length) errors.push("no_valid_claims");
  return {
    valid: errors.length === 0,
    claims,
    citationIds: [...new Set(claims.flatMap((claim) => claim.citationIds))],
    errors,
  };
}

export function resolveClaimCitations(
  claims: GroundedClaim[],
  citationsById: ReadonlyMap<string, SourceCitation>,
) {
  const ids = [...new Set(claims.flatMap((claim) => claim.citationIds))];
  return ids
    .map((id) => citationsById.get(id))
    .filter((citation): citation is SourceCitation => Boolean(citation));
}

export function claimsToReadableText(claims: GroundedClaim[]) {
  return claims.map((claim) => claim.text).join(" ");
}
