import { InvariantError } from "./errors";

export const EVIDENCE_ID_PATTERN = /^ev_[A-Za-z0-9_-]+$/;
export const EVIDENCE_SCHEMA_VERSION = 1;

export type EvidenceSourceType =
  | "breath_capture"
  | "signal_analysis"
  | "growth_simulation"
  | "memory_record"
  | "anomaly_detection"
  | "human_decision";

const EVIDENCE_SOURCE_TYPES = new Set<EvidenceSourceType>([
  "breath_capture",
  "signal_analysis",
  "growth_simulation",
  "memory_record",
  "anomaly_detection",
  "human_decision"
]);

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
  if (!EVIDENCE_ID_PATTERN.test(evidence.id)) {
    throw new InvariantError("Evidence IDs must use the ev_ prefix convention.");
  }
  if (!evidence.specimenId || evidence.specimenId.trim() === "") {
    throw new InvariantError("Specimen correlation identifier cannot be empty.");
  }
  if (!EVIDENCE_SOURCE_TYPES.has(evidence.sourceType)) {
    throw new InvariantError("Evidence source type is not supported.");
  }
  if (evidence.sourceEventId !== undefined && evidence.sourceEventId.trim() === "") {
    throw new InvariantError("Source event reference cannot be blank.");
  }
  if (!evidence.timestamp || isNaN(Date.parse(evidence.timestamp))) {
    throw new InvariantError("Timestamp must be a valid ISO-8601 string.");
  }
  if (typeof evidence.payload !== "object" || evidence.payload === null || Array.isArray(evidence.payload)) {
    throw new InvariantError("Evidence payload must be a structured object.");
  }
  if (evidence.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    throw new InvariantError("Unsupported evidence schema version.");
  }
}
