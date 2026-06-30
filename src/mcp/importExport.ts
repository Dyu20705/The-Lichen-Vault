import fs from "fs/promises";
import { z } from "zod";
import { JsonFileSpecimenRepository, scrubPersistentValue } from "../infrastructure/persistence/jsonFileSpecimenRepository";
import {
  EvidenceRecord,
  InterventionProposal,
  Specimen,
  SpecimenEvent,
  TraceEvent,
  WorkflowSession
} from "../domain";
import {
  EvidenceRecordSchema,
  InterventionProposalSchema,
  SpecimenEventSchema,
  SpecimenSchema,
  TraceEventSchema,
  WorkflowSessionSchema
} from "../shared/schemas";

const BrowserOrMcpExportSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  exportManifest: z.object({
    format: z.literal("lichen-vault.ui-export").or(z.literal("lichen-vault.mcp-export")),
    generatedBy: z.string()
  }).passthrough().optional(),
  specimen: SpecimenSchema,
  events: z.array(SpecimenEventSchema).default([]),
  evidence: z.array(EvidenceRecordSchema).default([]),
  workflows: z.array(WorkflowSessionSchema).default([]),
  traces: z.array(TraceEventSchema).default([]),
  proposals: z.array(InterventionProposalSchema).default([])
});

export type ImportSummary = {
  specimenId: string;
  specimens: number;
  events: number;
  evidence: number;
  workflows: number;
  traces: number;
  proposals: number;
};

export async function importVaultExport(params: {
  exportPath: string;
  repository: JsonFileSpecimenRepository;
}): Promise<ImportSummary> {
  const raw = await fs.readFile(params.exportPath, "utf8");
  const parsed = BrowserOrMcpExportSchema.parse(scrubPersistentValue(JSON.parse(raw)));
  const specimen = parsed.specimen as Specimen;

  for (const evidence of parsed.evidence as EvidenceRecord[]) await params.repository.appendEvidence(evidence);
  await params.repository.saveSpecimen(specimen);
  for (const event of parsed.events as SpecimenEvent[]) await params.repository.appendEvent(event);
  for (const workflow of parsed.workflows as WorkflowSession[]) await params.repository.saveWorkflow(workflow);
  for (const trace of parsed.traces as TraceEvent[]) await params.repository.appendTrace(trace);
  for (const proposal of parsed.proposals as InterventionProposal[]) await params.repository.saveProposal(proposal);

  return {
    specimenId: specimen.id,
    specimens: 1,
    events: parsed.events.length,
    evidence: parsed.evidence.length,
    workflows: parsed.workflows.length,
    traces: parsed.traces.length,
    proposals: parsed.proposals.length
  };
}
