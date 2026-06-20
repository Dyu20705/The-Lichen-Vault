import { Specimen, SpecimenEvent, validateSpecimen, validateSpecimenEvent } from "../../domain";
import { SpecimenRepository } from "./specimenRepository";
import { MigrationError, StorageError } from "../../domain/errors";
import { SpecimenSchema } from "../../shared/schemas";

export function migrateLichenOrganismToSpecimen(raw: any): Specimen {
  try {
    if (!raw || typeof raw !== "object") {
      throw new MigrationError("Element is not a valid JSON object descriptor.", raw);
    }
    
    // Check identification details
    if (!raw.id || typeof raw.id !== "string") {
      throw new MigrationError("Missing unique specimen verification identifier (id).", raw);
    }
    if (!raw.name || typeof raw.name !== "string") {
      throw new MigrationError("Missing binomial specimen classification name (name).", raw);
    }

    // Default missing rendering params or map gracefully
    const migrated: any = {
      id: raw.id,
      name: raw.name,
      seed: typeof raw.seed === "number" ? raw.seed : Math.floor(Math.random() * 1000000),
      birthTime: typeof raw.birthTime === "number" ? raw.birthTime : Date.now(),
      breathDuration: typeof raw.breathDuration === "number" ? raw.breathDuration : 0,
      breathIntensity: typeof raw.breathIntensity === "number" ? raw.breathIntensity : 50,
      breathRhythm: raw.breathRhythm || "Undefined Rhythm Rhythm",
      branchDensity: typeof raw.branchDensity === "number" ? raw.branchDensity : 0.55,
      baseColor: /^#[0-9a-fA-F]{6}$/.test(raw.baseColor || "") ? raw.baseColor : "#c4caa0",
      accentColor: /^#[0-9a-fA-F]{6}$/.test(raw.accentColor || "") ? raw.accentColor : "#ffbf00",
      growthDirection: typeof raw.growthDirection === "number" ? raw.growthDirection : 0,
      glowIntensity: typeof raw.glowIntensity === "number" ? raw.glowIntensity : 0.4,
      structure: ["Crustose", "Foliose", "Fruticose"].includes(raw.structure) ? raw.structure : "Crustose",
      crystalsCount: typeof raw.crystalsCount === "number" ? raw.crystalsCount : 0,
      fungalBlooms: typeof raw.fungalBlooms === "number" ? raw.fungalBlooms : 0,
      colorMutationOffset: typeof raw.colorMutationOffset === "number" ? raw.colorMutationOffset : 0,
      memories: Array.isArray(raw.memories) ? raw.memories : [],
      schemaVersion: typeof raw.schemaVersion === "number" ? raw.schemaVersion : 2,
      eventIds: Array.isArray(raw.eventIds) ? raw.eventIds : []
    };

    // Map historical observations
    const observations = Array.isArray(raw.observations) ? raw.observations : [];
    migrated.observations = observations.map((obs: any, index: number) => {
      return {
        id: obs.id || `obs_${raw.id}_${index + 1}`,
        timestamp: obs.timestamp || migrated.birthTime,
        observationNumber: obs.observationNumber || (index + 1),
        text: obs.text || "Unrecorded historical notes on tissue containment.",
        evidenceIds: Array.isArray(obs.evidenceIds) ? obs.evidenceIds : [],
        confidence: typeof obs.confidence === "number" ? obs.confidence : 1.0,
        generatedBy: obs.generatedBy || "local_fallback"
      };
    });

    const parsed = SpecimenSchema.parse(migrated);
    validateSpecimen(parsed as Specimen);
    return parsed as Specimen;
  } catch (err: any) {
    if (err instanceof MigrationError) throw err;
    throw new MigrationError(`Structural validation conversion failure: ${err.message}`, raw);
  }
}

export class LocalStorageSpecimenRepository implements SpecimenRepository {
  private specimenKey = "lichen_vault_flora";
  private eventKey = "lichen_vault_events";

  constructor(specimenKey?: string, eventKey?: string) {
    if (specimenKey) this.specimenKey = specimenKey;
    if (eventKey) this.eventKey = eventKey;
  }

  private getAllRawSpecimens(): any[] {
    try {
      const data = localStorage.getItem(this.specimenKey);
      if (!data) return [];
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private getAllRawEvents(): any[] {
    try {
      const data = localStorage.getItem(this.eventKey);
      if (!data) return [];
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveRawSpecimens(raws: any[]): void {
    try {
      localStorage.setItem(this.specimenKey, JSON.stringify(raws));
    } catch (e) {
      throw new StorageError("Could not write flora serialized state to localStorage", e);
    }
  }

  private saveRawEvents(raws: any[]): void {
    try {
      localStorage.setItem(this.eventKey, JSON.stringify(raws));
    } catch (e) {
      throw new StorageError("Could not write event serialized state to localStorage", e);
    }
  }

  async getSpecimen(id: string): Promise<Specimen | null> {
    const rawList = this.getAllRawSpecimens();
    const foundRaw = rawList.find((item) => item && item.id === id);
    if (!foundRaw) return null;

    try {
      return migrateLichenOrganismToSpecimen(foundRaw);
    } catch (err) {
      // Degraded recovery behavior as requested:
      // "Do not crash. Preserve original payload. Expose a clear recoverable error."
      console.warn("Corrupted specimen record encountered during retrieval:", err);
      // Construct a minimal recovery specimen to bypass loader blocking, or return migrated version
      // Let's rethrow as a storage or migration error for the controller to handle gracefully if desired
      throw err;
    }
  }

  async saveSpecimen(specimen: Specimen): Promise<void> {
    validateSpecimen(specimen);
    const rawList = this.getAllRawSpecimens();
    const index = rawList.findIndex((item) => item && item.id === specimen.id);
    
    if (index >= 0) {
      rawList[index] = specimen;
    } else {
      rawList.unshift(specimen); // keep new item at first position matching existing UX
    }

    this.saveRawSpecimens(rawList);
  }

  async appendEvent(event: SpecimenEvent): Promise<void> {
    validateSpecimenEvent(event);
    const rawEvents = this.getAllRawEvents();
    rawEvents.push(event);
    this.saveRawEvents(rawEvents);

    // Sync back reference to the specimen
    const specimen = await this.getSpecimen(event.specimenId);
    if (specimen) {
      if (!specimen.eventIds.includes(event.id)) {
        specimen.eventIds.push(event.id);
        await this.saveSpecimen(specimen);
      }
    }
  }

  async listEvents(
    specimenId: string,
    options?: {
      limit?: number;
      before?: string;
      types?: SpecimenEvent["type"][];
    }
  ): Promise<SpecimenEvent[]> {
    const rawEvents = this.getAllRawEvents();
    let events: SpecimenEvent[] = [];

    for (const raw of rawEvents) {
      try {
        if (raw && raw.specimenId === specimenId) {
          validateSpecimenEvent(raw as SpecimenEvent);
          events.push(raw as SpecimenEvent);
        }
      } catch (e) {
        console.warn("Corrupted memory event discarded during list querying:", e);
      }
    }

    // Filter by timestamp (before)
    if (options?.before) {
      const beforeTime = Date.parse(options.before);
      events = events.filter((e) => Date.parse(e.timestamp) < beforeTime);
    }

    // Filter by types
    if (options?.types && options.types.length > 0) {
      events = events.filter((e) => options.types!.includes(e.type));
    }

    // Sort chronologically ascending
    events = events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    if (options?.limit !== undefined) {
      events = events.slice(-options.limit);
    }

    return events;
  }
}
