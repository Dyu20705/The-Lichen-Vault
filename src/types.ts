import { LichenStructure, ArchivalObservation, Specimen } from "./domain";

export type { LichenStructure, ArchivalObservation };
export type LichenOrganism = Specimen;

export interface BreathRecording {
  duration: number; // in seconds
  intensity: number; // average level (0 to 100)
  pikes: number; // rhythmic intensity spikes
}
