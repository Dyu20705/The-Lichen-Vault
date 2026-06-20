import { InvariantError } from "./errors";

export type SpecimenEventType =
  | "breath_deposited"
  | "signal_analyzed"
  | "growth_simulated"
  | "anomaly_detected"
  | "archival_entry_created"
  | "intervention_proposed"
  | "intervention_approved"
  | "intervention_rejected"
  | "workflow_fallback";

interface BaseSpecimenEvent {
  id: string; // unique event ID
  specimenId: string; // correlated specimen ID
  timestamp: string; // ISO-8601 timestamp string
  type: SpecimenEventType;
  schemaVersion: number;
  evidenceIds: string[]; // referenced evidence identifiers, must not contain duplicates
}

export interface BreathDepositedEvent extends BaseSpecimenEvent {
  type: "breath_deposited";
  payload: {
    totalDuration: number;
    averageIntensity: number;
    overallRhythm: string;
    captureMode: "microphone" | "simulated";
    seed: number;
    structure: string;
  };
}

export interface SignalAnalyzedEvent extends BaseSpecimenEvent {
  type: "signal_analyzed";
  payload: {
    signalQuality: number;
    cadenceStability: number;
    intensityTrend: "rising" | "falling" | "stable" | "irregular";
    anomalies: string[];
    confidence: number;
    recommendation: "accept" | "accept_with_caution" | "recapture";
  };
}

export interface GrowthSimulatedEvent extends BaseSpecimenEvent {
  type: "growth_simulated";
  payload: {
    previousStage: string;
    nextStage: string;
    growthDelta: number;
    mutations: string[];
    environmentalResponses: string[];
    seed: number;
    evidenceFactors: string[];
  };
}

export interface AnomalyDetectedEvent extends BaseSpecimenEvent {
  type: "anomaly_detected";
  payload: {
    detected: boolean;
    severity: "none" | "low" | "moderate" | "high";
    evidence: Array<{
      metric: string;
      observed: number | string;
      baseline: number | string;
      deviation?: number;
    }>;
    hypotheses: Array<{
      description: string;
      confidence: number;
      supportingEvidenceIds: string[];
    }>;
    nextObservation: string | null;
  };
}

export interface ArchivalEntryCreatedEvent extends BaseSpecimenEvent {
  type: "archival_entry_created";
  payload: {
    text: string;
    observationNumber: number;
    confidence: number;
    generatedBy: "gemini" | "local_fallback";
    promptVersion?: string;
    model?: string;
  };
}

export interface InterventionProposedEvent extends BaseSpecimenEvent {
  type: "intervention_proposed";
  payload: {
    proposalId: string;
    action: "adjust_light" | "adjust_humidity" | "pause_growth" | "merge_records" | "delete_specimen" | "export_data";
    parameters: Record<string, any>;
    reason: string;
    confidence: number;
    riskLevel: "low" | "medium" | "high";
  };
}

export interface InterventionApprovedEvent extends BaseSpecimenEvent {
  type: "intervention_approved";
  payload: {
    proposalId: string;
    approvedAt: string; // ISO-8601
    approver: string; // "custodian" or user representation
    rationale?: string;
  };
}

export interface InterventionRejectedEvent extends BaseSpecimenEvent {
  type: "intervention_rejected";
  payload: {
    proposalId: string;
    rejectedAt: string; // ISO-8601
    rejector: string;
    rationale?: string;
  };
}

export interface WorkflowFallbackEvent extends BaseSpecimenEvent {
  type: "workflow_fallback";
  payload: {
    fallbackReason: string;
    recoveryAction: string;
    affectedSteps: string[];
  };
}

export type SpecimenEvent =
  | BreathDepositedEvent
  | SignalAnalyzedEvent
  | GrowthSimulatedEvent
  | AnomalyDetectedEvent
  | ArchivalEntryCreatedEvent
  | InterventionProposedEvent
  | InterventionApprovedEvent
  | InterventionRejectedEvent
  | WorkflowFallbackEvent;

// UTILITY INVARIANT CHECKER
export function validateSpecimenEvent(event: SpecimenEvent): void {
  if (!event.id || event.id.trim() === "") {
    throw new InvariantError("ID must not be empty.");
  }
  if (!event.specimenId || event.specimenId.trim() === "") {
    throw new InvariantError("A specimen event must reference the correct specimen.");
  }
  if (!event.timestamp || isNaN(Date.parse(event.timestamp))) {
    throw new InvariantError("Timestamp must be a valid ISO-8601 string.");
  }
  if (event.schemaVersion <= 0) {
    throw new InvariantError("Unknown schema versions must fail safely. Version must be positive.");
  }
  
  // No duplicated evidence id references invariant
  const uniqueEvs = new Set(event.evidenceIds);
  if (uniqueEvs.size !== event.evidenceIds.length) {
    throw new InvariantError("Evidence references must not contain duplicates.");
  }

  // Type-specific invariant validations
  if (event.type === "intervention_approved") {
    const p = event.payload;
    if (!p.approvedAt || isNaN(Date.parse(p.approvedAt))) {
      throw new InvariantError("An approved intervention must contain approval metadata with a valid ISO-8601 timestamp.");
    }
    if (!p.approver || p.approver.trim() === "") {
      throw new InvariantError("An approved intervention must contain approval metadata with an approver name.");
    }
  }

  if (event.type === "intervention_rejected") {
    const p = event.payload;
    if (!p.rejectedAt || isNaN(Date.parse(p.rejectedAt))) {
      throw new InvariantError("A rejected intervention must contain rejection metadata with a valid ISO-8601 timestamp.");
    }
  }
}
