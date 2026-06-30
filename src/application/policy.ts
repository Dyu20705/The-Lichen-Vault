import {
  EvidenceRecord,
  InterventionAction,
  InterventionDecision,
  InterventionParams,
  InterventionProposal,
  PolicyError,
  SpecimenEvent
} from "../domain";
import { SpecimenRepository } from "../infrastructure/persistence/specimenRepository";

export type DecisionKind = "approved" | "rejected";

export interface UserActionContext {
  actor: "user";
  userId: string;
  actionNonce: string;
}

export function classifyRisk(action: InterventionAction): "low" | "medium" | "high" {
  if (action === "delete_specimen" || action === "merge_records" || action === "export_data") return "high";
  if (action === "adjust_humidity") return "medium";
  return "low";
}

export async function assertEvidenceReferences(repo: SpecimenRepository, specimenId: string, evidenceIds: string[]): Promise<EvidenceRecord[]> {
  const unique = new Set(evidenceIds);
  if (unique.size !== evidenceIds.length) {
    throw new PolicyError("Evidence references must not be duplicated.");
  }
  const records = await Promise.all(evidenceIds.map((id) => repo.getEvidence(id)));
  const missing = evidenceIds.filter((_, index) => records[index] === null);
  if (missing.length > 0) {
    throw new PolicyError(`Missing evidence references: ${missing.join(", ")}`);
  }
  const wrongSpecimen = records.filter((record): record is EvidenceRecord => !!record && record.specimenId !== specimenId);
  if (wrongSpecimen.length > 0) {
    throw new PolicyError("Evidence references must belong to the proposal specimen.");
  }
  return records.filter((record): record is EvidenceRecord => !!record);
}

export async function createInterventionProposal(params: {
  repo: SpecimenRepository;
  id: string;
  specimenId: string;
  action: InterventionAction;
  interventionParams: InterventionParams;
  evidenceIds: string[];
  reason: string;
  proposedBy: InterventionProposal["proposedBy"];
  createdAt: string;
}): Promise<InterventionProposal> {
  await assertEvidenceReferences(params.repo, params.specimenId, params.evidenceIds);
  const heuristicConfidence = Number(Math.min(0.95, 0.45 + params.evidenceIds.length * 0.18).toFixed(2));
  const proposal: InterventionProposal = {
    id: params.id,
    specimenId: params.specimenId,
    action: params.action,
    params: params.interventionParams,
    evidenceIds: params.evidenceIds,
    reason: params.reason,
    heuristicConfidence,
    proposedBy: params.proposedBy,
    riskLevel: classifyRisk(params.action),
    status: "pending",
    createdAt: params.createdAt
  };
  await params.repo.saveProposal(proposal);
  return proposal;
}

export async function decideProposal(params: {
  repo: SpecimenRepository;
  proposalId: string;
  decision: DecisionKind;
  context: UserActionContext | { actor: "agent" | "system" | "tool"; userId?: string; actionNonce?: string };
  decidedAt: string;
  rationale?: string;
}): Promise<{ proposal: InterventionProposal; event: SpecimenEvent; changed: boolean }> {
  const existing = await params.repo.getProposal(params.proposalId);
  if (!existing) throw new PolicyError(`Proposal ${params.proposalId} was not found.`);
  if (params.context.actor !== "user" || !params.context.userId || !params.context.actionNonce) {
    throw new PolicyError("Intervention decisions require an explicit trusted user action context.");
  }
  if (existing.status === "approved" || existing.status === "rejected") {
    const event = decisionEvent(existing, params.decision, existing.decision!, false);
    return { proposal: existing, event, changed: false };
  }

  const decision: InterventionDecision = {
    decidedAt: params.decidedAt,
    decidedBy: params.context.userId,
    rationale: params.rationale
  };
  const next: InterventionProposal = {
    ...existing,
    status: params.decision,
    decision
  };
  await params.repo.saveProposal(next);
  const event = decisionEvent(next, params.decision, decision, true);
  await params.repo.appendEvent(event);
  return { proposal: next, event, changed: true };
}

function decisionEvent(proposal: InterventionProposal, decisionKind: DecisionKind, decision: InterventionDecision, changed: boolean): SpecimenEvent {
  if (decisionKind === "approved") {
    return {
      id: `evt_${proposal.id}_approved`,
      specimenId: proposal.specimenId,
      timestamp: decision.decidedAt,
      type: "intervention_approved",
      schemaVersion: 2,
      evidenceIds: proposal.evidenceIds,
      payload: {
        proposalId: proposal.id,
        approvedAt: decision.decidedAt,
        approver: decision.decidedBy,
        rationale: decision.rationale ?? (changed ? "Approved from cabinet UI." : "Previously approved.")
      }
    };
  }
  return {
    id: `evt_${proposal.id}_rejected`,
    specimenId: proposal.specimenId,
    timestamp: decision.decidedAt,
    type: "intervention_rejected",
    schemaVersion: 2,
    evidenceIds: proposal.evidenceIds,
    payload: {
      proposalId: proposal.id,
      rejectedAt: decision.decidedAt,
      rejector: decision.decidedBy,
      rationale: decision.rationale ?? (changed ? "Rejected from cabinet UI." : "Previously rejected.")
    }
  };
}
