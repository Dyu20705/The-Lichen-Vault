import { InvariantError } from "./errors";

export type TraceActor = "curator" | "archivist" | "tool" | "policy" | "system";
export type TraceStatus = "started" | "succeeded" | "failed" | "fallback";

export interface TraceEvent {
  id: string; // starts with 'tr_'
  workflowId: string; // links items in a single multi-step session
  specimenId: string;
  timestamp: string; // ISO-8601
  actor: TraceActor;
  operation: string;
  status: TraceStatus;
  inputEvidenceIds: string[];
  outputEvidenceIds: string[];
  durationMs?: number;
  summary: string;
  errorCode?: string;
}

export function validateTraceEvent(trace: TraceEvent): void {
  if (!trace.id || trace.id.trim() === "") {
    throw new InvariantError("ID must not be empty.");
  }
  if (!trace.workflowId || trace.workflowId.trim() === "") {
    throw new InvariantError("Workflow correlation identifier cannot be empty.");
  }
  if (!trace.timestamp || isNaN(Date.parse(trace.timestamp))) {
    throw new InvariantError("Timestamp must be a valid ISO-8601 string.");
  }
  if (trace.durationMs !== undefined && trace.durationMs < 0) {
    throw new InvariantError("Durations must be non-negative.");
  }
}
