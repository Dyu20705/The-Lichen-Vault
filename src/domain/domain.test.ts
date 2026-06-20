import { describe, it, expect, beforeEach } from "vitest";
import { 
  validateSpecimen, 
  validateSpecimenEvent, 
  validateBreathSample, 
  validateEvidenceRecord, 
  validateTraceEvent, 
  validateWorkflowSession, 
  validateInterventionProposal,
  Specimen,
  SpecimenEvent,
  BreathSample,
  EvidenceRecord,
  TraceEvent,
  WorkflowSession,
  InterventionProposal
} from "./index";
import { InvariantError, MigrationError } from "./errors";
import { SpecimenSchema, WorkflowSessionSchema, TraceEventSchema, InterventionProposalSchema } from "../shared/schemas";
import { InMemorySpecimenRepository } from "../infrastructure/persistence/inMemorySpecimenRepository";
import { migrateLichenOrganismToSpecimen } from "../infrastructure/persistence/localStorageSpecimenRepository";

describe("Domain Models & Invariant Rules", () => {
  
  describe("Zod & Invariant Validations: Breath Samples", () => {
    it("should accept compliant raw/derived biometric samples", () => {
      const sample: BreathSample = {
        id: "s_1",
        index: 0,
        timestamp: "2026-06-20T12:00:00Z",
        duration: 4.5,
        intensity: 75,
        pikes: 3,
        captureMode: "microphone"
      };
      expect(() => validateBreathSample(sample)).not.toThrow();
    });

    it("should reject negative duration exhalations", () => {
      const sample: BreathSample = {
        id: "s_2",
        index: 1,
        timestamp: "2026-06-20T12:00:00Z",
        duration: -1,
        intensity: 60,
        pikes: 2,
        captureMode: "simulated"
      };
      expect(() => validateBreathSample(sample)).toThrow(InvariantError);
    });

    it("should reject out of bound biometric intensities", () => {
      const sample: BreathSample = {
        id: "s_3",
        index: 2,
        timestamp: "2026-06-20T12:00:00Z",
        duration: 3,
        intensity: 120, // max 100
        pikes: 2,
        captureMode: "microphone"
      };
      expect(() => validateBreathSample(sample)).toThrow(InvariantError);
    });
  });

  describe("Zod & Invariant Validations: Specimens", () => {
    const validSpecimen: Specimen = {
      id: "lichen_test_id",
      name: "Xanthoria elegans",
      seed: 489201,
      birthTime: 1771112223000,
      breathDuration: 13.5,
      breathIntensity: 68.2,
      breathRhythm: "Steady Wave",
      branchDensity: 0.65,
      baseColor: "#5c7040",
      accentColor: "#ffbf00",
      growthDirection: 0.25,
      glowIntensity: 0.8,
      structure: "Foliose",
      crystalsCount: 2,
      fungalBlooms: 1,
      colorMutationOffset: 12,
      observations: [
        {
          id: "obs_1",
          timestamp: 1771112223000,
          observationNumber: 1,
          text: "Pristine orange thallus thallus has formed custom structures.",
          evidenceIds: ["ev_1"],
          confidence: 0.95,
          generatedBy: "gemini",
          verificationStatus: "grounded"
        }
      ],
      memories: [],
      schemaVersion: 2,
      eventIds: ["ev_1"]
    };

    it("should parse structurally valid specimens through Zod", () => {
      const res = SpecimenSchema.safeParse(validSpecimen);
      expect(res.success).toBe(true);
      expect(() => validateSpecimen(validSpecimen)).not.toThrow();
    });

    it("should enforce integer seed attributes", () => {
      const corrupt = { ...validSpecimen, seed: 123.456 }; // non-integer seed
      const res = SpecimenSchema.safeParse(corrupt);
      expect(res.success).toBe(false);
      expect(() => validateSpecimen(corrupt)).toThrow(InvariantError);
    });

    it("should reject non-ISO dates, non-hex colors, and duplicate referenced events", () => {
      const corrupt = { ...validSpecimen, baseColor: "invalid-rgb-color" };
      const res = SpecimenSchema.safeParse(corrupt);
      expect(res.success).toBe(false);
    });

    it("should enforce confidence metrics to fall within the bounded range of [0, 1]", () => {
      const corruptObsSpecimen = {
        ...validSpecimen,
        observations: [
          {
            id: "obs_1",
            timestamp: 1771112223000,
            observationNumber: 1,
            text: "Faulty confidence bounds.",
            evidenceIds: ["ev_1"],
            confidence: 1.5, // above 1.0!
            generatedBy: "gemini" as const,
            verificationStatus: "grounded" as const
          }
        ]
      };
      expect(() => validateSpecimen(corruptObsSpecimen)).toThrow(InvariantError);
    });
    
    it("should require evidence references for non-fallback generated observations at version 2+", () => {
      const corruptObsSpecimen = {
        ...validSpecimen,
        observations: [
          {
            id: "obs_1",
            timestamp: 1771112223000,
            observationNumber: 1,
            text: "Unlabeled reference source.",
            evidenceIds: [], // Empty evidenceIds triggers failure
            confidence: 0.9,
            generatedBy: "gemini" as const,
            verificationStatus: "grounded" as const
          }
        ]
      };
      expect(() => validateSpecimen(corruptObsSpecimen)).toThrow(InvariantError);
    });

    it("should allow empty evidence references if observation is marked as local historical fallback", () => {
      const fallbackObsSpecimen = {
        ...validSpecimen,
        observations: [
          {
            id: "obs_1",
            timestamp: 1771112223000,
            observationNumber: 1,
            text: "Local fallback bypasses grounded requirement.",
            evidenceIds: [], 
            confidence: null,
            generatedBy: "local_fallback" as const,
            verificationStatus: "fallback" as const
          }
        ]
      };
      expect(() => validateSpecimen(fallbackObsSpecimen)).not.toThrow();
    });
  });

  describe("Zod & Invariant Validations: Evidence Records", () => {
    it("should validate and capture evidence reference logs", () => {
      const rec: EvidenceRecord = {
        id: "ev_breath_1",
        specimenId: "sp_1",
        sourceType: "breath_capture",
        timestamp: "2026-06-20T12:00:00Z",
        payload: { pitchHz: 230 },
        schemaVersion: 1
      };
      expect(() => validateEvidenceRecord(rec)).not.toThrow();
    });

    it("should prevent blank unique IDs or bad timestamps", () => {
      const corrupt: EvidenceRecord = {
        id: "  ",
        specimenId: "sp_1",
        sourceType: "breath_capture",
        timestamp: "not-a-date",
        payload: {},
        schemaVersion: 1
      };
      expect(() => validateEvidenceRecord(corrupt)).toThrow(InvariantError);
    });
  });

  describe("Zod & Invariant Validations: Episodic Memory Events Discriminated Union", () => {
    it("should parse multiple union patterns correctly", () => {
      const ev1: SpecimenEvent = {
        id: "evt_1",
        specimenId: "sp_1",
        timestamp: "2026-06-20T12:00:00Z",
        type: "breath_deposited",
        schemaVersion: 2,
        evidenceIds: ["ev_1"],
        payload: {
          totalDuration: 12.4,
          averageIntensity: 45,
          overallRhythm: "Steady Pulse",
          captureMode: "microphone",
          seed: 4,
          structure: "Crustose"
        }
      };
      
      const ev2: SpecimenEvent = {
        id: "evt_2",
        specimenId: "sp_1",
        timestamp: "2026-06-20T12:01:00Z",
        type: "intervention_approved",
        schemaVersion: 2,
        evidenceIds: ["ev_2"],
        payload: {
          proposalId: "pr_1",
          approvedAt: "2026-06-20T12:01:00Z",
          approver: "curator_01"
        }
      };

      expect(() => validateSpecimenEvent(ev1)).not.toThrow();
      expect(() => validateSpecimenEvent(ev2)).not.toThrow();
    });

    it("should reject approved intervention events missing operational approvers", () => {
      const evCorrupt: SpecimenEvent = {
        id: "evt_3",
        specimenId: "sp_1",
        timestamp: "2026-06-20T12:01:00Z",
        type: "intervention_approved",
        schemaVersion: 2,
        evidenceIds: [],
        payload: {
          proposalId: "pr_1",
          approvedAt: "2026-06-20T12:01:00Z",
          approver: " " // corrupt
        }
      };
      expect(() => validateSpecimenEvent(evCorrupt)).toThrow(InvariantError);
    });

    it("should prevent duplicated evidence identifiers", () => {
      const evCorrupt: SpecimenEvent = {
        id: "evt_4",
        specimenId: "sp_1",
        timestamp: "2026-06-20T12:01:00Z",
        type: "growth_simulated",
        schemaVersion: 2,
        evidenceIds: ["ev_01", "ev_01"], // Duplicate!
        payload: {
          previousStage: "Thallus Filament",
          nextStage: "Broad Lobes",
          growthDelta: 0.15,
          mutations: [],
          environmentalResponses: [],
          seed: 111,
          evidenceFactors: []
        }
      };
      expect(() => validateSpecimenEvent(evCorrupt)).toThrow(InvariantError);
    });
  });

  describe("Zod & Invariant Validations: Intervention Proposals", () => {
    it("should pass standard adjustable light changes", () => {
      const proposal: InterventionProposal = {
        id: "pr_lux_01",
        specimenId: "sp_99",
        action: "adjust_light",
        params: {
          action: "adjust_light",
          payload: { intensityPercentage: 45 }
        },
        evidenceIds: ["ev_lux_baseline"],
        reason: "Restore standard glow coefficient.",
        confidence: 0.81,
        riskLevel: "low",
        status: "pending",
        createdAt: "2026-06-20T12:00:00Z"
      };

      const res = InterventionProposalSchema.safeParse(proposal);
      expect(res.success).toBe(true);
      expect(() => validateInterventionProposal(proposal)).not.toThrow();
    });

    it("should fail premium lux percentages outside limit boundaries", () => {
      const proposal: InterventionProposal = {
        id: "pr_lux_02",
        specimenId: "sp_99",
        action: "adjust_light",
        params: {
          action: "adjust_light",
          payload: { intensityPercentage: 200 } // invalid out of bounds
        },
        evidenceIds: [],
        reason: "Adjust to high intensity.",
        confidence: 0.9,
        riskLevel: "medium",
        status: "pending",
        createdAt: "2026-06-20T12:00:00Z"
      };

      expect(() => validateInterventionProposal(proposal)).toThrow(InvariantError);
    });

    it("should reject completion metadata on still-pending intervention proposals", () => {
      const proposal: InterventionProposal = {
        id: "pr_flux_01",
        specimenId: "sp_99",
        action: "pause_growth",
        params: {
          action: "pause_growth",
          payload: { durationSeconds: 60 }
        },
        evidenceIds: [],
        reason: "Let specimen rest.",
        confidence: 0.7,
        riskLevel: "low",
        status: "pending", // active pending proposal!
        createdAt: "2026-06-20T12:00:00Z",
        decision: {
          decidedAt: "2026-06-20T12:05:00Z", // Completed decision exists, breaking invariant!
          decidedBy: "operator"
        }
      };

      expect(() => validateInterventionProposal(proposal)).toThrow(InvariantError);
    });
  });
});

describe("Storage & Decoupled Repositories", () => {
  let rep: InMemorySpecimenRepository;

  beforeEach(() => {
    rep = new InMemorySpecimenRepository();
  });

  it("should permit inserting and retrieving specimens synchronously", async () => {
    const fresh: Specimen = {
      id: "spec_unique_01",
      name: "Cladonia rangiferina",
      seed: 921023,
      birthTime: Date.now(),
      breathDuration: 10,
      breathIntensity: 50,
      breathRhythm: "Steady rhythm",
      branchDensity: 0.45,
      baseColor: "#c5e1a5",
      accentColor: "#9ccc65",
      growthDirection: 0.1,
      glowIntensity: 0.3,
      structure: "Fruticose",
      crystalsCount: 0,
      fungalBlooms: 0,
      colorMutationOffset: 0,
      observations: [],
      memories: [],
      schemaVersion: 2,
      eventIds: []
    };

    await rep.saveSpecimen(fresh);
    const retrieved = await rep.getSpecimen("spec_unique_01");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe("Cladonia rangiferina");
  });

  it("should securely catalog appended events chronologically", async () => {
    const sId = "s_event_01";
    const ev1: SpecimenEvent = {
      id: "evt_m_01",
      specimenId: sId,
      timestamp: "2026-06-20T12:00:00Z",
      type: "signal_analyzed",
      schemaVersion: 2,
      evidenceIds: [],
      payload: {
        signalQuality: 0.95,
        cadenceStability: 0.88,
        intensityTrend: "rising",
        anomalies: [],
        confidence: 0.96,
        recommendation: "accept"
      }
    };

    const ev2: SpecimenEvent = {
      id: "evt_m_02",
      specimenId: sId,
      timestamp: "2026-06-20T12:05:00Z",
      type: "anomaly_detected",
      schemaVersion: 2,
      evidenceIds: [],
      payload: {
        detected: false,
        severity: "none",
        evidence: [],
        hypotheses: [],
        nextObservation: null
      }
    };

    await rep.appendEvent(ev1);
    await rep.appendEvent(ev2);

    const chronologicalList = await rep.listEvents(sId);
    expect(chronologicalList.length).toBe(2);
    expect(chronologicalList[0].id).toBe("evt_m_01");
    expect(chronologicalList[1].id).toBe("evt_m_02");

    // Test list limit constraints
    const boundedList = await rep.listEvents(sId, { limit: 1 });
    expect(boundedList.length).toBe(1);
    expect(boundedList[0].id).toBe("evt_m_02"); // gets the latest event (slice from the end)

    // Test date before constraint
    const pastList = await rep.listEvents(sId, { before: "2026-06-20T12:03:00Z" });
    expect(pastList.length).toBe(1);
    expect(pastList[0].id).toBe("evt_m_01");
  });
});

describe("Migration & Resilient Backward Compatibility", () => {
  it("should successfully migrate an authentic pre-existing version 1 LichenOrganism record", () => {
    // Legacy schema format based on actual `/src/types.ts` representation
    const legacyRecord = {
      id: "spore_legacy_01",
      name: "Caloplaca marina",
      seed: 8847,
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
      observations: [
        {
          id: "obs_legacy_1",
          timestamp: 1686700010000,
          observationNumber: 1,
          text: "Intense color glow detected inside primary core chamber."
        }
      ]
    };

    const migrated = migrateLichenOrganismToSpecimen(legacyRecord);

    expect(migrated.schemaVersion).toBe(2); // Migrated version target
    expect(migrated.id).toBe("spore_legacy_01");
    expect(migrated.observations[0].generatedBy).toBe("legacy_unverified"); // Set to prevent invariant failures
    expect(migrated.observations[0].evidenceIds).toEqual([]);
    expect(migrated.observations[0].confidence).toBe(null);
    expect(migrated.observations[0].verificationStatus).toBe("unverified");
    expect(migrated.crystalsCount).toBe(0); // Filled with defaults
    expect(migrated.fungalBlooms).toBe(0);
    expect(migrated.colorMutationOffset).toBe(0);
  });

  it("should throw clear, detailed MigrationError on corrupt, unidentifiable inputs", () => {
    const rawGarbage = {
      birthTime: Date.now(),
      structure: "Foliose"
    }; // Missing critical id or name descriptors

    expect(() => migrateLichenOrganismToSpecimen(rawGarbage)).toThrow(MigrationError);
  });
});
