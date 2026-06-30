import { z } from "zod";

export const WorkflowStatusSchema = z.enum(["running", "completed", "failed"]);

export const WorkflowSessionSchema = z.object({
  id: z.string().min(1, "ID cannot be empty"),
  specimenId: z.string().min(1, "specimenId cannot be empty"),
  status: WorkflowStatusSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  stepsCompleted: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([]),
  traceIds: z.array(z.string()).default([])
});

export const TraceActorSchema = z.enum(["curator", "archivist", "tool", "policy", "system"]);
export const TraceStatusSchema = z.enum(["started", "succeeded", "failed", "fallback"]);

export const TraceEventSchema = z.object({
  id: z.string().min(1),
  workflowId: z.string().min(1),
  specimenId: z.string().min(1),
  timestamp: z.string().datetime(),
  actor: TraceActorSchema,
  operation: z.string().min(1),
  status: TraceStatusSchema,
  inputEvidenceIds: z.array(z.string()).default([]),
  outputEvidenceIds: z.array(z.string()).default([]),
  durationMs: z.number().int().nonnegative().optional(),
  summary: z.string().min(1),
  errorCode: z.string().optional(),
  errorCategory: z.enum(["validation", "model", "storage", "policy", "unknown"]).optional(),
  fallbackReason: z.string().optional(),
  promptVersion: z.string().optional(),
  model: z.string().optional()
});

export type WorkflowSessionDTO = z.infer<typeof WorkflowSessionSchema>;
export type TraceEventDTO = z.infer<typeof TraceEventSchema>;
