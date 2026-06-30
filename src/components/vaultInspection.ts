import { z } from "zod";
import { EvidenceRecord, InterventionProposal, Specimen, SpecimenEvent, TraceEvent } from "../domain";
import { EvidenceRecordSchema, InterventionProposalSchema, SpecimenEventSchema, SpecimenSchema, TraceEventSchema } from "../shared/schemas";

const SENSITIVE_FIELD_PATTERN = /api[_-]?key|secret|token|raw[_-]?audio|rawaudio|audio(bytes)?|mediastream|prompt/i;

export interface WorkflowTraceGroup {
  workflowId: string;
  traces: TraceEvent[];
  latestTimestamp: string;
}

export interface EvidenceInspection {
  found: boolean;
  id: string;
  evidence?: EvidenceRecord;
  payload: unknown;
  relatedTraceIds: string[];
  relatedWorkflowIds: string[];
  relatedProposalIds: string[];
  groundingLabel: string;
}

export interface ProposalDisplayState {
  statusLabel: string;
  executionLabel: string;
  readOnly: boolean;
  controlsDisabled: boolean;
  canExport: boolean;
  riskLabel: string;
}

export const VaultUiExportPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  exportManifest: z.object({
    format: z.literal("lichen-vault.ui-export"),
    included: z.array(z.string()),
    excluded: z.array(z.string()),
    generatedBy: z.literal("trusted-ui")
  }),
  specimen: SpecimenSchema,
  events: z.array(SpecimenEventSchema),
  evidence: z.array(EvidenceRecordSchema),
  traces: z.array(TraceEventSchema),
  proposals: z.array(InterventionProposalSchema)
});

export type VaultUiExportPayload = z.infer<typeof VaultUiExportPayloadSchema>;

export function scrubInspectableValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[redacted: depth limit]";
  if (Array.isArray(value)) {
    return value.map((item) => scrubInspectableValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_FIELD_PATTERN.test(key)) continue;
      next[key] = scrubInspectableValue(child, depth + 1);
    }
    return next;
  }
  return value;
}

export function evidenceIdsForTrace(trace: TraceEvent): string[] {
  return Array.from(new Set([...trace.inputEvidenceIds, ...trace.outputEvidenceIds]));
}

export function groupTracesByWorkflow(traces: TraceEvent[]): WorkflowTraceGroup[] {
  const groups = new Map<string, TraceEvent[]>();
  for (const trace of traces) {
    const items = groups.get(trace.workflowId) ?? [];
    items.push(trace);
    groups.set(trace.workflowId, items);
  }

  return [...groups.entries()]
    .map(([workflowId, items]) => {
      const sorted = [...items].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      return {
        workflowId,
        traces: sorted,
        latestTimestamp: sorted[sorted.length - 1]?.timestamp ?? ""
      };
    })
    .sort((a, b) => Date.parse(b.latestTimestamp) - Date.parse(a.latestTimestamp));
}

export function traceStatusLabel(trace: TraceEvent): string {
  if (trace.status === "fallback") return "Fallback path";
  if (trace.status === "failed") return "Failed";
  if (trace.status === "started") return "Started";
  return "Succeeded";
}

export function inspectEvidenceReference(
  records: EvidenceRecord[],
  evidenceId: string,
  traces: TraceEvent[] = [],
  proposals: InterventionProposal[] = []
): EvidenceInspection {
  const evidence = records.find((item) => item.id === evidenceId);
  const relatedTraces = traces.filter((trace) => evidenceIdsForTrace(trace).includes(evidenceId));
  const relatedProposals = proposals.filter((proposal) => proposal.evidenceIds.includes(evidenceId));
  const workflowIds = Array.from(new Set(relatedTraces.map((trace) => trace.workflowId)));

  if (!evidence) {
    return {
      found: false,
      id: evidenceId,
      payload: {},
      relatedTraceIds: relatedTraces.map((trace) => trace.id),
      relatedWorkflowIds: workflowIds,
      relatedProposalIds: relatedProposals.map((proposal) => proposal.id),
      groundingLabel: "Missing evidence reference"
    };
  }

  return {
    found: true,
    id: evidenceId,
    evidence,
    payload: scrubInspectableValue(evidence.payload),
    relatedTraceIds: relatedTraces.map((trace) => trace.id),
    relatedWorkflowIds: workflowIds,
    relatedProposalIds: relatedProposals.map((proposal) => proposal.id),
    groundingLabel: relatedProposals.length > 0
      ? "Grounds an intervention proposal"
      : relatedTraces.some((trace) => trace.outputEvidenceIds.includes(evidenceId))
        ? "Produced by workflow trace"
        : "Referenced by workflow trace"
  };
}

export function proposalDisplayState(proposal: InterventionProposal, busyProposalId: string | null = null): ProposalDisplayState {
  const busy = busyProposalId === proposal.id;
  if (proposal.status === "approved") {
    return {
      statusLabel: "Approved",
      executionLabel: "Action pending separate execution",
      readOnly: true,
      controlsDisabled: true,
      canExport: proposal.action === "export_data",
      riskLabel: `${proposal.riskLevel} risk`
    };
  }
  if (proposal.status === "rejected") {
    return {
      statusLabel: "Rejected",
      executionLabel: "Proposal closed without execution",
      readOnly: true,
      controlsDisabled: true,
      canExport: false,
      riskLabel: `${proposal.riskLevel} risk`
    };
  }
  if (proposal.status === "expired") {
    return {
      statusLabel: "Expired",
      executionLabel: "Proposal expired without execution",
      readOnly: true,
      controlsDisabled: true,
      canExport: false,
      riskLabel: `${proposal.riskLevel} risk`
    };
  }
  return {
    statusLabel: busy ? "Recording decision" : "Pending human decision",
    executionLabel: "Not executed",
    readOnly: false,
    controlsDisabled: busy,
    canExport: false,
    riskLabel: `${proposal.riskLevel} risk`
  };
}

export function createVaultUiExportPayload(params: {
  specimen: Specimen;
  events: SpecimenEvent[];
  evidence: EvidenceRecord[];
  traces: TraceEvent[];
  proposals: InterventionProposal[];
  exportedAt: string;
}): VaultUiExportPayload {
  return VaultUiExportPayloadSchema.parse(scrubInspectableValue({
    schemaVersion: 1,
    exportedAt: params.exportedAt,
    exportManifest: {
      format: "lichen-vault.ui-export",
      included: [
        "specimen profile",
        "event log",
        "structured evidence",
        "workflow traces",
        "intervention proposals and decisions"
      ],
      excluded: [
        "raw audio",
        "API keys",
        "approval tokens",
        "secrets",
        "raw model prompts"
      ],
      generatedBy: "trusted-ui"
    },
    specimen: params.specimen,
    events: params.events,
    evidence: params.evidence,
    traces: params.traces,
    proposals: params.proposals
  }));
}
