import { describe, expect, it } from "vitest";
import { InMemorySpecimenRepository } from "../infrastructure/persistence/inMemorySpecimenRepository";
import { createVaultTools } from "./vaultTools";

function specimen() {
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
    structure: "Foliose" as const,
    crystalsCount: 0,
    fungalBlooms: 0,
    colorMutationOffset: 0,
    observations: [],
    memories: [],
    schemaVersion: 2,
    eventIds: []
  };
}

describe("Vault MCP tool contracts", () => {
  it("validates observation evidence references before writing", async () => {
    const repo = new InMemorySpecimenRepository();
    const tools = createVaultTools(repo);
    await repo.saveSpecimen(specimen());

    await expect(tools.append_observation({
      specimenId: "sp_mcp",
      text: "A note with bad provenance.",
      evidenceIds: ["ev_missing"]
    })).rejects.toThrow("Missing evidence");

    expect((await repo.getSpecimen("sp_mcp"))?.observations).toHaveLength(0);
  });

  it("proposes high-risk work without executing it and requires trusted approval context", async () => {
    const repo = new InMemorySpecimenRepository();
    const tools = createVaultTools(repo);
    await repo.saveSpecimen(specimen());
    await repo.appendEvidence({
      id: "ev_mcp_growth",
      specimenId: "sp_mcp",
      sourceType: "growth_simulation",
      timestamp: "2026-06-30T00:00:00.000Z",
      payload: { seed: 101 },
      schemaVersion: 1
    });

    const proposal = await tools.propose_intervention({
      specimenId: "sp_mcp",
      action: "export_data",
      reason: "Prepare export for user review.",
      evidenceIds: ["ev_mcp_growth"]
    });

    expect(proposal.riskLevel).toBe("high");
    expect(proposal.status).toBe("pending");
    await expect(tools.approve_intervention({
      proposalId: proposal.id,
      userId: "local",
      trustedUserAction: false as true,
      actionNonce: "bad"
    })).rejects.toThrow();

    const approved = await tools.approve_intervention({
      proposalId: proposal.id,
      userId: "local",
      trustedUserAction: true,
      actionNonce: "clicked"
    });
    expect(approved.proposal.status).toBe("approved");
    expect(await repo.listEvents("sp_mcp", { types: ["intervention_approved"] })).toHaveLength(1);
  });

  it("does not expose a direct delete tool", () => {
    const tools = createVaultTools(new InMemorySpecimenRepository());
    expect(Object.keys(tools)).not.toContain("delete_specimen");
  });
});
