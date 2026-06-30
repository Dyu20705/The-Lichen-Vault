import fs from "fs/promises";
import { z } from "zod";
import { JsonFileSpecimenRepository, scrubPersistentValue } from "../infrastructure/persistence/jsonFileSpecimenRepository";
import { EvidenceRecord, InterventionProposal, Specimen, SpecimenEvent, TraceEvent, WorkflowSession } from "../domain";
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

  await params.repository.importVaultData({
    specimen,
    events: parsed.events as SpecimenEvent[],
    evidence: parsed.evidence as EvidenceRecord[],
    workflows: parsed.workflows as WorkflowSession[],
    traces: parsed.traces as TraceEvent[],
    proposals: parsed.proposals as InterventionProposal[]
  });

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
