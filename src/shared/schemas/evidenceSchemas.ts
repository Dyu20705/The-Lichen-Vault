import { z } from "zod";

export const EvidenceIdSchema = z.string().regex(/^ev_[A-Za-z0-9_-]+$/, "Evidence IDs must use the ev_ prefix convention");

export const EvidenceRecordSchema = z.object({
  id: EvidenceIdSchema,
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
  schemaVersion: z.literal(1)
});

export const EvidenceStorageEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  evidence: z.array(EvidenceRecordSchema)
}).superRefine((envelope, ctx) => {
  const ids = new Set<string>();
  envelope.evidence.forEach((evidence, index) => {
    if (ids.has(evidence.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["evidence", index, "id"],
        message: `Duplicate evidence id ${evidence.id}`
      });
    }
    ids.add(evidence.id);
  });
});

export type EvidenceRecordDTO = z.infer<typeof EvidenceRecordSchema>;
