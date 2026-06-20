import { InvariantError } from "./errors";

export type WorkflowStatus = "running" | "completed" | "failed";

export interface WorkflowSession {
  id: string; // starts with 'wf_'
  specimenId: string;
  status: WorkflowStatus;
  startedAt: string; // ISO-8601
  completedAt?: string; // ISO-8601
  stepsCompleted: string[];
  errors: string[];
  traceIds: string[];
}

export function validateWorkflowSession(session: WorkflowSession): void {
  if (!session.id || session.id.trim() === "") {
    throw new InvariantError("ID must not be empty.");
  }
  if (!session.specimenId || session.specimenId.trim() === "") {
    throw new InvariantError("Correlation identifier specimenId cannot be empty.");
  }
  if (!session.startedAt || isNaN(Date.parse(session.startedAt))) {
    throw new InvariantError("Timestamp must be a valid ISO-8601 string.");
  }
  if (session.completedAt && isNaN(Date.parse(session.completedAt))) {
    throw new InvariantError("Completed timestamp must be a valid ISO-8601 string.");
  }
  if (session.status === "completed" && !session.completedAt) {
    throw new InvariantError("Completed workflow must have a completedAt timestamp.");
  }
}
