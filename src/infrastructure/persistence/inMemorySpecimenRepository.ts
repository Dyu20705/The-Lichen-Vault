import {
  EvidenceRecord,
  InterventionProposal,
  Specimen,
  SpecimenEvent,
  TraceEvent,
  WorkflowSession,
  validateEvidenceRecord,
  validateInterventionProposal,
  validateSpecimen,
  validateSpecimenEvent,
  validateTraceEvent,
  validateWorkflowSession
} from "../../domain";
import { SpecimenRepository } from "./specimenRepository";
import {
  EvidenceRecordSchema,
  InterventionProposalSchema,
  SpecimenEventSchema,
  SpecimenSchema,
  TraceEventSchema,
  WorkflowSessionSchema
} from "../../shared/schemas";

function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemorySpecimenRepository implements SpecimenRepository {
  private specimens = new Map<string, Specimen>();
  private eventsBySpecimen = new Map<string, SpecimenEvent[]>();
  private evidenceById = new Map<string, EvidenceRecord>();
  private workflowsById = new Map<string, WorkflowSession>();
  private tracesBySpecimen = new Map<string, TraceEvent[]>();
  private proposalsById = new Map<string, InterventionProposal>();

  async getSpecimen(id: string): Promise<Specimen | null> {
    const val = this.specimens.get(id);
    if (!val) return null;
    return deepClone(val);
  }

  async saveSpecimen(specimen: Specimen): Promise<void> {
    const parsed = SpecimenSchema.parse(specimen) as Specimen;
    validateSpecimen(parsed);
    this.specimens.set(parsed.id, deepClone(parsed));
  }

  async listSpecimens(): Promise<Specimen[]> {
    return Array.from(this.specimens.values()).map((specimen) => deepClone(specimen));
  }

  async appendEvent(event: SpecimenEvent): Promise<void> {
    const parsed = SpecimenEventSchema.parse(event) as SpecimenEvent;
    validateSpecimenEvent(parsed);

    for (const evList of this.eventsBySpecimen.values()) {
      if (evList.some((existing) => existing.id === parsed.id)) {
        return;
      }
    }

    const events = this.eventsBySpecimen.get(parsed.specimenId) || [];
    this.eventsBySpecimen.set(parsed.specimenId, [...events, deepClone(parsed)]);

    const specimen = this.specimens.get(parsed.specimenId);
    if (specimen) {
      if (!specimen.eventIds.includes(parsed.id)) {
        const updated = { ...specimen, eventIds: [...specimen.eventIds, parsed.id] };
        validateSpecimen(updated);
        this.specimens.set(parsed.specimenId, deepClone(updated));
      }
    }
  }

  async listEvents(
    specimenId: string,
    options?: {
      limit?: number;
      before?: string;
      types?: SpecimenEvent["type"][];
    }
  ): Promise<SpecimenEvent[]> {
    let events = this.eventsBySpecimen.get(specimenId) || [];

    // Filter by timestamp (before)
    if (options?.before) {
      const beforeTime = Date.parse(options.before);
      events = events.filter((e) => Date.parse(e.timestamp) < beforeTime);
    }

    // Filter by types
    if (options?.types && options.types.length > 0) {
      events = events.filter((e) => options.types!.includes(e.type));
    }

    events = [...events].sort((a, b) => {
      const timeDelta = Date.parse(a.timestamp) - Date.parse(b.timestamp);
      return timeDelta === 0 ? a.id.localeCompare(b.id) : timeDelta;
    });

    if (options?.limit !== undefined) {
      events = events.slice(-options.limit);
    }

    return events.map((event) => deepClone(event));
  }

  async appendEvidence(evidence: EvidenceRecord): Promise<void> {
    const parsed = EvidenceRecordSchema.parse(evidence) as EvidenceRecord;
    validateEvidenceRecord(parsed);
    if (this.evidenceById.has(parsed.id)) return;
    this.evidenceById.set(parsed.id, deepClone(parsed));
  }

  async getEvidence(id: string): Promise<EvidenceRecord | null> {
    const evidence = this.evidenceById.get(id);
    return evidence ? deepClone(evidence) : null;
  }

  async listEvidence(specimenId: string): Promise<EvidenceRecord[]> {
    return Array.from(this.evidenceById.values())
      .filter((evidence) => evidence.specimenId === specimenId)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id))
      .map((evidence) => deepClone(evidence));
  }

  async saveWorkflow(session: WorkflowSession): Promise<void> {
    const parsed = WorkflowSessionSchema.parse(session) as WorkflowSession;
    validateWorkflowSession(parsed);
    this.workflowsById.set(parsed.id, deepClone(parsed));
  }

  async getWorkflow(id: string): Promise<WorkflowSession | null> {
    const workflow = this.workflowsById.get(id);
    return workflow ? deepClone(workflow) : null;
  }

  async listWorkflows(specimenId: string): Promise<WorkflowSession[]> {
    return Array.from(this.workflowsById.values())
      .filter((workflow) => workflow.specimenId === specimenId)
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id))
      .map((workflow) => deepClone(workflow));
  }

  async appendTrace(trace: TraceEvent): Promise<void> {
    const parsed = TraceEventSchema.parse(trace) as TraceEvent;
    validateTraceEvent(parsed);
    const traces = this.tracesBySpecimen.get(parsed.specimenId) || [];
    if (traces.some((existing) => existing.id === parsed.id)) return;
    this.tracesBySpecimen.set(parsed.specimenId, [...traces, deepClone(parsed)]);
  }

  async listTraces(specimenId: string, workflowId?: string): Promise<TraceEvent[]> {
    return (this.tracesBySpecimen.get(specimenId) || [])
      .filter((trace) => !workflowId || trace.workflowId === workflowId)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id))
      .map((trace) => deepClone(trace));
  }

  async saveProposal(proposal: InterventionProposal): Promise<void> {
    const parsed = InterventionProposalSchema.parse(proposal) as InterventionProposal;
    validateInterventionProposal(parsed);
    this.proposalsById.set(parsed.id, deepClone(parsed));
  }

  async getProposal(id: string): Promise<InterventionProposal | null> {
    const proposal = this.proposalsById.get(id);
    return proposal ? deepClone(proposal) : null;
  }

  async listProposals(specimenId: string): Promise<InterventionProposal[]> {
    return Array.from(this.proposalsById.values())
      .filter((proposal) => proposal.specimenId === specimenId)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
      .map((proposal) => deepClone(proposal));
  }
}
