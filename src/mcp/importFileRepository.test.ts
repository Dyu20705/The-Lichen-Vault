import fs from "fs/promises";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileSpecimenRepository } from "../infrastructure/persistence/jsonFileSpecimenRepository";
import { createVaultTools, McpToolResult } from "./vaultTools";
import { importVaultExport } from "./importExport";

const tmpRoots: string[] = [];

async function tempPath(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.cwd(), ".tmp-mcp-"));
  tmpRoots.push(root);
  return path.join(root, name);
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function resultData<T>(result: McpToolResult<unknown>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected MCP tool result to be ok.");
  return result.data as T;
}

function browserExport() {
  return {
    schemaVersion: 1,
    exportedAt: "2026-06-30T00:00:00.000Z",
    exportManifest: {
      format: "lichen-vault.ui-export",
      included: ["specimen profile", "event log", "structured evidence", "workflow traces", "intervention proposals and decisions"],
      excluded: ["raw audio", "API keys", "approval tokens", "secrets", "raw model prompts"],
      generatedBy: "trusted-ui"
    },
    specimen: {
      id: "sp_imported",
      name: "Umbilicaria importata",
      seed: 20705,
      birthTime: 1771112223000,
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
        id: "obs_imported",
        timestamp: 1771112223000,
        observationNumber: 1,
        text: "A fictional digital specimen is grounded by imported evidence.",
        evidenceIds: ["ev_imported_growth"],
        confidence: null,
        generatedBy: "gemini",
        verificationStatus: "grounded",
        promptVersion: "archivist.v1",
        model: "fake-adk-model"
      }],
      memories: [],
      schemaVersion: 2,
      eventIds: ["evt_imported_growth"]
    },
    events: [{
      id: "evt_imported_growth",
      specimenId: "sp_imported",
      timestamp: "2026-06-30T00:00:00.000Z",
      type: "growth_simulated",
      schemaVersion: 2,
      evidenceIds: ["ev_imported_growth"],
      payload: { seed: 20705, rawAudio: "SHOULD_BE_SCRUBBED" }
    }],
    evidence: [{
      id: "ev_imported_growth",
      specimenId: "sp_imported",
      sourceType: "growth_simulation",
      sourceEventId: "evt_imported_growth",
      timestamp: "2026-06-30T00:00:00.000Z",
      payload: { seed: 20705, nested: { apiKey: "SHOULD_BE_SCRUBBED", retained: "ok" } },
      schemaVersion: 1
    }],
    workflows: [{
      id: "wf_imported",
      specimenId: "sp_imported",
      status: "completed",
      startedAt: "2026-06-30T00:00:00.000Z",
      completedAt: "2026-06-30T00:00:01.000Z",
      stepsCompleted: ["growth_simulator"],
      errors: [],
      traceIds: ["tr_imported_growth"]
    }],
    traces: [{
      id: "tr_imported_growth",
      workflowId: "wf_imported",
      specimenId: "sp_imported",
      timestamp: "2026-06-30T00:00:00.000Z",
      actor: "system",
      operation: "Growth Simulator",
      status: "succeeded",
      inputEvidenceIds: [],
      outputEvidenceIds: ["ev_imported_growth"],
      durationMs: 0,
      summary: "Imported deterministic growth trace."
    }],
    proposals: [{
      id: "pr_imported_export",
      specimenId: "sp_imported",
      action: "export_data",
      params: { action: "export_data", payload: {} },
      evidenceIds: ["ev_imported_growth"],
      reason: "Prepare export only after explicit user confirmation.",
      heuristicConfidence: 0.63,
      proposedBy: "system",
      riskLevel: "high",
      status: "pending",
      createdAt: "2026-06-30T00:00:01.000Z"
    }]
  };
}

describe("MCP JSON file repository import bridge", () => {
  it("persists all repository surfaces and rejects corrupt JSON without deleting it", async () => {
    const vaultPath = await tempPath("vault.json");
    const repo = new JsonFileSpecimenRepository(vaultPath);
    const exportPath = await tempPath("export.json");
    await fs.writeFile(exportPath, JSON.stringify(browserExport()), "utf8");

    await importVaultExport({ exportPath, repository: repo });

    expect(await repo.getSpecimen("sp_imported")).toMatchObject({ id: "sp_imported" });
    expect(await repo.listEvents("sp_imported")).toHaveLength(1);
    expect(await repo.listEvidence("sp_imported")).toHaveLength(1);
    expect(await repo.listWorkflows("sp_imported")).toHaveLength(1);
    expect(await repo.listTraces("sp_imported")).toHaveLength(1);
    expect(await repo.listProposals("sp_imported")).toHaveLength(1);
    expect(await fs.readFile(vaultPath, "utf8")).not.toContain("SHOULD_BE_SCRUBBED");

    await fs.writeFile(vaultPath, "{bad-json", "utf8");
    await expect(repo.listSpecimens()).rejects.toThrow("corrupt or unsupported");
    expect(await fs.readFile(vaultPath, "utf8")).toBe("{bad-json");
  });

  it("repeated import is idempotent and MCP tools read imported data", async () => {
    const repo = new JsonFileSpecimenRepository(await tempPath("vault.json"));
    const exportPath = await tempPath("export.json");
    await fs.writeFile(exportPath, JSON.stringify(browserExport()), "utf8");

    await importVaultExport({ exportPath, repository: repo });
    await importVaultExport({ exportPath, repository: repo });

    const tools = createVaultTools(repo, { now: () => new Date("2026-06-30T00:00:02.000Z") });
    expect(resultData<Array<{ id: string }>>(await tools.list_specimens())).toHaveLength(1);
    expect(resultData<{ id: string }>(await tools.get_specimen({ specimenId: "sp_imported" })).id).toBe("sp_imported");
    expect(resultData<Array<{ id: string }>>(await tools.get_workflow_traces({ specimenId: "sp_imported" }))).toHaveLength(1);
  });

  it("approval and export cannot bypass the trusted-action boundary and failures persist as traces", async () => {
    const repo = new JsonFileSpecimenRepository(await tempPath("vault.json"));
    const exportPath = await tempPath("export.json");
    await fs.writeFile(exportPath, JSON.stringify(browserExport()), "utf8");
    await importVaultExport({ exportPath, repository: repo });
    const tools = createVaultTools(repo, { now: () => new Date("2026-06-30T00:00:02.000Z") });

    const approval = await tools.approve_intervention({
      proposalId: "pr_imported_export",
      userId: "local",
      approvalToken: "untrusted-token",
      actionNonce: "clicked"
    });
    const exported = await tools.export_specimen({
      specimenId: "sp_imported",
      userId: "local",
      approvalToken: "untrusted-token",
      actionNonce: "export"
    });

    expect(approval).toMatchObject({ ok: false, error: { category: "policy" } });
    expect(exported).toMatchObject({ ok: false, error: { category: "policy" } });
    expect((await repo.getProposal("pr_imported_export"))?.status).toBe("pending");
    const traces = await repo.listTraces("sp_imported");
    expect(traces.some((trace) => trace.operation === "MCP Approve Intervention" && trace.status === "failed")).toBe(true);
    expect(traces.some((trace) => trace.operation === "MCP Export Specimen" && trace.status === "failed")).toBe(true);
    expect(JSON.stringify(traces)).not.toContain("untrusted-token");
  });
});
