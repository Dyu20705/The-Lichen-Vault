import fs from "fs/promises";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceRecord } from "../domain";
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

  it("rejects late trace failures without persisting earlier import records", async () => {
    const vaultPath = await tempPath("vault.json");
    const repo = new JsonFileSpecimenRepository(vaultPath);
    const exportPath = await tempPath("export.json");
    await fs.writeFile(exportPath, JSON.stringify(browserExport()), "utf8");
    await importVaultExport({ exportPath, repository: repo });
    const originalBytes = await fs.readFile(vaultPath, "utf8");

    const broken = browserExport();
    broken.specimen.id = "sp_late_trace_failure";
    broken.specimen.observations = [];
    broken.specimen.eventIds = [];
    broken.evidence = [];
    broken.events = [];
    broken.workflows = [];
    broken.traces = [{
      id: "tr_late_missing_evidence",
      workflowId: "wf_late_trace_failure",
      specimenId: "sp_late_trace_failure",
      timestamp: "2026-06-30T00:00:03.000Z",
      actor: "tool",
      operation: "MCP Import Trace",
      status: "failed",
      inputEvidenceIds: ["ev_missing_late"],
      outputEvidenceIds: [],
      durationMs: 0,
      summary: "This trace should make the atomic import fail."
    }];
    broken.proposals = [];
    const brokenPath = await tempPath("broken-trace-export.json");
    await fs.writeFile(brokenPath, JSON.stringify(broken), "utf8");

    await expect(importVaultExport({ exportPath: brokenPath, repository: repo })).rejects.toThrow("missing evidence");
    expect(await fs.readFile(vaultPath, "utf8")).toBe(originalBytes);
    expect(await repo.getSpecimen("sp_late_trace_failure")).toBeNull();
  });

  it("rejects late proposal failures without changing the original vault bytes", async () => {
    const vaultPath = await tempPath("vault.json");
    const repo = new JsonFileSpecimenRepository(vaultPath);
    const exportPath = await tempPath("export.json");
    await fs.writeFile(exportPath, JSON.stringify(browserExport()), "utf8");
    await importVaultExport({ exportPath, repository: repo });
    const originalBytes = await fs.readFile(vaultPath, "utf8");

    const broken = browserExport();
    broken.specimen.id = "sp_late_proposal_failure";
    broken.specimen.observations = [];
    broken.specimen.eventIds = [];
    broken.evidence = [];
    broken.events = [];
    broken.workflows = [];
    broken.traces = [];
    broken.proposals = [{
      id: "pr_late_missing_evidence",
      specimenId: "sp_late_proposal_failure",
      action: "export_data",
      params: { action: "export_data", payload: {} },
      evidenceIds: ["ev_missing_late"],
      reason: "This proposal should make the atomic import fail.",
      heuristicConfidence: 0.63,
      proposedBy: "system",
      riskLevel: "high",
      status: "pending",
      createdAt: "2026-06-30T00:00:03.000Z"
    }];
    const brokenPath = await tempPath("broken-proposal-export.json");
    await fs.writeFile(brokenPath, JSON.stringify(broken), "utf8");

    await expect(importVaultExport({ exportPath: brokenPath, repository: repo })).rejects.toThrow("Missing evidence");
    expect(await fs.readFile(vaultPath, "utf8")).toBe(originalBytes);
    expect(await repo.getSpecimen("sp_late_proposal_failure")).toBeNull();
  });

  it("rejects conflicting duplicate content atomically", async () => {
    const vaultPath = await tempPath("vault.json");
    const repo = new JsonFileSpecimenRepository(vaultPath);
    const exportPath = await tempPath("export.json");
    await fs.writeFile(exportPath, JSON.stringify(browserExport()), "utf8");
    await importVaultExport({ exportPath, repository: repo });
    const originalBytes = await fs.readFile(vaultPath, "utf8");

    const conflicting = browserExport() as ReturnType<typeof browserExport> & { evidence: Array<{ payload: Record<string, unknown> }> };
    conflicting.evidence[0].payload = { seed: 999, retained: "changed" } as unknown as Record<string, unknown> & { seed: number; nested: { apiKey: string; retained: string } };
    const conflictPath = await tempPath("conflict-export.json");
    await fs.writeFile(conflictPath, JSON.stringify(conflicting), "utf8");

    await expect(importVaultExport({ exportPath: conflictPath, repository: repo })).rejects.toThrow("already exists with different content");
    expect(await fs.readFile(vaultPath, "utf8")).toBe(originalBytes);
    expect((await repo.getEvidence("ev_imported_growth"))?.payload).toMatchObject({ seed: 20705 });
  });

  it("serializes concurrent JSON repository mutations without losing writes", async () => {
    const repo = new JsonFileSpecimenRepository(await tempPath("vault.json"));
    const records: EvidenceRecord[] = Array.from({ length: 20 }, (_, index) => ({
      id: `ev_concurrent_${index}`,
      specimenId: "sp_concurrent",
      sourceType: "growth_simulation",
      timestamp: new Date(Date.UTC(2026, 5, 30, 0, 0, index)).toISOString(),
      payload: { index },
      schemaVersion: 1
    }));

    await Promise.all(records.map((record) => repo.appendEvidence(record)));

    expect((await repo.listEvidence("sp_concurrent")).map((item) => item.id)).toEqual(records.map((item) => item.id));
  });
});
