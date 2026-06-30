import { z } from "zod";
import { ArchivalObservation, EvidenceRecord, VerificationStatus } from "../domain";

export const ARCHIVIST_PROMPT_VERSION = "archivist.v1";
export const LOCAL_ARCHIVIST_MODEL = "local-fallback";

export const ArchivistResponseSchema = z.object({
  text: z.string().min(1),
  evidenceIds: z.array(z.string()).default([]),
  verificationStatus: z.enum(["grounded", "fallback", "unverified"]),
  generatedBy: z.enum(["gemini", "local_fallback"]),
  promptVersion: z.string(),
  model: z.string(),
  fallbackReason: z.string().optional()
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
  const evidenceIds = params.response.evidenceIds.filter((id) => persistedIds.has(id));
  const status: VerificationStatus =
    params.response.generatedBy === "gemini" && evidenceIds.length > 0
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
