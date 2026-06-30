import { z } from "zod";

export const EvidenceRecordSchema = z.object({
  id: z.string().min(1),
  specimenId: z.string().min(1),
  sourceType: z.enum([
    "breath_capture",
    "signal_analysis",
    "growth_simulation",
    "memory_record",
    "anomaly_detection",
    "human_decision"
  ]),
  sourceEventId: z.string().optional(),
  timestamp: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
  schemaVersion: z.number().int().positive()
});

export const EvidenceStorageEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  evidence: z.array(EvidenceRecordSchema)
});

export type EvidenceRecordDTO = z.infer<typeof EvidenceRecordSchema>;
