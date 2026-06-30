import { JsonFileSpecimenRepository } from "../infrastructure/persistence/jsonFileSpecimenRepository";
import { resolveMcpVaultPath } from "./config";

const dataPath = resolveMcpVaultPath();
const repo = new JsonFileSpecimenRepository(dataPath);
const specimenId = "lichen_demo_mcp_001";
const workflowId = "wf_demo_mcp_seed";
const timestamp = "2026-06-30T00:00:00.000Z";

await repo.appendEvidence({
  id: "ev_demo_mcp_breath",
  specimenId,
  sourceType: "breath_capture",
  timestamp,
  payload: {
    captureMode: "simulated",
    breathCount: 3,
    totalDuration: 7.2,
    averageIntensity: 48,
    cadence: "even"
  },
  schemaVersion: 1
});

await repo.appendEvidence({
  id: "ev_demo_mcp_growth",
  specimenId,
  sourceType: "growth_simulation",
  sourceEventId: "evt_demo_mcp_growth",
  timestamp,
  payload: {
    algorithmVersion: "growth-simulator.v1",
    seed: 20705,
    structure: "Foliose",
    deterministic: true
  },
  schemaVersion: 1
});

await repo.saveSpecimen({
  id: specimenId,
  name: "Umbilicaria demonstrata",
  seed: 20705,
  birthTime: Date.parse(timestamp),
  breathDuration: 7.2,
  breathIntensity: 48,
  breathRhythm: "Even Demonstration Cadence",
  branchDensity: 0.58,
  baseColor: "#3f5f45",
  accentColor: "#d9a441",
  growthDirection: 0.25,
  glowIntensity: 0.45,
  structure: "Foliose",
  crystalsCount: 2,
  fungalBlooms: 1,
  colorMutationOffset: 0,
  observations: [{
    id: "obs_demo_mcp_fallback",
    timestamp: Date.parse(timestamp),
    observationNumber: 1,
    text: "A fictional digital foliose specimen is catalogued from deterministic breath metrics and growth evidence.",
    evidenceIds: ["ev_demo_mcp_breath", "ev_demo_mcp_growth"],
    confidence: null,
    generatedBy: "local_fallback",
    verificationStatus: "fallback",
    promptVersion: "archivist.v1",
    model: "local-fallback"
  }],
  memories: [],
  schemaVersion: 2,
  eventIds: ["evt_demo_mcp_growth"]
});

await repo.appendEvent({
  id: "evt_demo_mcp_growth",
  specimenId,
  timestamp,
  type: "growth_simulated",
  schemaVersion: 2,
  evidenceIds: ["ev_demo_mcp_growth"],
  payload: {
    previousStage: "digital deposition",
    nextStage: "Foliose",
    growthDelta: 1,
    mutations: [],
    environmentalResponses: [],
    seed: 20705,
    evidenceFactors: ["ev_demo_mcp_breath"]
  }
});

await repo.saveWorkflow({
  id: workflowId,
  specimenId,
  status: "completed",
  startedAt: timestamp,
  completedAt: "2026-06-30T00:00:02.000Z",
  stepsCompleted: ["signal_curator", "growth_simulator", "archivist", "policy"],
  errors: [],
  traceIds: ["tr_demo_mcp_seed_policy"]
});

await repo.appendTrace({
  id: "tr_demo_mcp_seed_policy",
  workflowId,
  specimenId,
  timestamp: "2026-06-30T00:00:02.000Z",
  actor: "policy",
  operation: "Policy Check",
  status: "succeeded",
  inputEvidenceIds: ["ev_demo_mcp_growth"],
  outputEvidenceIds: [],
  durationMs: 0,
  summary: "Seed command persisted a pending high-risk export proposal without granting approval."
});

await repo.saveProposal({
  id: "pr_demo_mcp_export",
  specimenId,
  action: "export_data",
  params: { action: "export_data", payload: {} },
  evidenceIds: ["ev_demo_mcp_growth"],
  reason: "Demonstrate that MCP export remains pending until a trusted user confirmation is injected.",
  heuristicConfidence: 0.63,
  proposedBy: "system",
  riskLevel: "high",
  status: "pending",
  createdAt: "2026-06-30T00:00:02.000Z"
});

console.log(JSON.stringify({ ok: true, dataPath, specimenId, proposalId: "pr_demo_mcp_export" }, null, 2));
