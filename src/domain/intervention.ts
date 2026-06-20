import { InvariantError } from "./errors";

export type InterventionAction =
  | "adjust_light"
  | "adjust_humidity"
  | "pause_growth"
  | "merge_records"
  | "delete_specimen"
  | "export_data";

export interface AdjustLightParams {
  intensityPercentage: number; // [0, 100]
}

export interface AdjustHumidityParams {
  targetPercentage: number; // [0, 100]
}

export interface PauseGrowthParams {
  durationSeconds: number; // non-negative
}

export interface MergeRecordsParams {
  targetSpecimenId: string;
}

export interface DeleteSpecimenParams {
  reason: string;
}

export interface ExportDataParams {
  recipientEmail?: string;
}

export type InterventionParams =
  | { action: "adjust_light"; payload: AdjustLightParams }
  | { action: "adjust_humidity"; payload: AdjustHumidityParams }
  | { action: "pause_growth"; payload: PauseGrowthParams }
  | { action: "merge_records"; payload: MergeRecordsParams }
  | { action: "delete_specimen"; payload: DeleteSpecimenParams }
  | { action: "export_data"; payload: ExportDataParams };

export type InterventionStatus = "pending" | "approved" | "rejected" | "expired";
export type RiskLevel = "low" | "medium" | "high";

export interface InterventionDecision {
  decidedAt: string; // ISO-8601
  decidedBy: string; // operator ID / user
  rationale?: string;
}

export interface InterventionProposal {
  id: string; // starts with 'pr_'
  specimenId: string;
  action: InterventionAction;
  params: InterventionParams;
  evidenceIds: string[]; // references to deterministic evidence records
  reason: string;
  confidence: number; // [0, 1]
  riskLevel: RiskLevel;
  status: InterventionStatus;
  createdAt: string; // ISO-8601
  decision?: InterventionDecision;
}

export function validateInterventionProposal(proposal: InterventionProposal): void {
  if (!proposal.id || proposal.id.trim() === "") {
    throw new InvariantError("ID must not be empty.");
  }
  if (!proposal.specimenId || proposal.specimenId.trim() === "") {
    throw new InvariantError("Specimen correlation identifier cannot be empty.");
  }
  if (proposal.confidence < 0 || proposal.confidence > 1) {
    throw new InvariantError("Confidence must remain in [0, 1].");
  }
  if (!proposal.createdAt || isNaN(Date.parse(proposal.createdAt))) {
    throw new InvariantError("Timestamp must be a valid ISO-8601 string.");
  }
  
  // A pending proposal must not contain a completed decision
  if (proposal.status === "pending" && proposal.decision !== undefined) {
    throw new InvariantError("A pending proposal must not contain a completed decision.");
  }

  // An approved or rejected proposal must contain decision metadata
  if ((proposal.status === "approved" || proposal.status === "rejected") && !proposal.decision) {
    throw new InvariantError("Completed proposals must contain decision metadata.");
  }

  if (proposal.decision) {
    if (!proposal.decision.decidedAt || isNaN(Date.parse(proposal.decision.decidedAt))) {
      throw new InvariantError("Decision timestamp must be a valid ISO-8601 string.");
    }
    if (!proposal.decision.decidedBy || proposal.decision.decidedBy.trim() === "") {
      throw new InvariantError("Approved/rejected decision metadata must include a valid operator.");
    }
  }

  // Validate parameters matching specific actions
  const params = proposal.params;
  if (proposal.action !== params.action) {
    throw new InvariantError("Proposal action must match its parameter action.");
  }

  switch (params.action) {
    case "adjust_light":
      if (params.payload.intensityPercentage < 0 || params.payload.intensityPercentage > 100) {
        throw new InvariantError("Light intensity must be within bounds 0-100.");
      }
      break;
    case "adjust_humidity":
      if (params.payload.targetPercentage < 0 || params.payload.targetPercentage > 100) {
        throw new InvariantError("Humidity target must be within bounds 0-100.");
      }
      break;
    case "pause_growth":
      if (params.payload.durationSeconds < 0) {
        throw new InvariantError("Durations must be non-negative.");
      }
      break;
    case "merge_records":
      if (!params.payload.targetSpecimenId) {
        throw new InvariantError("Merge target specimen identifier can not be blank.");
      }
      break;
  }
}
