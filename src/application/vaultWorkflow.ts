import { BreathRecording } from "../types";
import { SpecimenEvent, TraceEvent, WorkflowSession } from "../domain";
import { SpecimenRepository } from "../infrastructure/persistence/specimenRepository";
import { calculateGrowthState } from "../utils/generator";
import { ARCHIVIST_PROMPT_VERSION, ArchivistResponse, ArchivistResponseSchema, localArchivistFallback, toObservation } from "./archivist";
import { GROWTH_ALGORITHM_VERSION, simulateGrowth } from "./growthSimulator";
import { createInterventionProposal } from "./policy";
import { curateSignal } from "./signalCurator";

export interface WorkflowResult {
  specimenId: string;
  workflowId: string;
}

export interface ArchivistAdapterInput {
  workflowId: string;
  specimen: {
    id: string;
    name: string;
    structure: string;
    stageLabel: string;
  };
  evidence: Array<{
    id: string;
    sourceType: string;
    timestamp: string;
    payload: Record<string, unknown>;
  }>;
}

export type ArchivistAdapter = (input: ArchivistAdapterInput, signal: AbortSignal) => Promise<ArchivistResponse>;

const DEFAULT_ARCHIVIST_TIMEOUT_MS = 8000;

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

async function completeStep(repo: SpecimenRepository, workflow: WorkflowSession, step: string): Promise<WorkflowSession> {
  const next = {
    ...workflow,
    stepsCompleted: workflow.stepsCompleted.includes(step) ? workflow.stepsCompleted : [...workflow.stepsCompleted, step]
  };
  await repo.saveWorkflow(next);
  return next;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classifyError(error: unknown): TraceEvent["errorCategory"] {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("storage")) return "storage";
  if (message.includes("policy") || message.includes("evidence")) return "policy";
  if (message.includes("model") || message.includes("archivist") || message.includes("fetch") || message.includes("timeout")) return "model";
  if (message.includes("validation") || message.includes("requires exactly three breaths")) return "validation";
  return "unknown";
}

async function withAdapterTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("archivist_timeout"));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export const fetchArchivistObservation: ArchivistAdapter = async (input, signal) => {
  const res = await fetch("/api/archivist/observe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error(`Archivist endpoint returned ${res.status}`);
  return ArchivistResponseSchema.parse(await res.json());
};

export async function runBreathWorkflow(params: {
  recordings: BreathRecording[];
  repository: SpecimenRepository;
  captureMode?: "microphone" | "simulated";
  workflowId?: string;
  startedAt?: Date;
  archivistAdapter?: ArchivistAdapter;
  archivistTimeoutMs?: number;
}): Promise<WorkflowResult> {
  const started = params.startedAt?.getTime() ?? Date.now();
  const timestamp = new Date(started).toISOString();
  const workflowId = params.workflowId ?? nowId("wf", started);
  const specimenId = `lichen_${workflowId}`;
  let currentOperation = "Workflow";
  let currentActor: TraceEvent["actor"] = "system";
  let currentStarted = performance.now();
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

  try {
    currentOperation = "Signal Curator";
    currentActor = "curator";
    currentStarted = performance.now();
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
      durationMs: Math.round(performance.now() - currentStarted),
      summary: "Breath metrics validated and normalized."
    }), workflow);
    workflow = await completeStep(params.repository, workflow, "signal_curator");

    currentOperation = "Growth Simulator";
    currentActor = "system";
    currentStarted = performance.now();
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
      durationMs: Math.round(performance.now() - currentStarted),
      summary: `Deterministic ${GROWTH_ALGORITHM_VERSION} growth produced seed ${growth.specimen.seed}.`
    }), workflow);
    workflow = await completeStep(params.repository, workflow, "growth_simulator");

    currentOperation = "Archivist";
    currentActor = "archivist";
    currentStarted = performance.now();
    const evidence = await params.repository.listEvidence(specimenId);
    const growthState = calculateGrowthState(growth.specimen.birthTime);
    const adapterInput: ArchivistAdapterInput = {
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
    };
    let response = localArchivistFallback({
      specimenName: growth.specimen.name,
      stageLabel: growthState.stageLabel,
      evidenceIds: evidence.map((item) => item.id),
      reason: "model_not_called"
    });
    try {
      response = await withAdapterTimeout(
        (signal) => (params.archivistAdapter ?? fetchArchivistObservation)(adapterInput, signal),
        params.archivistTimeoutMs ?? DEFAULT_ARCHIVIST_TIMEOUT_MS
      );
    } catch (error) {
      response = localArchivistFallback({
        specimenName: growth.specimen.name,
        stageLabel: growthState.stageLabel,
        evidenceIds: evidence.map((item) => item.id),
        reason: errorMessage(error)
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
      durationMs: Math.round(performance.now() - currentStarted),
      summary: observation.verificationStatus === "grounded" ? "Grounded observation written." : "Local fallback observation written.",
      fallbackReason: response.fallbackReason,
      promptVersion: ARCHIVIST_PROMPT_VERSION,
      model: observation.model
    }), workflow);
    workflow = await completeStep(params.repository, workflow, "archivist");

    currentOperation = "Policy Check";
    currentActor = "policy";
    currentStarted = performance.now();
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
      durationMs: Math.round(performance.now() - currentStarted),
      summary: "High-risk export proposal persisted pending human decision."
    }), workflow);
    workflow = await completeStep(params.repository, workflow, "policy");

    workflow = {
      ...workflow,
      status: "completed",
      completedAt: new Date().toISOString()
    };
    await params.repository.saveWorkflow(workflow);
    return { specimenId, workflowId };
  } catch (error) {
    const reason = errorMessage(error);
    const failedTrace = trace({
      workflowId,
      specimenId,
      actor: currentActor,
      operation: currentOperation,
      status: "failed",
      inputEvidenceIds: [],
      outputEvidenceIds: [],
      durationMs: Math.round(performance.now() - currentStarted),
      summary: `${currentOperation} failed.`,
      errorCode: reason,
      errorCategory: classifyError(error)
    });
    workflow = await appendTrace(params.repository, failedTrace, workflow);
    workflow = {
      ...workflow,
      status: "failed",
      completedAt: new Date().toISOString(),
      errors: workflow.errors.includes(reason) ? workflow.errors : [...workflow.errors, reason]
    };
    await params.repository.saveWorkflow(workflow);
    throw error;
  }
}
