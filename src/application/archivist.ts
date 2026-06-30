import { z } from "zod";
import { ArchivalObservation, EvidenceRecord, InvariantError, VerificationStatus } from "../domain";
import { EvidenceIdSchema } from "../shared/schemas";

export const ARCHIVIST_PROMPT_VERSION = "archivist.v1";
export const LOCAL_ARCHIVIST_MODEL = "local-fallback";

export const ArchivistResponseSchema = z.object({
  text: z.string().min(1),
  evidenceIds: z.array(EvidenceIdSchema).default([]),
  verificationStatus: z.enum(["grounded", "fallback", "unverified"]),
  generatedBy: z.enum(["gemini", "local_fallback"]),
  promptVersion: z.string(),
  model: z.string(),
  fallbackReason: z.string().optional()
}).superRefine((response, ctx) => {
  const uniqueEvidenceIds = new Set(response.evidenceIds);
  if (uniqueEvidenceIds.size !== response.evidenceIds.length) {
    ctx.addIssue({
      code: "custom",
      path: ["evidenceIds"],
      message: "Evidence references must not contain duplicates."
    });
  }
  if (response.generatedBy === "gemini" && response.verificationStatus === "grounded" && response.evidenceIds.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["evidenceIds"],
      message: "Grounded model observations require evidence references."
    });
  }
  if (response.generatedBy === "local_fallback" && response.verificationStatus !== "fallback") {
    ctx.addIssue({
      code: "custom",
      path: ["verificationStatus"],
      message: "Local fallback observations must be marked fallback."
    });
  }
});

export type ArchivistResponse = z.infer<typeof ArchivistResponseSchema>;

export function localArchivistFallback(params: {
  specimenName: string;
  stageLabel: string;
  evidenceIds?: string[];
  reason: string;
}): ArchivistResponse {
  return {
    text: `The ${params.specimenName} specimen remains stable under glass; ${params.stageLabel.toLowerCase()} structures are recorded without further inference.`,
    evidenceIds: params.evidenceIds ?? [],
    verificationStatus: "fallback",
    generatedBy: "local_fallback",
    promptVersion: ARCHIVIST_PROMPT_VERSION,
    model: LOCAL_ARCHIVIST_MODEL,
    fallbackReason: params.reason
  };
}

export function toObservation(params: {
  response: ArchivistResponse;
  observationNumber: number;
  timestamp: number;
  evidence: EvidenceRecord[];
}): ArchivalObservation {
  const persistedIds = new Set(params.evidence.map((item) => item.id));
  const duplicateIds = params.response.evidenceIds.filter((id, index) => params.response.evidenceIds.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    throw new InvariantError(`Duplicate evidence references: ${[...new Set(duplicateIds)].join(", ")}`);
  }
  const missingIds = params.response.evidenceIds.filter((id) => !persistedIds.has(id));
  if (missingIds.length > 0) {
    throw new InvariantError(`Missing evidence references: ${missingIds.join(", ")}`);
  }
  if (params.response.generatedBy === "gemini" && params.response.verificationStatus === "grounded" && params.response.evidenceIds.length === 0) {
    throw new InvariantError("Grounded model observations require persisted evidence.");
  }
  const evidenceIds = params.response.evidenceIds;
  const status: VerificationStatus =
    params.response.generatedBy === "gemini" && params.response.verificationStatus === "grounded"
      ? "grounded"
      : params.response.generatedBy === "local_fallback"
        ? "fallback"
        : "unverified";

  return {
    id: `obs_${params.timestamp}_${params.observationNumber}`,
    timestamp: params.timestamp,
    observationNumber: params.observationNumber,
    text: params.response.text,
    evidenceIds,
    confidence: null,
    generatedBy: params.response.generatedBy,
    verificationStatus: status,
    promptVersion: params.response.promptVersion,
    model: params.response.model
  };
}
