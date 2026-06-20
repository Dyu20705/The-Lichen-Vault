import { Specimen, SpecimenEvent } from "../../domain";

export interface SpecimenRepository {
  getSpecimen(id: string): Promise<Specimen | null>;
  saveSpecimen(specimen: Specimen): Promise<void>;
  appendEvent(event: SpecimenEvent): Promise<void>;
  listEvents(
    specimenId: string,
    options?: {
      limit?: number;
      before?: string; // ISO-8601 string
      types?: SpecimenEvent["type"][];
    }
  ): Promise<SpecimenEvent[]>;
}
