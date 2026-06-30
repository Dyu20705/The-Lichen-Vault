import { z } from "zod";
import { ArchivalObservation, InterventionAction, InterventionParams } from "../domain";
import { SpecimenRepository } from "../infrastructure/persistence/specimenRepository";
import { assertEvidenceReferences, createInterventionProposal, decideProposal } from "../application/policy";

export const ProposeInterventionSchema = z.object({
  specimenId: z.string().min(1),
  action: z.enum(["adjust_light", "adjust_humidity", "pause_growth", "merge_records", "delete_specimen", "export_data"]),
  reason: z.string().min(1),
  evidenceIds: z.array(z.string()).default([])
});

export const AppendObservationSchema = z.object({
  specimenId: z.string().min(1),
  text: z.string().min(1).max(800),
  evidenceIds: z.array(z.string()).default([])
});

export const DecideProposalSchema = z.object({
  proposalId: z.string().min(1),
  userId: z.string().min(1),
  trustedUserAction: z.literal(true),
  actionNonce: z.string().min(1)
});

function paramsForAction(action: InterventionAction): InterventionParams {
  switch (action) {
    case "adjust_light":
      return { action, payload: { intensityPercentage: 45 } };
    case "adjust_humidity":
      return { action, payload: { targetPercentage: 50 } };
    case "pause_growth":
      return { action, payload: { durationSeconds: 60 } };
    case "merge_records":
      return { action, payload: { targetSpecimenId: "requires-ui-selection" } };
    case "delete_specimen":
      return { action, payload: { reason: "MCP proposal only; no delete execution tool is exposed." } };
    case "export_data":
      return { action, payload: {} };
  }
}

export function createVaultTools(repo: SpecimenRepository) {
  return {
    async list_specimens() {
      return repo.listSpecimens();
    },

    async get_specimen(input: { specimenId: string }) {
      const specimen = await repo.getSpecimen(input.specimenId);
      if (!specimen) throw new Error(`Specimen ${input.specimenId} not found.`);
      return specimen;
    },

    async get_specimen_events(input: { specimenId: string }) {
      return repo.listEvents(input.specimenId);
    },

    async get_evidence(input: { evidenceId: string }) {
      const evidence = await repo.getEvidence(input.evidenceId);
      if (!evidence) throw new Error(`Evidence ${input.evidenceId} not found.`);
      return evidence;
    },

    async append_observation(input: z.infer<typeof AppendObservationSchema>) {
      const parsed = AppendObservationSchema.parse(input);
      const specimen = await repo.getSpecimen(parsed.specimenId);
      if (!specimen) throw new Error(`Specimen ${parsed.specimenId} not found.`);
      const evidence = await assertEvidenceReferences(repo, parsed.specimenId, parsed.evidenceIds);
      const nextNumber = specimen.observations.length + 1;
      const timestamp = Date.now();
      const observation: ArchivalObservation = {
        id: `obs_mcp_${timestamp}_${nextNumber}`,
        timestamp,
        observationNumber: nextNumber,
        text: parsed.text,
        evidenceIds: evidence.map((item) => item.id),
        confidence: null,
        generatedBy: "local_fallback",
        verificationStatus: "fallback"
      };
      const updated = { ...specimen, observations: [...specimen.observations, observation] };
      await repo.saveSpecimen(updated);
      return observation;
    },

    async propose_intervention(input: z.infer<typeof ProposeInterventionSchema>) {
      const parsed = ProposeInterventionSchema.parse(input);
      return createInterventionProposal({
        repo,
        id: `pr_mcp_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
        specimenId: parsed.specimenId,
        action: parsed.action,
        interventionParams: paramsForAction(parsed.action),
        evidenceIds: parsed.evidenceIds,
        reason: parsed.reason,
        proposedBy: "tool",
        createdAt: new Date().toISOString()
      });
    },

    async approve_intervention(input: z.infer<typeof DecideProposalSchema>) {
      const parsed = DecideProposalSchema.parse(input);
      return decideProposal({
        repo,
        proposalId: parsed.proposalId,
        decision: "approved",
        context: { actor: "user", userId: parsed.userId, actionNonce: parsed.actionNonce },
        decidedAt: new Date().toISOString()
      });
    },

    async reject_intervention(input: z.infer<typeof DecideProposalSchema>) {
      const parsed = DecideProposalSchema.parse(input);
      return decideProposal({
        repo,
        proposalId: parsed.proposalId,
        decision: "rejected",
        context: { actor: "user", userId: parsed.userId, actionNonce: parsed.actionNonce },
        decidedAt: new Date().toISOString()
      });
    },

    async export_specimen(input: { specimenId: string; trustedUserAction: true }) {
      if (input.trustedUserAction !== true) throw new Error("Export requires explicit user confirmation.");
      const specimen = await repo.getSpecimen(input.specimenId);
      if (!specimen) throw new Error(`Specimen ${input.specimenId} not found.`);
      return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        specimen,
        events: await repo.listEvents(input.specimenId),
        evidence: await repo.listEvidence(input.specimenId),
        traces: await repo.listTraces(input.specimenId),
        proposals: await repo.listProposals(input.specimenId)
      };
    }
  };
}
