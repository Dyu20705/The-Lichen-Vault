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
import { StorageError } from "../../domain/errors";
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
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
    this.assertSpecimenObservationEvidence(parsed);
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
    const existing = this.evidenceById.get(parsed.id);
    if (existing) {
      if (stableJson(existing) === stableJson(parsed)) return;
      throw new StorageError(`Evidence id ${parsed.id} already exists with different content.`);
    }
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
    this.assertProposalEvidence(parsed);
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

  private assertSpecimenObservationEvidence(specimen: Specimen): void {
    for (const observation of specimen.observations) {
      const evidenceIds = observation.evidenceIds ?? [];
      if (new Set(evidenceIds).size !== evidenceIds.length) {
        throw new StorageError("Observation evidence references must not contain duplicates.");
      }
      if (observation.verificationStatus !== "grounded") continue;
      const missing = evidenceIds.filter((id) => !this.evidenceById.has(id));
      if (missing.length > 0) {
        throw new StorageError(`Missing evidence references: ${missing.join(", ")}`);
      }
      const wrongSpecimen = evidenceIds
        .map((id) => this.evidenceById.get(id))
        .filter((evidence): evidence is EvidenceRecord => !!evidence && evidence.specimenId !== specimen.id);
      if (wrongSpecimen.length > 0) {
        throw new StorageError("Observation evidence references must belong to the saved specimen.");
      }
    }
  }

  private assertProposalEvidence(proposal: InterventionProposal): void {
    if (new Set(proposal.evidenceIds).size !== proposal.evidenceIds.length) {
      throw new StorageError("Proposal evidence references must not contain duplicates.");
    }
    const missing = proposal.evidenceIds.filter((id) => !this.evidenceById.has(id));
    if (missing.length > 0) {
      throw new StorageError(`Missing evidence references: ${missing.join(", ")}`);
    }
    const wrongSpecimen = proposal.evidenceIds
      .map((id) => this.evidenceById.get(id))
      .filter((evidence): evidence is EvidenceRecord => !!evidence && evidence.specimenId !== proposal.specimenId);
    if (wrongSpecimen.length > 0) {
      throw new StorageError("Proposal evidence references must belong to the proposal specimen.");
    }
  }
}
