import { Specimen, SpecimenEvent, validateSpecimen, validateSpecimenEvent } from "../../domain";
import { SpecimenRepository } from "./specimenRepository";
import { SpecimenEventSchema, SpecimenSchema } from "../../shared/schemas";

function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemorySpecimenRepository implements SpecimenRepository {
  private specimens = new Map<string, Specimen>();
  private eventsBySpecimen = new Map<string, SpecimenEvent[]>();

  async getSpecimen(id: string): Promise<Specimen | null> {
    const val = this.specimens.get(id);
    if (!val) return null;
    return deepClone(val);
  }

  async saveSpecimen(specimen: Specimen): Promise<void> {
    const parsed = SpecimenSchema.parse(specimen) as Specimen;
    validateSpecimen(parsed);
    this.specimens.set(parsed.id, deepClone(parsed));
  }

  async listSpecimens(): Promise<Specimen[]> {
    return Array.from(this.specimens.values()).map((specimen) => deepClone(specimen));
  }

  async appendEvent(event: SpecimenEvent): Promise<void> {
    const parsed = SpecimenEventSchema.parse(event) as SpecimenEvent;
    validateSpecimenEvent(parsed);

    for (const evList of this.eventsBySpecimen.values()) {
      if (evList.some((existing) => existing.id === parsed.id)) {
        return;
      }
    }

    const events = this.eventsBySpecimen.get(parsed.specimenId) || [];
    this.eventsBySpecimen.set(parsed.specimenId, [...events, deepClone(parsed)]);

    const specimen = this.specimens.get(parsed.specimenId);
    if (specimen) {
      if (!specimen.eventIds.includes(parsed.id)) {
        const updated = { ...specimen, eventIds: [...specimen.eventIds, parsed.id] };
        validateSpecimen(updated);
        this.specimens.set(parsed.specimenId, deepClone(updated));
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
    let events = this.eventsBySpecimen.get(specimenId) || [];

    // Filter by timestamp (before)
    if (options?.before) {
      const beforeTime = Date.parse(options.before);
      events = events.filter((e) => Date.parse(e.timestamp) < beforeTime);
    }

    // Filter by types
    if (options?.types && options.types.length > 0) {
      events = events.filter((e) => options.types!.includes(e.type));
    }

    events = [...events].sort((a, b) => {
      const timeDelta = Date.parse(a.timestamp) - Date.parse(b.timestamp);
      return timeDelta === 0 ? a.id.localeCompare(b.id) : timeDelta;
    });

    if (options?.limit !== undefined) {
      events = events.slice(-options.limit);
    }

    return events.map((event) => deepClone(event));
  }
}
