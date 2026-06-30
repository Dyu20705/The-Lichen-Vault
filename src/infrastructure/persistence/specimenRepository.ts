import { EvidenceRecord, InterventionProposal, Specimen, SpecimenEvent, TraceEvent, WorkflowSession } from "../../domain";

export interface SpecimenRepository {
  getSpecimen(id: string): Promise<Specimen | null>;
  saveSpecimen(specimen: Specimen): Promise<void>;
  listSpecimens(): Promise<Specimen[]>;
  appendEvent(event: SpecimenEvent): Promise<void>;
  listEvents(
    specimenId: string,
    options?: {
      limit?: number;
      before?: string; // ISO-8601 string
      types?: SpecimenEvent["type"][];
    }
  ): Promise<SpecimenEvent[]>;
  appendEvidence(evidence: EvidenceRecord): Promise<void>;
  getEvidence(id: string): Promise<EvidenceRecord | null>;
  listEvidence(specimenId: string): Promise<EvidenceRecord[]>;
  saveWorkflow(session: WorkflowSession): Promise<void>;
  getWorkflow(id: string): Promise<WorkflowSession | null>;
  listWorkflows(specimenId: string): Promise<WorkflowSession[]>;
  appendTrace(trace: TraceEvent): Promise<void>;
  listTraces(specimenId: string, workflowId?: string): Promise<TraceEvent[]>;
  saveProposal(proposal: InterventionProposal): Promise<void>;
  getProposal(id: string): Promise<InterventionProposal | null>;
  listProposals(specimenId: string): Promise<InterventionProposal[]>;
}
