import { InvariantError } from "./errors";

export type LichenStructure = 'Crustose' | 'Foliose' | 'Fruticose';

export interface ArchivalObservation {
  id: string;
  timestamp: number; // Unix timestamp in ms
  observationNumber: number;
  text: string;
  evidenceIds?: string[]; // reference ids used to ground the report
  confidence?: number; // [0, 1]
  generatedBy?: "gemini" | "local_fallback";
}

export interface Specimen {
  id: string; // unique locator
  name: string; // taxonomic binomial identifier
  seed: number; // integer seed
  birthTime: number; // Unix timestamp in ms
  breathDuration: number; // in seconds
  breathIntensity: number; // average [0, 100]
  breathRhythm: string; // short rhythmic description
  
  // L-System and procedural details
  branchDensity: number; // [0.2, 0.9]
  baseColor: string; // primary color hex
  accentColor: string; // highlight color hex
  growthDirection: number; // angle offset
  glowIntensity: number; // luminescence coefficient
  structure: LichenStructure;

  // Adaptations over time
  crystalsCount: number;
  fungalBlooms: number;
  colorMutationOffset: number;

  // Memories and Observations
  observations: ArchivalObservation[];
  memories: Array<{ text: string; timestamp: number }>; // kept for legacy fallback compatibility
  
  // Provenance & Versioning
  schemaVersion: number;
  eventIds: string[]; // historic audit log steps
}

export function validateSpecimen(specimen: Specimen): void {
  if (!specimen.id || specimen.id.trim() === "") {
    throw new InvariantError("ID must not be empty.");
  }
  if (!specimen.name || specimen.name.trim() === "") {
    throw new InvariantError("Taxonomic binomial identifier name cannot be empty.");
  }
  if (specimen.birthTime <= 0) {
    throw new InvariantError("Birth time must be a positive integer Unix timestamp.");
  }
  if (!Number.isInteger(specimen.seed)) {
    throw new InvariantError("Seeds must be valid deterministic integer values.");
  }
  if (specimen.breathDuration < 0) {
    throw new InvariantError("Durations must be non-negative.");
  }
  if (specimen.breathIntensity < 0 || specimen.breathIntensity > 100) {
    throw new InvariantError("Average breath intensity must fall between 0 and 100.");
  }
  if (specimen.branchDensity < 0.2 || specimen.branchDensity > 0.9) {
    // Tolerant check but keeps within botanical L-System layout
    if (specimen.branchDensity < 0 || specimen.branchDensity > 1) {
      throw new InvariantError("Organic branch density must remain within float bounds [0, 1]");
    }
  }
  if (specimen.schemaVersion <= 0) {
    throw new InvariantError("Unknown schema versions must fail safely. Version must be positive.");
  }
  
  // Duplication checks
  const uniqueEvents = new Set(specimen.eventIds);
  if (uniqueEvents.size !== specimen.eventIds.length) {
    throw new InvariantError("Event references must not contain duplicates.");
  }

  // Validate observations
  for (const obs of specimen.observations) {
    if (!obs.id) {
      throw new InvariantError("ID must not be empty.");
    }
    if (obs.confidence !== undefined && (obs.confidence < 0 || obs.confidence > 1)) {
      throw new InvariantError("Confidence must remain in [0, 1].");
    }
    // "Generated archival observations must contain at least one evidence reference unless they are explicitly marked as local degraded fallback."
    if (
      specimen.schemaVersion >= 2 &&
      obs.generatedBy !== "local_fallback" &&
      (!obs.evidenceIds || obs.evidenceIds.length === 0)
    ) {
      throw new InvariantError("Generated archival observations must contain at least one evidence reference unless they are explicitly marked as local degraded fallback.");
    }
  }
}
