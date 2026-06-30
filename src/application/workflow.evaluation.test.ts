import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageCorruptionError } from "../domain/errors";
import { InMemorySpecimenRepository } from "../infrastructure/persistence/inMemorySpecimenRepository";
import { LocalStorageSpecimenRepository } from "../infrastructure/persistence/localStorageSpecimenRepository";
import { computeGrowthSeed, simulateGrowth } from "./growthSimulator";
import { assertEvidenceReferences, createInterventionProposal, decideProposal } from "./policy";
import { curateSignal } from "./signalCurator";
import { runBreathWorkflow } from "./vaultWorkflow";

const recordings = [
  { duration: 2.1, intensity: 44, pikes: 2, captureMode: "simulated" as const },
  { duration: 2.4, intensity: 48, pikes: 1, captureMode: "simulated" as const },
  { duration: 2.2, intensity: 46, pikes: 2, captureMode: "simulated" as const }
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("workflow evaluation harness", () => {
  it("rejects observation and proposal references to nonexistent evidence ids", async () => {
    const repo = new InMemorySpecimenRepository();
    await expect(assertEvidenceReferences(repo, "sp_1", ["ev_missing"])).rejects.toThrow("Missing evidence");
  });

  it("model unavailable causes local fallback and records fallback trace", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("model unavailable")));
    const repo = new InMemorySpecimenRepository();

    const result = await runBreathWorkflow({ recordings, repository: repo, captureMode: "simulated" });
    const specimen = await repo.getSpecimen(result.specimenId);
    const traces = await repo.listTraces(result.specimenId);

    expect(specimen?.observations[0].generatedBy).toBe("local_fallback");
    expect(traces.some((trace) => trace.actor === "archivist" && trace.status === "fallback")).toBe(true);
  });

  it("corrupted storage is not automatically deleted", async () => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
        key: (index: number) => Array.from(storage.keys())[index] ?? null,
        get length() { return storage.size; }
      },
      configurable: true
    });
    storage.set("eval_flora", "{bad-json");

    const repo = new LocalStorageSpecimenRepository("eval_flora", "eval_events");
    await expect(repo.listSpecimens()).rejects.toThrow(StorageCorruptionError);
    expect(storage.get("eval_flora")).toBe("{bad-json");
  });

  it("high-risk intervention is not automatically executed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("model unavailable")));
    const repo = new InMemorySpecimenRepository();

    const result = await runBreathWorkflow({ recordings, repository: repo, captureMode: "simulated" });
    const proposals = await repo.listProposals(result.specimenId);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].riskLevel).toBe("high");
    expect(proposals[0].status).toBe("pending");
  });

  it("same seed inputs and algorithm version produce the same growth result", () => {
    const curated = curateSignal({
      recordings,
      specimenId: "sp_same",
      workflowId: "wf_same",
      captureMode: "simulated",
      now: new Date("2026-06-30T00:00:00.000Z")
    });
    const evidenceIds = curated.evidence.map((item) => item.id);
    const first = simulateGrowth({
      curatedSignal: curated.curatedSignal,
      specimenId: "sp_same",
      workflowId: "wf_same",
      inputEvidenceIds: evidenceIds,
      birthTime: 1771112223000,
      timestamp: "2026-06-30T00:00:00.000Z"
    });
    const second = simulateGrowth({
      curatedSignal: curated.curatedSignal,
      specimenId: "sp_same",
      workflowId: "wf_same",
      inputEvidenceIds: evidenceIds,
      birthTime: 1771112223000,
      timestamp: "2026-06-30T00:00:00.000Z"
    });

    expect(computeGrowthSeed(curated.curatedSignal, evidenceIds)).toBe(first.specimen.seed);
    expect(second).toEqual(first);
  });

  it("repeated approval does not produce duplicate events", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("model unavailable")));
    const repo = new InMemorySpecimenRepository();
    const result = await runBreathWorkflow({ recordings, repository: repo, captureMode: "simulated" });
    const proposal = (await repo.listProposals(result.specimenId))[0];
    const context = { actor: "user" as const, userId: "local", actionNonce: "nonce" };

    await decideProposal({ repo, proposalId: proposal.id, decision: "approved", context, decidedAt: "2026-06-30T00:00:00.000Z" });
    await decideProposal({ repo, proposalId: proposal.id, decision: "approved", context, decidedAt: "2026-06-30T00:00:01.000Z" });

    const events = await repo.listEvents(result.specimenId, { types: ["intervention_approved"] });
    expect(events).toHaveLength(1);
  });

  it("write paths cannot bypass schema validation or policy evidence checks", async () => {
    const repo = new InMemorySpecimenRepository();
    await expect(repo.saveProposal({
      id: "",
      specimenId: "sp",
      action: "export_data",
      params: { action: "export_data", payload: {} },
      evidenceIds: [],
      reason: "invalid",
      heuristicConfidence: 0.5,
      riskLevel: "high",
      status: "pending",
      createdAt: "2026-06-30T00:00:00.000Z"
    })).rejects.toThrow();

    await expect(createInterventionProposal({
      repo,
      id: "pr_missing",
      specimenId: "sp",
      action: "export_data",
      interventionParams: { action: "export_data", payload: {} },
      evidenceIds: ["ev_missing"],
      reason: "Should fail.",
      proposedBy: "tool",
      createdAt: "2026-06-30T00:00:00.000Z"
    })).rejects.toThrow("Missing evidence");
  });

  it("invalid model output is converted to fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "", evidenceIds: ["ev_fake"] })
    }));
    const repo = new InMemorySpecimenRepository();
    const result = await runBreathWorkflow({ recordings, repository: repo, captureMode: "simulated" });

    const specimen = await repo.getSpecimen(result.specimenId);
    expect(specimen?.observations[0].verificationStatus).toBe("fallback");
  });

  it("raw audio never appears in model request payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        text: "The thallus remains quiet under glass.",
        evidenceIds: [],
        verificationStatus: "fallback",
        generatedBy: "local_fallback",
        promptVersion: "archivist.v1",
        model: "fake"
      })
    });
    vi.stubGlobal("fetch", fetchMock);
    const repo = new InMemorySpecimenRepository();
    await runBreathWorkflow({
      recordings: recordings.map((item) => ({ ...item, rawAudio: "SECRET_AUDIO" }) as never),
      repository: repo,
      captureMode: "simulated"
    });

    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("SECRET_AUDIO");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("rawAudio");
  });

  it("agent or tool contexts cannot approve a proposal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("model unavailable")));
    const repo = new InMemorySpecimenRepository();
    const result = await runBreathWorkflow({ recordings, repository: repo, captureMode: "simulated" });
    const proposal = (await repo.listProposals(result.specimenId))[0];

    await expect(decideProposal({
      repo,
      proposalId: proposal.id,
      decision: "approved",
      context: { actor: "agent" },
      decidedAt: "2026-06-30T00:00:00.000Z"
    })).rejects.toThrow("trusted user action");
  });

  it("unsupported storage schema versions fail safely", async () => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
        key: (index: number) => Array.from(storage.keys())[index] ?? null,
        get length() { return storage.size; }
      },
      configurable: true
    });
    storage.set("future_flora", JSON.stringify({ schemaVersion: 99, specimens: [] }));

    const repo = new LocalStorageSpecimenRepository("future_flora", "future_events");
    await expect(repo.listSpecimens()).rejects.toThrow(StorageCorruptionError);
    expect(storage.has("future_flora")).toBe(true);
  });
});
