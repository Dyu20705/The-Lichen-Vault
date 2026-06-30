import { beforeEach, describe, expect, it } from "vitest";
import { EvidenceRecord, Specimen, SpecimenEvent } from "../../domain";
import { StorageCorruptionError, StorageError, TransactionRollbackError } from "../../domain/errors";
import { InMemorySpecimenRepository } from "./inMemorySpecimenRepository";
import { LocalStorageSpecimenRepository, migrateLichenOrganismToSpecimen } from "./localStorageSpecimenRepository";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  failNextSetForKey: string | null = null;
  failEverySetForKey: string | null = null;

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failEverySetForKey === key) {
      throw new Error(`persistent write failure for ${key}`);
    }
    if (this.failNextSetForKey === key) {
      this.failNextSetForKey = null;
      throw new Error(`single write failure for ${key}`);
    }
    this.data.set(key, value);
  }
}

const floraKey = "test_flora";
const eventKey = "test_events";
const evidenceKey = "test_evidence";

function installStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true
  });
  return storage;
}

function specimen(overrides: Partial<Specimen> = {}): Specimen {
  return {
    id: "specimen_001",
    name: "Umbilicaria testata",
    seed: 42,
    birthTime: 1771112223000,
    breathDuration: 12,
    breathIntensity: 64,
    breathRhythm: "Symmetric Crystalline Cadence",
    branchDensity: 0.62,
    baseColor: "#2a3d30",
    accentColor: "#d97706",
    growthDirection: 0.1,
    glowIntensity: 0.5,
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

function event(overrides: Partial<SpecimenEvent> = {}): SpecimenEvent {
  return {
    id: "evt_a",
    specimenId: "specimen_001",
    timestamp: "2026-06-20T12:00:00.000Z",
    type: "signal_analyzed",
    schemaVersion: 2,
    evidenceIds: [],
    payload: {
      signalQuality: 0.9,
      cadenceStability: 0.8,
      intensityTrend: "stable",
      anomalies: [],
      confidence: 0.8,
      recommendation: "accept"
    },
    ...overrides
  } as SpecimenEvent;
}

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "ev_specimen_001_breath",
    specimenId: "specimen_001",
    sourceType: "breath_capture",
    timestamp: "2026-06-20T12:00:00.000Z",
    payload: { samples: [{ duration: 2.1, intensity: 44, pikes: 2 }] },
    schemaVersion: 1,
    ...overrides
  };
}

describe("Specimen repository migration and recovery", () => {
  beforeEach(() => {
    installStorage();
  });

  it("migrates legacy observations as unverified without fabricating evidence", () => {
    const legacy = {
      id: "legacy_001",
      name: "Caloplaca marina",
      birthTime: 1686700000000,
      breathDuration: 9.8,
      breathIntensity: 74,
      breathRhythm: "Crescendo Burst",
      branchDensity: 0.42,
      baseColor: "#d2691e",
      accentColor: "#ffa500",
      growthDirection: 0.4,
      glowIntensity: 0.9,
      structure: "Crustose",
      observations: [{ text: "Original wording is preserved exactly." }]
    };

    const migrated = migrateLichenOrganismToSpecimen(legacy);

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.observations[0].text).toBe("Original wording is preserved exactly.");
    expect(migrated.observations[0].generatedBy).toBe("legacy_unverified");
    expect(migrated.observations[0].verificationStatus).toBe("unverified");
    expect(migrated.observations[0].confidence).toBeNull();
    expect(migrated.observations[0].evidenceIds).toEqual([]);
  });

  it("derives missing seed and birth time deterministically and migration is idempotent", () => {
    const legacy = {
      id: "legacy_missing_seed",
      name: "Peltigera determinata",
      breathDuration: 5,
      breathIntensity: 55,
      breathRhythm: "Even",
      branchDensity: 0.5,
      baseColor: "#123456",
      accentColor: "#abcdef",
      growthDirection: 0,
      glowIntensity: 0.4,
      structure: "Foliose"
    };

    const first = migrateLichenOrganismToSpecimen(legacy);
    const second = migrateLichenOrganismToSpecimen(legacy);
    const alreadyMigrated = migrateLichenOrganismToSpecimen(first);

    expect(second).toEqual(first);
    expect(alreadyMigrated).toEqual(first);
    expect(first.seed).toBeGreaterThan(0);
    expect(first.birthTime).toBe(1686700000000);
  });

  it("keeps existing v2 specimen fixtures readable by normalizing missing provenance", async () => {
    const repository = new LocalStorageSpecimenRepository(floraKey, eventKey, evidenceKey);
    localStorage.setItem(floraKey, JSON.stringify({
      schemaVersion: 2,
      specimens: [{
        ...specimen(),
        observations: [{
          id: "obs_old_v2",
          timestamp: 1771112223000,
          observationNumber: 1,
          text: "Older v2 record without provenance fields."
        }]
      }]
    }));

    const loaded = await repository.listSpecimens();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].observations[0]).toMatchObject({
      generatedBy: "legacy_unverified",
      verificationStatus: "unverified",
      evidenceIds: [],
      confidence: null
    });
  });

  it("fails safely for unsupported future versions and malformed storage", async () => {
    const repository = new LocalStorageSpecimenRepository(floraKey, eventKey, evidenceKey);
    localStorage.setItem(floraKey, JSON.stringify({ schemaVersion: 99, specimens: [] }));
    await expect(repository.listSpecimens()).rejects.toThrow(StorageCorruptionError);

    localStorage.setItem(floraKey, "{bad-json");
    await expect(repository.listSpecimens()).rejects.toThrow(StorageCorruptionError);
    expect(localStorage.getItem(floraKey)).toBe("{bad-json");
  });

  it("writes through a validated v2 envelope and preserves corrupt raw payload on save failure", async () => {
    const repository = new LocalStorageSpecimenRepository(floraKey, eventKey);
    await repository.saveSpecimen(specimen());
    expect(JSON.parse(localStorage.getItem(floraKey) ?? "{}").schemaVersion).toBe(2);

    localStorage.setItem(floraKey, "{bad-json");
    await expect(repository.saveSpecimen(specimen({ id: "other" }))).rejects.toThrow(StorageCorruptionError);
    expect(localStorage.getItem(floraKey)).toBe("{bad-json");
  });
});

describe("Evidence persistence and reference integrity", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = installStorage();
  });

  it("validates, persists, reads, and lists evidence records deterministically", async () => {
    const local = new LocalStorageSpecimenRepository(floraKey, eventKey, evidenceKey);
    const memory = new InMemorySpecimenRepository();
    const later = evidence({ id: "ev_specimen_001_signal", sourceType: "signal_analysis", timestamp: "2026-06-20T12:01:00.000Z" });

    await local.appendEvidence(later);
    await local.appendEvidence(evidence());
    await memory.appendEvidence(later);
    await memory.appendEvidence(evidence());

    expect(await local.getEvidence(evidence().id)).toEqual(evidence());
    expect((await local.listEvidence("specimen_001")).map((item) => item.id)).toEqual(["ev_specimen_001_breath", "ev_specimen_001_signal"]);
    expect((await memory.listEvidence("specimen_001")).map((item) => item.id)).toEqual(["ev_specimen_001_breath", "ev_specimen_001_signal"]);
  });

  it("handles duplicate and malformed evidence ids without silently changing records", async () => {
    const local = new LocalStorageSpecimenRepository(floraKey, eventKey, evidenceKey);
    await local.appendEvidence(evidence());
    await local.appendEvidence(evidence());

    await expect(local.appendEvidence(evidence({ payload: { changed: true } }))).rejects.toThrow(StorageError);
    await expect(local.appendEvidence(evidence({ id: "field_breathDuration" }))).rejects.toThrow();
    expect(await local.listEvidence("specimen_001")).toHaveLength(1);
  });

  it("accepts grounded observations only when referenced evidence resolves", async () => {
    const local = new LocalStorageSpecimenRepository(floraKey, eventKey, evidenceKey);
    const memory = new InMemorySpecimenRepository();
    const grounded = specimen({
      observations: [{
        id: "obs_grounded",
        timestamp: 1771112223000,
        observationNumber: 1,
        text: "Evidence-backed observation.",
        evidenceIds: [evidence().id],
        confidence: null,
        generatedBy: "gemini",
        verificationStatus: "grounded"
      }]
    });

    await local.appendEvidence(evidence());
    await memory.appendEvidence(evidence());
    await expect(local.saveSpecimen(grounded)).resolves.not.toThrow();
    await expect(memory.saveSpecimen(grounded)).resolves.not.toThrow();

    const missing = specimen({
      observations: [{ ...grounded.observations[0], evidenceIds: ["ev_missing"] }]
    });
    await expect(local.saveSpecimen(missing)).rejects.toThrow("Missing evidence");
    await expect(memory.saveSpecimen(missing)).rejects.toThrow("Missing evidence");
  });

  it("requires proposal evidence references to resolve before persistence", async () => {
    const repository = new InMemorySpecimenRepository();
    await repository.appendEvidence(evidence());

    await expect(repository.saveProposal({
      id: "pr_valid",
      specimenId: "specimen_001",
      action: "export_data",
      params: { action: "export_data", payload: {} },
      evidenceIds: [evidence().id],
      reason: "Export only after approval.",
      heuristicConfidence: 0.63,
      riskLevel: "high",
      status: "pending",
      createdAt: "2026-06-20T12:00:00.000Z"
    })).resolves.not.toThrow();

    await expect(repository.saveProposal({
      id: "pr_missing",
      specimenId: "specimen_001",
      action: "export_data",
      params: { action: "export_data", payload: {} },
      evidenceIds: ["ev_missing"],
      reason: "Missing evidence should fail.",
      heuristicConfidence: 0.63,
      riskLevel: "high",
      status: "pending",
      createdAt: "2026-06-20T12:00:00.000Z"
    })).rejects.toThrow("Missing evidence");
  });

  it("fails safely for future or corrupt evidence envelopes without deleting payloads", async () => {
    const repository = new LocalStorageSpecimenRepository(floraKey, eventKey, evidenceKey);
    localStorage.setItem(evidenceKey, JSON.stringify({ schemaVersion: 99, evidence: [] }));
    await expect(repository.listEvidence("specimen_001")).rejects.toThrow(StorageCorruptionError);
    expect(localStorage.getItem(evidenceKey)).toContain('"schemaVersion":99');

    localStorage.setItem(evidenceKey, "{bad-json");
    await expect(repository.listEvidence("specimen_001")).rejects.toThrow(StorageCorruptionError);
    expect(localStorage.getItem(evidenceKey)).toBe("{bad-json");
    expect(storage.length).toBeGreaterThan(0);
  });
});

describe("Specimen repository events and rollback", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = installStorage();
  });

  it("uses idempotent duplicate event appends in memory and localStorage", async () => {
    const local = new LocalStorageSpecimenRepository(floraKey, eventKey);
    const memory = new InMemorySpecimenRepository();
    const saved = specimen();
    await local.saveSpecimen(saved);
    await memory.saveSpecimen(saved);

    await local.appendEvent(event());
    await local.appendEvent(event());
    await memory.appendEvent(event());
    await memory.appendEvent(event());

    expect(await local.listEvents(saved.id)).toHaveLength(1);
    expect(await memory.listEvents(saved.id)).toHaveLength(1);
    expect((await local.getSpecimen(saved.id))?.eventIds).toEqual(["evt_a"]);
    expect((await memory.getSpecimen(saved.id))?.eventIds).toEqual(["evt_a"]);
  });

  it("sorts equal timestamps by event id and rejects invalid events before mutation", async () => {
    const repository = new InMemorySpecimenRepository();
    await repository.appendEvent(event({ id: "evt_b" }));
    await repository.appendEvent(event({ id: "evt_a" }));

    expect((await repository.listEvents("specimen_001")).map((item) => item.id)).toEqual(["evt_a", "evt_b"]);
    await expect(repository.appendEvent(event({ id: "" }))).rejects.toThrow();
    expect(await repository.listEvents("specimen_001")).toHaveLength(2);
  });

  it("deep clones repository boundaries", async () => {
    const repository = new InMemorySpecimenRepository();
    const saved = specimen({
      observations: [{
        id: "obs_1",
        timestamp: 1771112223000,
        observationNumber: 1,
        text: "Stable note.",
        evidenceIds: [],
        confidence: null,
        generatedBy: "local_fallback",
        verificationStatus: "fallback"
      }]
    });

    await repository.saveSpecimen(saved);
    saved.observations[0].text = "mutated input";
    const retrieved = await repository.getSpecimen(saved.id);
    retrieved!.observations[0].text = "mutated output";

    expect((await repository.getSpecimen(saved.id))!.observations[0].text).toBe("Stable note.");
  });

  it("rolls back staged localStorage writes and can retry safely", async () => {
    const repository = new LocalStorageSpecimenRepository(floraKey, eventKey);
    await repository.saveSpecimen(specimen());
    storage.failNextSetForKey = floraKey;

    await expect(repository.appendEvent(event())).rejects.toThrow(StorageError);
    expect(await repository.listEvents("specimen_001")).toHaveLength(0);
    expect((await repository.getSpecimen("specimen_001"))?.eventIds).toEqual([]);

    await repository.appendEvent(event());
    expect(await repository.listEvents("specimen_001")).toHaveLength(1);
  });

  it("exposes rollback failure when previous values cannot be restored", async () => {
    const repository = new LocalStorageSpecimenRepository(floraKey, eventKey);
    await repository.saveSpecimen(specimen());
    storage.failNextSetForKey = floraKey;
    storage.failEverySetForKey = eventKey;

    await expect(repository.appendEvent(event())).rejects.toThrow(TransactionRollbackError);
  });
});
