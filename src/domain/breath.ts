import { InvariantError } from "./errors";

export type CaptureMode = "microphone" | "simulated";

export interface RawBreathRecording {
  duration: number; // in seconds
  intensity: number; // 0 to 100
  pikes: number; // rhythm peaks
}

export interface BreathSample {
  id: string;
  index: number; // 0, 1, or 2 (part of three-breath ritual)
  timestamp: string; // ISO-8601 string
  duration: number; // in seconds, must be >= 0
  intensity: number; // 0 to 100, must be >= 0
  pikes: number; // >= 0
  captureMode: CaptureMode;
}

export interface BreathAggregateMetrics {
  totalDuration: number;
  averageIntensity: number;
  overallRhythm: string;
  samples: BreathSample[];
  signalQuality: number; // [0, 1]
}

// Domain Invariant Validations
export function validateBreathSample(sample: BreathSample): void {
  if (!sample.id) {
    throw new InvariantError("ID must not be empty.");
  }
  if (!sample.timestamp || isNaN(Date.parse(sample.timestamp))) {
    throw new InvariantError("Timestamp must be a valid ISO-8601 string.");
  }
  if (sample.duration < 0) {
    throw new InvariantError("Durations must be non-negative.");
  }
  if (sample.intensity < 0 || sample.intensity > 100) {
    throw new InvariantError("Biometric intensity must be between 0 and 100.");
  }
  if (sample.pikes < 0) {
    throw new InvariantError("Pikes count must be non-negative.");
  }
}

export function validateBreathAggregate(metrics: BreathAggregateMetrics): void {
  if (metrics.totalDuration < 0) {
    throw new InvariantError("Durations must be non-negative.");
  }
  if (metrics.averageIntensity < 0 || metrics.averageIntensity > 100) {
    throw new InvariantError("Average intensity must be between 0 and 100.");
  }
  if (metrics.signalQuality < 0 || metrics.signalQuality > 1) {
    throw new InvariantError("Confidence / signalQuality must remain in [0, 1].");
  }
  metrics.samples.forEach(validateBreathSample);
}
