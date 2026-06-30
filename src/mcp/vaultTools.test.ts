import { describe, expect, it } from "vitest";
import { EvidenceRecord, Specimen } from "../domain";
import { InMemorySpecimenRepository } from "../infrastructure/persistence/inMemorySpecimenRepository";
import { SpecimenSchema } from "../shared/schemas";
import { createVaultTools, McpToolResult } from "./vaultTools";

const trustedToken = "trusted-token";

function specimen(overrides: Partial<Specimen> = {}): Specimen {
  return {
    id: "sp_mcp",
    name: "Umbilicaria contracta",
    seed: 101,
    birthTime: 1771112223000,
    breathDuration: 6,
    breathIntensity: 42,
    breathRhythm: "Symmetric Crystalline Cadence",
    branchDensity: 0.5,
    baseColor: "#2a3d30",
    accentColor: "#d97706",
    growthDirection: 0,
    glowIntensity: 0.4,
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
    id: "ev_mcp_growth",
    specimenId: "sp_mcp",
    sourceType: "growth_simulation",
    timestamp: "2026-06-30T00:00:00.000Z",
    payload: { seed: 101 },
    schemaVersion: 1,
    ...overrides
  };
}

async function seededRepo() {
  const repo = new InMemorySpecimenRepository();
  await repo.saveSpecimen(specimen());
  await repo.appendEvidence(evidence());
  return repo;
}

function trustedTools(repo: InMemorySpecimenRepository) {
  return createVaultTools(repo, {
    validateTrustedAction: (context) => context.approvalToken === trustedToken,
    now: () => new Date("2026-06-30T00:00:00.000Z")
  });
}

function resultData<T>(result: McpToolResult<unknown>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected MCP tool result to be ok.");
  return result.data as T;
}

describe("Vault MCP tool contracts", () => {
  it("list_specimens returns schema-valid data", async () => {
    const repo = await seededRepo();
    const result = await trustedTools(repo).list_specimens();
    const specimens = resultData<Specimen[]>(result);

    expect(specimens).toHaveLength(1);
    expect(SpecimenSchema.safeParse(specimens[0]).success).toBe(true);
  });

  it("get_specimen rejects unknown ID cleanly", async () => {
    const repo = await seededRepo();
    const result = await trustedTools(repo).get_specimen({ specimenId: "missing" });

    expect(result).toMatchObject({
      ok: false,
      error: { category: "not_found", code: "NOT_FOUND" }
    });
  });

  it("get_evidence returns a real evidence record", async () => {
    const repo = await seededRepo();
    const result = await trustedTools(repo).get_evidence({ evidenceId: "ev_mcp_growth" });
    const found = resultData<EvidenceRecord>(result);

    expect(found).toMatchObject({ id: "ev_mcp_growth", specimenId: "sp_mcp" });
  });

  it("append_observation rejects nonexistent evidence and emits a failed trace", async () => {
    const repo = await seededRepo();
    const tools = trustedTools(repo);
    const result = await tools.append_observation({
      specimenId: "sp_mcp",
      text: "A note with bad provenance.",
      evidenceIds: ["ev_missing"]
    });

    expect(result).toMatchObject({
      ok: false,
      error: { category: "policy" }
    });
    expect((await repo.getSpecimen("sp_mcp"))?.observations).toHaveLength(0);
    const traces = await repo.listTraces("sp_mcp");
    expect(traces.some((trace) => trace.operation === "MCP Append Observation" && trace.status === "failed")).toBe(true);
  });

  it("append_observation rejects invalid grounding before mutation", async () => {
    const repo = await seededRepo();
    const result = await trustedTools(repo).append_observation({
      specimenId: "sp_mcp",
      text: "Unsupported grounded claim.",
      evidenceIds: ["ev_mcp_growth"],
      verificationStatus: "grounded"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { category: "validation" }
    });
    expect((await repo.getSpecimen("sp_mcp"))?.observations).toHaveLength(0);
  });

  it("append_observation writes only fallback observations with resolving evidence", async () => {
    const repo = await seededRepo();
    const result = await trustedTools(repo).append_observation({
      specimenId: "sp_mcp",
      text: "A careful fallback note anchored to existing evidence.",
      evidenceIds: ["ev_mcp_growth"]
    });
    const observation = resultData<Specimen["observations"][number]>(result);

    expect(observation).toMatchObject({
      verificationStatus: "fallback",
      generatedBy: "local_fallback",
      evidenceIds: ["ev_mcp_growth"]
    });
    expect((await repo.getSpecimen("sp_mcp"))?.observations).toHaveLength(1);
  });

  it("propose_intervention creates a pending proposal only", async () => {
    const repo = await seededRepo();
    const result = await trustedTools(repo).propose_intervention({
      specimenId: "sp_mcp",
      action: "export_data",
      reason: "Prepare export for user review.",
      evidenceIds: ["ev_mcp_growth"]
    });
    const proposal = resultData<{ riskLevel: string; status: string; proposedBy: string }>(result);

    expect(proposal).toMatchObject({
      riskLevel: "high",
      status: "pending",
      proposedBy: "tool"
    });
    expect(await repo.listEvents("sp_mcp")).toHaveLength(0);
  });

  it("approve_intervention rejects untrusted context", async () => {
    const repo = await seededRepo();
    const tools = trustedTools(repo);
    const proposal = await tools.propose_intervention({
      specimenId: "sp_mcp",
      action: "export_data",
      reason: "Prepare export for user review.",
      evidenceIds: ["ev_mcp_growth"]
    });
    const proposed = resultData<{ id: string }>(proposal);

    const result = await tools.approve_intervention({
      proposalId: proposed.id,
      userId: "local",
      approvalToken: "wrong-token-value",
      actionNonce: "clicked"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { category: "policy" }
    });
  });

  it("approve_intervention is idempotent for the same decision", async () => {
    const repo = await seededRepo();
    const tools = trustedTools(repo);
    const proposal = await tools.propose_intervention({
      specimenId: "sp_mcp",
      action: "export_data",
      reason: "Prepare export for user review.",
      evidenceIds: ["ev_mcp_growth"]
    });
    const proposed = resultData<{ id: string }>(proposal);

    const first = await tools.approve_intervention({
      proposalId: proposed.id,
      userId: "local",
      approvalToken: trustedToken,
      actionNonce: "clicked"
    });
    const second = await tools.approve_intervention({
      proposalId: proposed.id,
      userId: "local",
      approvalToken: trustedToken,
      actionNonce: "clicked-again"
    });

    expect(first.ok).toBe(true);
    expect(resultData<{ changed: boolean }>(second).changed).toBe(false);
    expect(await repo.listEvents("sp_mcp", { types: ["intervention_approved"] })).toHaveLength(1);
  });

  it("reject_intervention is idempotent for the same decision", async () => {
    const repo = await seededRepo();
    const tools = trustedTools(repo);
    const proposal = await tools.propose_intervention({
      specimenId: "sp_mcp",
      action: "adjust_light",
      reason: "Dim light for review.",
      evidenceIds: ["ev_mcp_growth"]
    });
    const proposed = resultData<{ id: string }>(proposal);

    const first = await tools.reject_intervention({
      proposalId: proposed.id,
      userId: "local",
      approvalToken: trustedToken,
      actionNonce: "reject-clicked"
    });
    const second = await tools.reject_intervention({
      proposalId: proposed.id,
      userId: "local",
      approvalToken: trustedToken,
      actionNonce: "reject-clicked-again"
    });

    expect(first.ok).toBe(true);
    expect(resultData<{ changed: boolean }>(second).changed).toBe(false);
    expect(await repo.listEvents("sp_mcp", { types: ["intervention_rejected"] })).toHaveLength(1);
  });

  it("already-decided proposal cannot change decision", async () => {
    const repo = await seededRepo();
    const tools = trustedTools(repo);
    const proposal = await tools.propose_intervention({
      specimenId: "sp_mcp",
      action: "export_data",
      reason: "Prepare export for user review.",
      evidenceIds: ["ev_mcp_growth"]
    });
    const proposed = resultData<{ id: string }>(proposal);
    await tools.approve_intervention({
      proposalId: proposed.id,
      userId: "local",
      approvalToken: trustedToken,
      actionNonce: "approve"
    });

    const rejected = await tools.reject_intervention({
      proposalId: proposed.id,
      userId: "local",
      approvalToken: trustedToken,
      actionNonce: "reject"
    });

    expect(rejected).toMatchObject({
      ok: false,
      error: { category: "policy" }
    });
    expect((await repo.getProposal(proposed.id))?.status).toBe("approved");
  });

  it("direct delete tool is absent", () => {
    const tools = trustedTools(new InMemorySpecimenRepository());
    expect(Object.keys(tools)).not.toContain("delete_specimen");
  });

  it("export excludes secrets and raw audio", async () => {
    const repo = new InMemorySpecimenRepository();
    await repo.saveSpecimen(specimen());
    await repo.appendEvidence(evidence({
      payload: {
        seed: 101,
        rawAudio: "SECRET_AUDIO",
        nested: { apiKey: "SECRET_KEY", retained: "ok" }
      }
    }));
    const result = await trustedTools(repo).export_specimen({
      specimenId: "sp_mcp",
      userId: "local",
      approvalToken: trustedToken,
      actionNonce: "export-clicked"
    });
    const exported = resultData<{ schemaVersion: 1; specimen: { id: string }; evidence: Array<{ payload: { nested: { retained: string } } }> }>(result);

    expect(JSON.stringify(result)).not.toContain("SECRET_AUDIO");
    expect(JSON.stringify(result)).not.toContain("SECRET_KEY");
    expect(exported).toMatchObject({ schemaVersion: 1, specimen: { id: "sp_mcp" } });
    expect(exported.evidence[0].payload.nested.retained).toBe("ok");
  });

  it("invalid tool input is rejected before repository mutation", async () => {
    const repo = await seededRepo();
    const result = await trustedTools(repo).propose_intervention({
      specimenId: "sp_mcp",
      action: "export_data",
      evidenceIds: ["ev_mcp_growth"]
    });

    expect(result).toMatchObject({
      ok: false,
      error: { category: "validation" }
    });
    expect(await repo.listProposals("sp_mcp")).toHaveLength(0);
  });

  it("MCP cannot bypass policy through alternate parameters", async () => {
    const repo = await seededRepo();
    const tools = trustedTools(repo);
    const proposal = await tools.propose_intervention({
      specimenId: "sp_mcp",
      action: "export_data",
      reason: "Prepare export for user review.",
      evidenceIds: ["ev_mcp_growth"]
    });
    const proposed = resultData<{ id: string }>(proposal);

    const result = await tools.approve_intervention({
      proposalId: proposed.id,
      userId: "local",
      trustedUserAction: true,
      actionNonce: "fake"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { category: "validation" }
    });
    expect((await repo.getProposal(proposed.id))?.status).toBe("pending");
  });

  it("get_workflow_traces returns tool traces", async () => {
    const repo = await seededRepo();
    const tools = trustedTools(repo);
    await tools.append_observation({
      specimenId: "sp_mcp",
      text: "A careful fallback note anchored to existing evidence.",
      evidenceIds: ["ev_mcp_growth"]
    });

    const result = await tools.get_workflow_traces({ specimenId: "sp_mcp" });
    const traces = resultData<Array<{ operation: string }>>(result);

    expect(traces.some((trace) => trace.operation === "MCP Append Observation")).toBe(true);
  });
});
