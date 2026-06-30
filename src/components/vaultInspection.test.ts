import { describe, expect, it } from "vitest";
import { createInterventionProposal, decideProposal } from "../application/policy";
import { curateSignal } from "../application/signalCurator";
import { EvidenceRecord, InterventionProposal, Specimen, TraceEvent } from "../domain";
import { InMemorySpecimenRepository } from "../infrastructure/persistence/inMemorySpecimenRepository";
import { SeededRandom } from "../utils/generator";
import {
  createVaultUiExportPayload,
  groupTracesByWorkflow,
  inspectEvidenceReference,
  proposalDisplayState,
  scrubInspectableValue,
  traceStatusLabel
} from "./vaultInspection";

const now = "2026-06-30T00:00:00.000Z";

function specimen(overrides: Partial<Specimen> = {}): Specimen {
  return {
    id: "sp_ui",
    name: "Umbilicaria auditii",
    seed: 42,
    birthTime: 1771112223000,
    breathDuration: 12,
    breathIntensity: 55,
    breathRhythm: "Symmetric Crystalline Cadence",
    branchDensity: 0.5,
    baseColor: "#2a3d30",
    accentColor: "#ffbf00",
    growthDirection: 0,
    glowIntensity: 0.6,
    structure: "Foliose",
    crystalsCount: 0,
    fungalBlooms: 0,
    colorMutationOffset: 0,
    observations: [],
    memories: [],
    schemaVersion: 2,
    eventIds: [],
    ...overrides
  };
}

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "ev_ui_signal",
    specimenId: "sp_ui",
    sourceType: "signal_analysis",
    sourceEventId: "evt_signal",
    timestamp: now,
    payload: { signalQuality: 0.83, nested: { retained: "ok" } },
    schemaVersion: 1,
    ...overrides
  };
}

function trace(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    id: "tr_ui_signal",
    workflowId: "wf_ui",
    specimenId: "sp_ui",
    timestamp: now,
    actor: "system",
    operation: "Signal curation",
    status: "succeeded",
    inputEvidenceIds: [],
    outputEvidenceIds: ["ev_ui_signal"],
    durationMs: 12,
    summary: "Signal evidence persisted.",
    ...overrides
  };
}

function proposal(overrides: Partial<InterventionProposal> = {}): InterventionProposal {
  return {
    id: "pr_ui_export",
    specimenId: "sp_ui",
    action: "export_data",
    params: { action: "export_data", payload: {} },
    evidenceIds: ["ev_ui_signal"],
    reason: "Prepare a review export for the custodian.",
    heuristicConfidence: 0.63,
    proposedBy: "archivist",
    riskLevel: "high",
    status: "pending",
    createdAt: now,
    ...overrides
  };
}

async function repoWithProposal(id = "pr_ui_export") {
  const repo = new InMemorySpecimenRepository();
  await repo.saveSpecimen(specimen());
  await repo.appendEvidence(evidence());
  await createInterventionProposal({
    repo,
    id,
    specimenId: "sp_ui",
    action: "export_data",
    interventionParams: { action: "export_data", payload: {} },
    evidenceIds: ["ev_ui_signal"],
    reason: "Prepare a review export for the custodian.",
    proposedBy: "archivist",
    createdAt: now
  });
  return repo;
}

describe("Vault inspection UI contracts", () => {
  it("represents the trace panel empty state", () => {
    expect(groupTracesByWorkflow([])).toEqual([]);
  });

  it("represents a successful trace state", () => {
    const item = trace();
    expect(traceStatusLabel(item)).toBe("Succeeded");
    expect(groupTracesByWorkflow([item])[0].traces).toEqual([item]);
  });

  it("represents a fallback trace state", () => {
    expect(traceStatusLabel(trace({ status: "fallback", fallbackReason: "local_archivist" }))).toBe("Fallback path");
  });

  it("represents a failed trace state", () => {
    expect(traceStatusLabel(trace({ status: "failed", errorCode: "MODEL_TIMEOUT" }))).toBe("Failed");
  });

  it("resolves valid evidence with grounding relationships", () => {
    const inspection = inspectEvidenceReference([evidence()], "ev_ui_signal", [trace()], [proposal()]);
    expect(inspection.found).toBe(true);
    expect(inspection.relatedWorkflowIds).toEqual(["wf_ui"]);
    expect(inspection.relatedProposalIds).toEqual(["pr_ui_export"]);
    expect(inspection.groundingLabel).toBe("Grounds an intervention proposal");
  });

  it("handles missing evidence references", () => {
    const inspection = inspectEvidenceReference([], "ev_missing", [trace({ inputEvidenceIds: ["ev_missing"], outputEvidenceIds: [] })]);
    expect(inspection.found).toBe(false);
    expect(inspection.groundingLabel).toBe("Missing evidence reference");
  });

  it("renders pending proposal lifecycle state", () => {
    expect(proposalDisplayState(proposal())).toMatchObject({
      statusLabel: "Pending human decision",
      executionLabel: "Not executed",
      readOnly: false
    });
  });

  it("allows approve through the trusted user decision path", async () => {
    const repo = await repoWithProposal("pr_ui_approve");
    const result = await decideProposal({
      repo,
      proposalId: "pr_ui_approve",
      decision: "approved",
      context: { actor: "user", userId: "local_custodian", actionNonce: "approve-click" },
      decidedAt: "2026-06-30T00:00:01.000Z"
    });
    expect(result.changed).toBe(true);
    expect(result.proposal.decision?.decidedBy).toBe("local_custodian");
  });

  it("allows reject through the trusted user decision path", async () => {
    const repo = await repoWithProposal("pr_ui_reject");
    const result = await decideProposal({
      repo,
      proposalId: "pr_ui_reject",
      decision: "rejected",
      context: { actor: "user", userId: "local_custodian", actionNonce: "reject-click" },
      decidedAt: "2026-06-30T00:00:01.000Z"
    });
    expect(result.changed).toBe(true);
    expect(result.proposal.status).toBe("rejected");
  });

  it("rejects agent-manufactured approval context", async () => {
    const repo = await repoWithProposal("pr_ui_agent");
    await expect(decideProposal({
      repo,
      proposalId: "pr_ui_agent",
      decision: "approved",
      context: { actor: "agent", userId: "local_custodian", actionNonce: "fake-click" },
      decidedAt: "2026-06-30T00:00:01.000Z"
    })).rejects.toThrow("trusted user action context");
  });

  it("keeps double-click approval idempotent", async () => {
    const repo = await repoWithProposal("pr_ui_double");
    const context = { actor: "user" as const, userId: "local_custodian", actionNonce: "same-click" };
    const first = await decideProposal({ repo, proposalId: "pr_ui_double", decision: "approved", context, decidedAt: "2026-06-30T00:00:01.000Z" });
    const second = await decideProposal({ repo, proposalId: "pr_ui_double", decision: "approved", context, decidedAt: "2026-06-30T00:00:02.000Z" });
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect((await repo.listEvents("sp_ui")).filter((event) => event.type === "intervention_approved")).toHaveLength(1);
  });

  it("marks already-approved proposals read-only", () => {
    const state = proposalDisplayState(proposal({
      status: "approved",
      decision: { decidedAt: now, decidedBy: "local_custodian" }
    }));
    expect(state).toMatchObject({
      readOnly: true,
      controlsDisabled: true,
      executionLabel: "Action pending separate execution",
      canExport: true
    });
  });

  it("marks already-rejected proposals read-only", () => {
    const state = proposalDisplayState(proposal({
      status: "rejected",
      decision: { decidedAt: now, decidedBy: "local_custodian" }
    }));
    expect(state).toMatchObject({
      readOnly: true,
      controlsDisabled: true,
      executionLabel: "Proposal closed without execution"
    });
  });

  it("does not represent high-risk approval as executed", () => {
    const state = proposalDisplayState(proposal({
      status: "approved",
      decision: { decidedAt: now, decidedBy: "local_custodian" }
    }));
    expect(state.executionLabel).toBe("Action pending separate execution");
  });

  it("reloads proposal state from persistence after refresh", async () => {
    const repo = await repoWithProposal("pr_ui_refresh");
    await decideProposal({
      repo,
      proposalId: "pr_ui_refresh",
      decision: "approved",
      context: { actor: "user", userId: "local_custodian", actionNonce: "refresh-click" },
      decidedAt: "2026-06-30T00:00:01.000Z"
    });
    const [reloaded] = await repo.listProposals("sp_ui");
    expect(reloaded.status).toBe("approved");
    expect(proposalDisplayState(reloaded).readOnly).toBe(true);
  });

  it("does not render secret or raw audio fields in inspection output", () => {
    const scrubbed = scrubInspectableValue({
      retained: "ok",
      rawAudio: "SECRET_AUDIO",
      nested: { apiKey: "SECRET_KEY", token: "SECRET_TOKEN", visible: true },
      prompt: "do not render this"
    });
    const rendered = JSON.stringify(scrubbed);
    expect(rendered).toContain("ok");
    expect(rendered).toContain("visible");
    expect(rendered).not.toContain("SECRET_AUDIO");
    expect(rendered).not.toContain("SECRET_KEY");
    expect(rendered).not.toContain("SECRET_TOKEN");
    expect(rendered).not.toContain("do not render this");
  });

  it("creates a validated versioned export without secret or raw audio fields", () => {
    const payload = createVaultUiExportPayload({
      specimen: specimen(),
      events: [],
      evidence: [evidence({ payload: { rawAudio: "SECRET_AUDIO", nested: { apiKey: "SECRET_KEY", retained: "ok" } } })],
      traces: [trace()],
      proposals: [proposal()],
      exportedAt: now
    });
    const rendered = JSON.stringify(payload);
    const nested = payload.evidence[0].payload.nested as { retained: string };
    expect(payload.schemaVersion).toBe(1);
    expect(payload.exportManifest.excluded).toContain("raw audio");
    expect(nested.retained).toBe("ok");
    expect(rendered).not.toContain("SECRET_AUDIO");
    expect(rendered).not.toContain("SECRET_KEY");
  });

  it("keeps the three-breath ritual contract alive", () => {
    const curated = curateSignal({
      specimenId: "sp_ui",
      workflowId: "wf_ritual",
      captureMode: "simulated",
      now: new Date(now),
      recordings: [
        { duration: 3.2, intensity: 42, pikes: 1 },
        { duration: 3.4, intensity: 46, pikes: 2 },
        { duration: 3.1, intensity: 44, pikes: 1 }
      ]
    });
    expect(curated.evidence.map((item) => item.sourceType)).toEqual(["breath_capture", "signal_analysis"]);
  });

  it("keeps seeded renderer inputs deterministic", () => {
    const first = new SeededRandom(808).next();
    const second = new SeededRandom(808).next();
    expect(first).toBe(second);
  });
});
