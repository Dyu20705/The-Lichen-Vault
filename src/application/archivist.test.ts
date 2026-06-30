import { describe, expect, it } from "vitest";
import { EvidenceRecord } from "../domain";
import { ArchivistResponseSchema, localArchivistFallback, toObservation } from "./archivist";

const evidence: EvidenceRecord = {
  id: "ev_archivist_growth",
  specimenId: "specimen_archivist",
  sourceType: "growth_simulation",
  timestamp: "2026-06-20T12:00:00.000Z",
  payload: { structure: "Foliose" },
  schemaVersion: 1
};

describe("archivist provenance contract", () => {
  it("creates grounded observations only with resolvable evidence", () => {
    const observation = toObservation({
      response: {
        text: "The specimen remains stable under glass.",
        evidenceIds: [evidence.id],
        verificationStatus: "grounded",
        generatedBy: "gemini",
        promptVersion: "archivist.v1",
        model: "test-model"
      },
      observationNumber: 1,
      timestamp: 1771112223000,
      evidence: [evidence]
    });

    expect(observation.verificationStatus).toBe("grounded");
    expect(observation.evidenceIds).toEqual([evidence.id]);
    expect(observation.confidence).toBeNull();
  });

  it("rejects missing or duplicate model evidence references instead of filtering them", () => {
    expect(() => toObservation({
      response: {
        text: "The specimen remains stable under glass.",
        evidenceIds: ["ev_missing"],
        verificationStatus: "grounded",
        generatedBy: "gemini",
        promptVersion: "archivist.v1",
        model: "test-model"
      },
      observationNumber: 1,
      timestamp: 1771112223000,
      evidence: [evidence]
    })).toThrow("Missing evidence");

    expect(ArchivistResponseSchema.safeParse({
      text: "The specimen remains stable under glass.",
      evidenceIds: [evidence.id, evidence.id],
      verificationStatus: "grounded",
      generatedBy: "gemini",
      promptVersion: "archivist.v1",
      model: "test-model"
    }).success).toBe(false);
  });

  it("marks fallback observations as fallback and emits no fixed confidence", () => {
    const response = localArchivistFallback({
      specimenName: "Umbilicaria testata",
      stageLabel: "Broad Lobes",
      reason: "model_not_configured"
    });
    const observation = toObservation({
      response,
      observationNumber: 1,
      timestamp: 1771112223000,
      evidence: []
    });

    expect("confidence" in response).toBe(false);
    expect(observation.verificationStatus).toBe("fallback");
    expect(observation.evidenceIds).toEqual([]);
    expect(observation.confidence).toBeNull();
  });
});
