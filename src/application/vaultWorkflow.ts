import { BreathRecording } from "../types";
import { SpecimenEvent, TraceEvent, WorkflowSession } from "../domain";
import { SpecimenRepository } from "../infrastructure/persistence/specimenRepository";
import { calculateGrowthState } from "../utils/generator";
import { ARCHIVIST_PROMPT_VERSION, ArchivistResponseSchema, localArchivistFallback, toObservation } from "./archivist";
import { GROWTH_ALGORITHM_VERSION, simulateGrowth } from "./growthSimulator";
import { createInterventionProposal } from "./policy";
import { curateSignal } from "./signalCurator";

export interface WorkflowResult {
  specimenId: string;
  workflowId: string;
}

function nowId(prefix: string, now: number): string {
  return `${prefix}_${now}_${Math.floor(Math.random() * 100000)}`;
}

function trace(params: Omit<TraceEvent, "id" | "timestamp"> & { timestamp?: string }): TraceEvent {
  return {
    id: `tr_${params.workflowId}_${params.operation.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    timestamp: params.timestamp ?? new Date().toISOString(),
    ...params
  };
}

async function appendTrace(repo: SpecimenRepository, item: TraceEvent, workflow: WorkflowSession): Promise<WorkflowSession> {
  await repo.appendTrace(item);
  const next = {
    ...workflow,
    traceIds: workflow.traceIds.includes(item.id) ? workflow.traceIds : [...workflow.traceIds, item.id]
  };
  await repo.saveWorkflow(next);
  return next;
}

export async function runBreathWorkflow(params: {
  recordings: BreathRecording[];
  repository: SpecimenRepository;
  captureMode?: "microphone" | "simulated";
}): Promise<WorkflowResult> {
  const started = Date.now();
  const timestamp = new Date(started).toISOString();
  const workflowId = nowId("wf", started);
  const specimenId = `lichen_${workflowId}`;
  let workflow: WorkflowSession = {
    id: workflowId,
    specimenId,
    status: "running",
    startedAt: timestamp,
    stepsCompleted: [],
    errors: [],
    traceIds: []
  };
  await params.repository.saveWorkflow(workflow);

  const curatedStarted = performance.now();
  const curated = curateSignal({
    recordings: params.recordings,
    specimenId,
    workflowId,
    captureMode: params.captureMode ?? (params.recordings.some((item) => item.captureMode === "microphone") ? "microphone" : "simulated"),
    now: new Date(started)
  });
  for (const evidence of curated.evidence) {
    await params.repository.appendEvidence(evidence);
  }
  const signalEvent: SpecimenEvent = {
    id: `evt_${workflowId}_signal`,
    specimenId,
    timestamp,
    type: "signal_analyzed",
    schemaVersion: 2,
    evidenceIds: curated.evidence.map((item) => item.id),
    payload: {
      ...curated.curatedSignal.quality,
      confidence: curated.curatedSignal.quality.signalQuality
    }
  };
  workflow = await appendTrace(params.repository, trace({
    workflowId,
    specimenId,
    actor: "curator",
    operation: "Signal Curator",
    status: "succeeded",
    inputEvidenceIds: [],
    outputEvidenceIds: curated.evidence.map((item) => item.id),
    durationMs: Math.round(performance.now() - curatedStarted),
    summary: "Breath metrics validated and normalized."
  }), workflow);

  const growthStarted = performance.now();
  const growth = simulateGrowth({
    curatedSignal: curated.curatedSignal,
    specimenId,
    workflowId,
    inputEvidenceIds: curated.evidence.map((item) => item.id),
    birthTime: started,
    timestamp,
    algorithmVersion: GROWTH_ALGORITHM_VERSION
  });
  await params.repository.appendEvidence(growth.evidence);
  await params.repository.saveSpecimen(growth.specimen);
  const depositedEvent: SpecimenEvent = {
    id: `evt_${workflowId}_breath`,
    specimenId,
    timestamp,
    type: "breath_deposited",
    schemaVersion: 2,
    evidenceIds: [curated.evidence[0].id],
    payload: {
      totalDuration: curated.curatedSignal.metrics.totalDuration,
      averageIntensity: curated.curatedSignal.metrics.averageIntensity,
      overallRhythm: curated.curatedSignal.metrics.overallRhythm,
      captureMode: curated.curatedSignal.captureMode,
      seed: growth.specimen.seed,
      structure: growth.specimen.structure
    }
  };
  const growthEvent: SpecimenEvent = {
    id: `evt_${workflowId}_growth`,
    specimenId,
    timestamp,
    type: "growth_simulated",
    schemaVersion: 2,
    evidenceIds: [growth.evidence.id],
    payload: {
      previousStage: "Respiration deposit",
      nextStage: growth.specimen.structure,
      growthDelta: growth.growthDelta,
      mutations: [],
      environmentalResponses: [],
      seed: growth.specimen.seed,
      evidenceFactors: growth.evidenceFactors
    }
  };
  await params.repository.appendEvent(signalEvent);
  await params.repository.appendEvent(depositedEvent);
  await params.repository.appendEvent(growthEvent);
  workflow = await appendTrace(params.repository, trace({
    workflowId,
    specimenId,
    actor: "system",
    operation: "Growth Simulator",
    status: "succeeded",
    inputEvidenceIds: curated.evidence.map((item) => item.id),
    outputEvidenceIds: [growth.evidence.id],
    durationMs: Math.round(performance.now() - growthStarted),
    summary: `Deterministic ${GROWTH_ALGORITHM_VERSION} growth produced seed ${growth.specimen.seed}.`
  }), workflow);

  const archivistStarted = performance.now();
  const evidence = await params.repository.listEvidence(specimenId);
  const growthState = calculateGrowthState(growth.specimen.birthTime);
  let response = localArchivistFallback({
    specimenName: growth.specimen.name,
    stageLabel: growthState.stageLabel,
    evidenceIds: evidence.map((item) => item.id),
    reason: "model_not_called"
  });
  try {
    const res = await fetch("/api/archivist/observe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        specimen: {
          id: growth.specimen.id,
          name: growth.specimen.name,
          structure: growth.specimen.structure,
          stageLabel: growthState.stageLabel
        },
        evidence: evidence.map((item) => ({
          id: item.id,
          sourceType: item.sourceType,
          timestamp: item.timestamp,
          payload: item.payload
        }))
      })
    });
    if (!res.ok) throw new Error(`Archivist endpoint returned ${res.status}`);
    response = ArchivistResponseSchema.parse(await res.json());
  } catch (error) {
    response = localArchivistFallback({
      specimenName: growth.specimen.name,
      stageLabel: growthState.stageLabel,
      evidenceIds: evidence.map((item) => item.id),
      reason: error instanceof Error ? error.message : "invalid_model_response"
    });
  }
  const observation = toObservation({
    response,
    observationNumber: 1,
    timestamp: Date.now(),
    evidence
  });
  const specimenWithObservation = {
    ...growth.specimen,
    observations: [observation]
  };
  await params.repository.saveSpecimen(specimenWithObservation);
  await params.repository.appendEvent({
    id: `evt_${workflowId}_archival`,
    specimenId,
    timestamp: new Date(observation.timestamp).toISOString(),
    type: "archival_entry_created",
    schemaVersion: 2,
    evidenceIds: observation.evidenceIds ?? [],
    payload: {
      text: observation.text,
      observationNumber: observation.observationNumber,
      heuristicConfidence: null,
      generatedBy: observation.generatedBy === "gemini" ? "gemini" : "local_fallback",
      promptVersion: observation.promptVersion,
      model: observation.model
    }
  });
  workflow = await appendTrace(params.repository, trace({
    workflowId,
    specimenId,
    actor: "archivist",
    operation: "Archivist",
    status: observation.verificationStatus === "grounded" ? "succeeded" : "fallback",
    inputEvidenceIds: evidence.map((item) => item.id),
    outputEvidenceIds: observation.evidenceIds ?? [],
    durationMs: Math.round(performance.now() - archivistStarted),
    summary: observation.verificationStatus === "grounded" ? "Grounded observation written." : "Local fallback observation written.",
    fallbackReason: response.fallbackReason,
    promptVersion: ARCHIVIST_PROMPT_VERSION,
    model: observation.model
  }), workflow);

  const proposal = await createInterventionProposal({
    repo: params.repository,
    id: `pr_${workflowId}_export`,
    specimenId,
    action: "export_data",
    interventionParams: { action: "export_data", payload: {} },
    evidenceIds: [growth.evidence.id],
    reason: "Prepare a versioned export capsule only if the user explicitly approves it.",
    proposedBy: "system",
    createdAt: new Date().toISOString()
  });
  await params.repository.appendEvent({
    id: `evt_${workflowId}_proposal`,
    specimenId,
    timestamp: proposal.createdAt,
    type: "intervention_proposed",
    schemaVersion: 2,
    evidenceIds: proposal.evidenceIds,
    payload: {
      proposalId: proposal.id,
      action: proposal.action,
      parameters: proposal.params.payload,
      reason: proposal.reason,
      heuristicConfidence: proposal.heuristicConfidence,
      riskLevel: proposal.riskLevel
    }
  });
  workflow = await appendTrace(params.repository, trace({
    workflowId,
    specimenId,
    actor: "policy",
    operation: "Policy Check",
    status: "succeeded",
    inputEvidenceIds: proposal.evidenceIds,
    outputEvidenceIds: [],
    durationMs: 0,
    summary: "High-risk export proposal persisted pending human decision."
  }), workflow);

  workflow = {
    ...workflow,
    status: "completed",
    completedAt: new Date().toISOString(),
    stepsCompleted: ["signal_curator", "growth_simulator", "archivist", "policy"]
  };
  await params.repository.saveWorkflow(workflow);
  return { specimenId, workflowId };
}
