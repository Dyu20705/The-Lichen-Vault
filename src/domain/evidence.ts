import { InvariantError } from "./errors";

export type EvidenceSourceType =
  | "breath_capture"
  | "signal_analysis"
  | "growth_simulation"
  | "memory_record"
  | "anomaly_detection"
  | "human_decision";

export interface EvidenceRecord {
  id: string; // unique identifier starting with 'ev_'
  specimenId: string;
  sourceType: EvidenceSourceType;
  sourceEventId?: string; // event which manufactured this evidence (if any)
  timestamp: string; // ISO-8601 representation
  payload: Record<string, any>; // structured validated data
  schemaVersion: number;
}

export function validateEvidenceRecord(evidence: EvidenceRecord): void {
  if (!evidence.id || evidence.id.trim() === "") {
    throw new InvariantError("ID must not be empty.");
  }
  if (!evidence.specimenId || evidence.specimenId.trim() === "") {
    throw new InvariantError("Specimen correlation identifier cannot be empty.");
  }
  if (!evidence.timestamp || isNaN(Date.parse(evidence.timestamp))) {
    throw new InvariantError("Timestamp must be a valid ISO-8601 string.");
  }
  if (evidence.schemaVersion <= 0) {
    throw new InvariantError("Unknown schema versions must fail safely. Version must be positive.");
  }
}
