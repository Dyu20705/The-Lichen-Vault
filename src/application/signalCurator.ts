import { BreathAggregateMetrics, BreathSample, EvidenceRecord, RawBreathRecording, validateBreathAggregate, validateBreathSample } from "../domain";

export interface QualityAssessment {
  signalQuality: number;
  cadenceStability: number;
  intensityTrend: "rising" | "falling" | "stable" | "irregular";
  anomalies: string[];
  recommendation: "accept" | "accept_with_caution" | "recapture";
}

export interface CuratedSignal {
  metrics: BreathAggregateMetrics;
  quality: QualityAssessment;
  captureMode: "microphone" | "simulated";
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function classifyRhythm(variance: number): string {
  if (variance > 2.5) return "Saccadic Kinetic Whisper";
  if (variance > 0.8) return "Resonant Tidal Pulse";
  return "Symmetric Crystalline Cadence";
}

function classifyTrend(values: number[]): QualityAssessment["intensityTrend"] {
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? first;
  if (values.length < 2) return "stable";
  if (Math.abs(last - first) < 8) return "stable";
  return last > first ? "rising" : "falling";
}

export function curateSignal(params: {
  recordings: RawBreathRecording[];
  specimenId: string;
  workflowId: string;
  captureMode: "microphone" | "simulated";
  now: Date;
}): { curatedSignal: CuratedSignal; evidence: EvidenceRecord[] } {
  if (params.recordings.length !== 3) {
    throw new Error("The Lichen Vault ritual requires exactly three breaths.");
  }

  const samples: BreathSample[] = params.recordings.map((recording, index) => {
    const sample = {
      id: `sample_${params.workflowId}_${index + 1}`,
      index,
      timestamp: params.now.toISOString(),
      duration: round(recording.duration, 2),
      intensity: round(recording.intensity, 2),
      pikes: Math.max(0, Math.trunc(recording.pikes)),
      captureMode: params.captureMode
    };
    validateBreathSample(sample);
    return sample;
  });

  const totalDuration = round(samples.reduce((sum, item) => sum + item.duration, 0), 1);
  const averageIntensity = round(samples.reduce((sum, item) => sum + item.intensity, 0) / samples.length, 2);
  const averageDuration = totalDuration / samples.length;
  const durationVariance = samples.reduce((sum, item) => sum + (item.duration - averageDuration) ** 2, 0) / samples.length;
  const cadenceStability = round(Math.max(0, 1 - durationVariance / 8));
  const signalQuality = round(Math.max(0, Math.min(1, cadenceStability * 0.65 + Math.min(1, averageIntensity / 70) * 0.35)));

  const anomalies = [
    ...samples.filter((item) => item.duration < 1.5).map((item) => `breath_${item.index + 1}_short`),
    ...samples.filter((item) => item.intensity < 8).map((item) => `breath_${item.index + 1}_low_intensity`)
  ];

  const quality: QualityAssessment = {
    signalQuality,
    cadenceStability,
    intensityTrend: anomalies.length > 1 ? "irregular" : classifyTrend(samples.map((item) => item.intensity)),
    anomalies,
    recommendation: signalQuality < 0.32 ? "recapture" : anomalies.length > 0 ? "accept_with_caution" : "accept"
  };

  const metrics = {
    totalDuration,
    averageIntensity,
    overallRhythm: classifyRhythm(durationVariance),
    samples,
    signalQuality
  };
  validateBreathAggregate(metrics);

  const captured: EvidenceRecord = {
    id: `ev_${params.workflowId}_breath`,
    specimenId: params.specimenId,
    sourceType: "breath_capture",
    timestamp: params.now.toISOString(),
    payload: {
      samples: samples.map(({ duration, intensity, pikes, captureMode }) => ({ duration, intensity, pikes, captureMode })),
      workflowId: params.workflowId
    },
    schemaVersion: 1
  };

  const analyzed: EvidenceRecord = {
    id: `ev_${params.workflowId}_signal`,
    specimenId: params.specimenId,
    sourceType: "signal_analysis",
    timestamp: params.now.toISOString(),
    payload: { ...quality, totalDuration, averageIntensity, overallRhythm: metrics.overallRhythm },
    schemaVersion: 1
  };

  return {
    curatedSignal: { metrics, quality, captureMode: params.captureMode },
    evidence: [captured, analyzed]
  };
}
