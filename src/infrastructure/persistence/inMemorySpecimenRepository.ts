import { Specimen, SpecimenEvent } from "../../domain";
import { SpecimenRepository } from "./specimenRepository";
import { NotFoundError } from "../../domain/errors";

export class InMemorySpecimenRepository implements SpecimenRepository {
  private specimens = new Map<string, Specimen>();
  private eventsBySpecimen = new Map<string, SpecimenEvent[]>();

  async getSpecimen(id: string): Promise<Specimen | null> {
    return this.specimens.get(id) || null;
  }

  async saveSpecimen(specimen: Specimen): Promise<void> {
    this.specimens.set(specimen.id, { ...specimen });
  }

  async appendEvent(event: SpecimenEvent): Promise<void> {
    const events = this.eventsBySpecimen.get(event.specimenId) || [];
    events.push({ ...event });
    this.eventsBySpecimen.set(event.specimenId, events);

    // Update specimen's catalog of event references
    const specimen = this.specimens.get(event.specimenId);
    if (specimen) {
      if (!specimen.eventIds.includes(event.id)) {
        specimen.eventIds.push(event.id);
        this.specimens.set(event.specimenId, specimen);
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

    // Sort by timestamp then limit
    events = [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    if (options?.limit !== undefined) {
      events = events.slice(-options.limit);
    }

    return events;
  }
}
