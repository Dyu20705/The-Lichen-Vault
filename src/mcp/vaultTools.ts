import { z } from "zod";
import { ArchivalObservation, DomainError, InterventionAction, InterventionParams, TraceEvent } from "../domain";
import { SpecimenRepository } from "../infrastructure/persistence/specimenRepository";
import { assertEvidenceReferences, createInterventionProposal, decideProposal } from "../application/policy";
import {
  EvidenceIdSchema,
  EvidenceRecordSchema,
  InterventionProposalSchema,
  SpecimenEventSchema,
  SpecimenSchema,
  TraceEventSchema
} from "../shared/schemas";

export type McpErrorCategory = "validation" | "not_found" | "policy" | "storage" | "unknown";

export interface McpToolError {
  category: McpErrorCategory;
  code: string;
  message: string;
}

export type McpToolResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: McpToolError };

export interface TrustedActionContext {
  userId: string;
  actionNonce: string;
  approvalToken: string;
}

export interface VaultToolOptions {
  validateTrustedAction?: (context: TrustedActionContext, action: "approve" | "reject" | "export") => boolean | Promise<boolean>;
  now?: () => Date;
}

const InterventionActionSchema = z.enum(["adjust_light", "adjust_humidity", "pause_growth", "merge_records", "delete_specimen", "export_data"]);

export const ListSpecimensInputSchema = z.object({});

export const GetSpecimenInputSchema = z.object({
  specimenId: z.string().min(1)
});

export const GetSpecimenEventsInputSchema = z.object({
  specimenId: z.string().min(1),
  limit: z.number().int().positive().optional(),
  before: z.string().datetime().optional(),
  types: z.array(SpecimenEventSchema.shape.type).optional()
});

export const GetEvidenceInputSchema = z.object({
  evidenceId: EvidenceIdSchema
});

export const GetWorkflowTracesInputSchema = z.object({
  specimenId: z.string().min(1),
  workflowId: z.string().min(1).optional()
});

export const AppendObservationSchema = z.object({
  specimenId: z.string().min(1),
  text: z.string().min(1).max(800),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
  verificationStatus: z.literal("fallback").default("fallback")
});

export const ProposeInterventionSchema = z.object({
  specimenId: z.string().min(1),
  action: InterventionActionSchema,
  reason: z.string().min(1),
  evidenceIds: z.array(EvidenceIdSchema).min(1)
});

export const TrustedDecisionSchema = z.object({
  proposalId: z.string().min(1),
  userId: z.string().min(1),
  approvalToken: z.string().min(12),
  actionNonce: z.string().min(1)
});

export const ExportSpecimenInputSchema = z.object({
  specimenId: z.string().min(1),
  userId: z.string().min(1),
  approvalToken: z.string().min(12),
  actionNonce: z.string().min(1)
});

const VaultSpecimenExportSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  specimen: SpecimenSchema,
  events: z.array(SpecimenEventSchema),
  evidence: z.array(EvidenceRecordSchema),
  traces: z.array(TraceEventSchema),
  proposals: z.array(InterventionProposalSchema)
});

export const VaultToolNames = [
  "list_specimens",
  "get_specimen",
  "get_specimen_events",
  "get_evidence",
  "get_workflow_traces",
  "append_observation",
  "propose_intervention",
  "approve_intervention",
  "reject_intervention",
  "export_specimen"
] as const;

function paramsForAction(action: InterventionAction): InterventionParams {
  switch (action) {
    case "adjust_light":
      return { action, payload: { intensityPercentage: 45 } };
    case "adjust_humidity":
      return { action, payload: { targetPercentage: 50 } };
    case "pause_growth":
      return { action, payload: { durationSeconds: 60 } };
    case "merge_records":
      return { action, payload: { targetSpecimenId: "requires-ui-selection" } };
    case "delete_specimen":
      return { action, payload: { reason: "MCP proposal only; no delete execution tool is exposed." } };
    case "export_data":
      return { action, payload: {} };
  }
}

function ok<T>(data: T): McpToolResult<T> {
  return { ok: true, data };
}

function fail(error: unknown): { ok: false; error: McpToolError } {
  return { ok: false, error: toToolError(error) };
}

function toToolError(error: unknown): McpToolError {
  if (error instanceof z.ZodError) {
    return {
      category: "validation",
      code: "VALIDATION_ERROR",
      message: "Tool input failed schema validation."
    };
  }
  if (error instanceof DomainError) {
    return {
      category: categoryFromCode(error.code),
      code: error.code,
      message: error.message
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    category: message.toLowerCase().includes("not found") ? "not_found" : "unknown",
    code: message.toLowerCase().includes("not found") ? "NOT_FOUND" : "TOOL_ERROR",
    message: sanitizeMessage(message)
  };
}

function categoryFromCode(code: string): McpErrorCategory {
  if (code === "VALIDATION_ERROR" || code === "INVARIANT_VIOLATION") return "validation";
  if (code === "NOT_FOUND") return "not_found";
  if (code === "POLICY_VIOLATION") return "policy";
  if (code.includes("STORAGE")) return "storage";
  return "unknown";
}

function sanitizeMessage(message: string): string {
  if (/api[_-]?key|secret|token|env/i.test(message)) return "Tool execution failed.";
  return message;
}

function stableId(prefix: string, now: Date): string {
  return `${prefix}_${now.getTime()}_${Math.floor(Math.random() * 100000)}`;
}

function mcpWorkflowId(now: Date): string {
  return `wf_mcp_${now.getTime()}_${Math.floor(Math.random() * 100000)}`;
}

async function appendToolTrace(params: {
  repo: SpecimenRepository;
  now: Date;
  specimenId: string;
  operation: string;
  status: TraceEvent["status"];
  inputEvidenceIds?: string[];
  outputEvidenceIds?: string[];
  summary: string;
  error?: McpToolError;
}): Promise<void> {
  const workflowId = mcpWorkflowId(params.now);
  const trace: TraceEvent = {
    id: `tr_${workflowId}_${params.operation.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    workflowId,
    specimenId: params.specimenId,
    timestamp: params.now.toISOString(),
    actor: "tool",
    operation: params.operation,
    status: params.status,
    inputEvidenceIds: params.inputEvidenceIds ?? [],
    outputEvidenceIds: params.outputEvidenceIds ?? [],
    durationMs: 0,
    summary: params.summary,
    errorCategory: params.error?.category === "not_found" ? "unknown" : params.error?.category,
    errorCode: params.error?.code
  };
  await params.repo.appendTrace(trace);
}

async function isTrusted(options: VaultToolOptions, context: TrustedActionContext, action: "approve" | "reject" | "export"): Promise<boolean> {
  return Boolean(options.validateTrustedAction && await options.validateTrustedAction(context, action));
}

function scrubForExport<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => scrubForExport(item)) as T;
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (/api[_-]?key|secret|token|rawaudio|audio(bytes)?|mediastream/i.test(key)) continue;
      next[key] = scrubForExport(child);
    }
    return next as T;
  }
  return value;
}

export function createVaultTools(repo: SpecimenRepository, options: VaultToolOptions = {}) {
  const now = () => options.now?.() ?? new Date();

  return {
    async list_specimens(input: unknown = {}): Promise<McpToolResult<unknown>> {
      try {
        ListSpecimensInputSchema.parse(input);
        return ok((await repo.listSpecimens()).map((item) => SpecimenSchema.parse(item)));
      } catch (error) {
        return fail(error);
      }
    },

    async get_specimen(input: unknown): Promise<McpToolResult<unknown>> {
      try {
        const parsed = GetSpecimenInputSchema.parse(input);
        const specimen = await repo.getSpecimen(parsed.specimenId);
        if (!specimen) throw new DomainError(`Specimen ${parsed.specimenId} not found.`, "NOT_FOUND");
        return ok(SpecimenSchema.parse(specimen));
      } catch (error) {
        return fail(error);
      }
    },

    async get_specimen_events(input: unknown): Promise<McpToolResult<unknown>> {
      try {
        const parsed = GetSpecimenEventsInputSchema.parse(input);
        return ok((await repo.listEvents(parsed.specimenId, {
          limit: parsed.limit,
          before: parsed.before,
          types: parsed.types
        })).map((item) => SpecimenEventSchema.parse(item)));
      } catch (error) {
        return fail(error);
      }
    },

    async get_evidence(input: unknown): Promise<McpToolResult<unknown>> {
      try {
        const parsed = GetEvidenceInputSchema.parse(input);
        const evidence = await repo.getEvidence(parsed.evidenceId);
        if (!evidence) throw new DomainError(`Evidence ${parsed.evidenceId} not found.`, "NOT_FOUND");
        return ok(EvidenceRecordSchema.parse(evidence));
      } catch (error) {
        return fail(error);
      }
    },

    async get_workflow_traces(input: unknown): Promise<McpToolResult<unknown>> {
      try {
        const parsed = GetWorkflowTracesInputSchema.parse(input);
        return ok((await repo.listTraces(parsed.specimenId, parsed.workflowId)).map((item) => TraceEventSchema.parse(item)));
      } catch (error) {
        return fail(error);
      }
    },

    async append_observation(input: unknown): Promise<McpToolResult<unknown>> {
      let specimenId = "unknown";
      let evidenceIds: string[] = [];
      const operation = "MCP Append Observation";
      try {
        const parsed = AppendObservationSchema.parse(input);
        specimenId = parsed.specimenId;
        evidenceIds = parsed.evidenceIds;
        const specimen = await repo.getSpecimen(parsed.specimenId);
        if (!specimen) throw new DomainError(`Specimen ${parsed.specimenId} not found.`, "NOT_FOUND");
        const evidence = await assertEvidenceReferences(repo, parsed.specimenId, parsed.evidenceIds);
        const currentTime = now();
        const nextNumber = specimen.observations.length + 1;
        const observation: ArchivalObservation = {
          id: stableId("obs_mcp", currentTime),
          timestamp: currentTime.getTime(),
          observationNumber: nextNumber,
          text: parsed.text,
          evidenceIds: evidence.map((item) => item.id),
          confidence: null,
          generatedBy: "local_fallback",
          verificationStatus: parsed.verificationStatus
        };
        const updated = { ...specimen, observations: [...specimen.observations, observation] };
        await repo.saveSpecimen(updated);
        await appendToolTrace({
          repo,
          now: currentTime,
          specimenId,
          operation,
          status: "succeeded",
          inputEvidenceIds: evidenceIds,
          outputEvidenceIds: evidenceIds,
          summary: "MCP appended an evidence-validated fallback observation."
        });
        return ok(observation);
      } catch (error) {
        const result = fail(error);
        if (specimenId !== "unknown") {
          await appendToolTrace({
            repo,
            now: now(),
            specimenId,
            operation,
            status: "failed",
            inputEvidenceIds: evidenceIds,
            summary: result.error.message,
            error: result.error
          }).catch(() => {});
        }
        return result;
      }
    },

    async propose_intervention(input: unknown): Promise<McpToolResult<unknown>> {
      let specimenId = "unknown";
      let evidenceIds: string[] = [];
      const operation = "MCP Propose Intervention";
      try {
        const parsed = ProposeInterventionSchema.parse(input);
        specimenId = parsed.specimenId;
        evidenceIds = parsed.evidenceIds;
        const currentTime = now();
        const proposal = await createInterventionProposal({
          repo,
          id: stableId("pr_mcp", currentTime),
          specimenId: parsed.specimenId,
          action: parsed.action,
          interventionParams: paramsForAction(parsed.action),
          evidenceIds: parsed.evidenceIds,
          reason: parsed.reason,
          proposedBy: "tool",
          createdAt: currentTime.toISOString()
        });
        await appendToolTrace({
          repo,
          now: currentTime,
          specimenId,
          operation,
          status: "succeeded",
          inputEvidenceIds: evidenceIds,
          summary: "MCP created a pending intervention proposal."
        });
        return ok(InterventionProposalSchema.parse(proposal));
      } catch (error) {
        const result = fail(error);
        if (specimenId !== "unknown") {
          await appendToolTrace({
            repo,
            now: now(),
            specimenId,
            operation,
            status: "failed",
            inputEvidenceIds: evidenceIds,
            summary: result.error.message,
            error: result.error
          }).catch(() => {});
        }
        return result;
      }
    },

    async approve_intervention(input: unknown): Promise<McpToolResult<unknown>> {
      return decideWithTrustedContext(input, "approved", "approve");
    },

    async reject_intervention(input: unknown): Promise<McpToolResult<unknown>> {
      return decideWithTrustedContext(input, "rejected", "reject");
    },

    async export_specimen(input: unknown): Promise<McpToolResult<unknown>> {
      let specimenId = "unknown";
      const operation = "MCP Export Specimen";
      try {
        const parsed = ExportSpecimenInputSchema.parse(input);
        specimenId = parsed.specimenId;
        if (!await isTrusted(options, parsed, "export")) {
          throw new DomainError("Export requires application-controlled trusted user confirmation.", "POLICY_VIOLATION");
        }
        const specimen = await repo.getSpecimen(parsed.specimenId);
        if (!specimen) throw new DomainError(`Specimen ${parsed.specimenId} not found.`, "NOT_FOUND");
        const currentTime = now();
        const exported = VaultSpecimenExportSchema.parse(scrubForExport({
          schemaVersion: 1,
          exportedAt: currentTime.toISOString(),
          specimen,
          events: await repo.listEvents(parsed.specimenId),
          evidence: await repo.listEvidence(parsed.specimenId),
          traces: await repo.listTraces(parsed.specimenId),
          proposals: await repo.listProposals(parsed.specimenId)
        }));
        await appendToolTrace({
          repo,
          now: currentTime,
          specimenId,
          operation,
          status: "succeeded",
          summary: "MCP produced a versioned specimen export after trusted confirmation."
        });
        return ok(exported);
      } catch (error) {
        const result = fail(error);
        if (specimenId !== "unknown") {
          await appendToolTrace({
            repo,
            now: now(),
            specimenId,
            operation,
            status: "failed",
            summary: result.error.message,
            error: result.error
          }).catch(() => {});
        }
        return result;
      }
    }
  };

  async function decideWithTrustedContext(input: unknown, decision: "approved" | "rejected", action: "approve" | "reject"): Promise<McpToolResult<unknown>> {
    let specimenId = "unknown";
    let evidenceIds: string[] = [];
    const operation = decision === "approved" ? "MCP Approve Intervention" : "MCP Reject Intervention";
    try {
      const parsed = TrustedDecisionSchema.parse(input);
      if (!await isTrusted(options, parsed, action)) {
        throw new DomainError("Intervention decisions require application-controlled trusted user action context.", "POLICY_VIOLATION");
      }
      const proposal = await repo.getProposal(parsed.proposalId);
      if (!proposal) throw new DomainError(`Proposal ${parsed.proposalId} not found.`, "NOT_FOUND");
      specimenId = proposal.specimenId;
      evidenceIds = proposal.evidenceIds;
      const currentTime = now();
      const result = await decideProposal({
        repo,
        proposalId: parsed.proposalId,
        decision,
        context: {
          actor: "user",
          userId: parsed.userId,
          actionNonce: parsed.actionNonce
        },
        decidedAt: currentTime.toISOString()
      });
      await appendToolTrace({
        repo,
        now: currentTime,
        specimenId,
        operation,
        status: "succeeded",
        inputEvidenceIds: evidenceIds,
        summary: result.changed ? `MCP marked proposal ${decision}.` : `MCP confirmed proposal was already ${decision}.`
      });
      return ok({
        proposal: InterventionProposalSchema.parse(result.proposal),
        event: SpecimenEventSchema.parse(result.event),
        changed: result.changed
      });
    } catch (error) {
      const result = fail(error);
      if (specimenId !== "unknown") {
        await appendToolTrace({
          repo,
          now: now(),
          specimenId,
          operation,
          status: "failed",
          inputEvidenceIds: evidenceIds,
          summary: result.error.message,
          error: result.error
        }).catch(() => {});
      }
      return result;
    }
  }
}
