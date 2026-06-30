import { z } from "zod";

export const InterventionActionSchema = z.enum([
  "adjust_light",
  "adjust_humidity",
  "pause_growth",
  "merge_records",
  "delete_specimen",
  "export_data"
]);

export const RiskLevelSchema = z.enum(["low", "medium", "high"]);
export const InterventionStatusSchema = z.enum(["pending", "approved", "rejected", "expired"]);

export const AdjustLightParamsSchema = z.object({
  intensityPercentage: z.number().min(0).max(100)
});

export const AdjustHumidityParamsSchema = z.object({
  targetPercentage: z.number().min(0).max(100)
});

export const PauseGrowthParamsSchema = z.object({
  durationSeconds: z.number().nonnegative()
});

export const MergeRecordsParamsSchema = z.object({
  targetSpecimenId: z.string().min(1)
});

export const DeleteSpecimenParamsSchema = z.object({
  reason: z.string().min(1)
});

export const ExportDataParamsSchema = z.object({
  recipientEmail: z.string().email().optional()
});

export const InterventionParamsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("adjust_light"), payload: AdjustLightParamsSchema }),
  z.object({ action: z.literal("adjust_humidity"), payload: AdjustHumidityParamsSchema }),
  z.object({ action: z.literal("pause_growth"), payload: PauseGrowthParamsSchema }),
  z.object({ action: z.literal("merge_records"), payload: MergeRecordsParamsSchema }),
  z.object({ action: z.literal("delete_specimen"), payload: DeleteSpecimenParamsSchema }),
  z.object({ action: z.literal("export_data"), payload: ExportDataParamsSchema })
]);

export const InterventionDecisionSchema = z.object({
  decidedAt: z.string().datetime(),
  decidedBy: z.string().min(1),
  rationale: z.string().optional()
});

export const InterventionProposalSchema = z.object({
  id: z.string().min(1),
  specimenId: z.string().min(1),
  action: InterventionActionSchema,
  params: InterventionParamsSchema,
  evidenceIds: z.array(z.string()).default([]),
  reason: z.string().min(1),
  heuristicConfidence: z.number().min(0).max(1),
  proposedBy: z.enum(["system", "archivist", "tool", "user"]).optional(),
  riskLevel: RiskLevelSchema,
  status: InterventionStatusSchema,
  createdAt: z.string().datetime(),
  decision: InterventionDecisionSchema.optional()
});

export type InterventionProposalDTO = z.infer<typeof InterventionProposalSchema>;
