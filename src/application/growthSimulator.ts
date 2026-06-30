import { EvidenceRecord, LichenStructure, Specimen } from "../domain";
import { generateBotanicalName, SeededRandom } from "../utils/generator";
import { CuratedSignal } from "./signalCurator";

export const GROWTH_ALGORITHM_VERSION = "growth-simulator.v1";

const LICHEN_COLORS = [
  { base: "#2a3d30", accent: "#d97706" },
  { base: "#4a5a50", accent: "#10b981" },
  { base: "#1e293b", accent: "#06b6d4" },
  { base: "#1c2e24", accent: "#f59e0b" },
  { base: "#3f4c38", accent: "#a3e635" },
  { base: "#2c3e44", accent: "#ec4899" },
  { base: "#1e1e24", accent: "#f43f5e" }
];

export interface GrowthResult {
  specimen: Specimen;
  evidence: EvidenceRecord;
  algorithmVersion: string;
  growthDelta: number;
  evidenceFactors: string[];
}

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

export function computeGrowthSeed(curated: CuratedSignal, evidenceIds: string[], algorithmVersion = GROWTH_ALGORITHM_VERSION): number {
  const material = JSON.stringify({
    algorithmVersion,
    totalDuration: curated.metrics.totalDuration,
    averageIntensity: curated.metrics.averageIntensity,
    overallRhythm: curated.metrics.overallRhythm,
    signalQuality: curated.metrics.signalQuality,
    evidenceIds
  });
  return Math.max(1, stableHash(material));
}

export function simulateGrowth(params: {
  curatedSignal: CuratedSignal;
  specimenId: string;
  workflowId: string;
  inputEvidenceIds: string[];
  birthTime: number;
  timestamp: string;
  algorithmVersion?: string;
}): GrowthResult {
  const algorithmVersion = params.algorithmVersion ?? GROWTH_ALGORITHM_VERSION;
  const seed = computeGrowthSeed(params.curatedSignal, params.inputEvidenceIds, algorithmVersion);
  const rand = new SeededRandom(seed);
  const totalDuration = params.curatedSignal.metrics.totalDuration;
  const avgIntensity = params.curatedSignal.metrics.averageIntensity;

  let structure: LichenStructure = "Foliose";
  if (totalDuration > 15) structure = "Fruticose";
  else if (totalDuration < 8) structure = "Crustose";

  const paletteIndex = Math.min(LICHEN_COLORS.length - 1, Math.floor((avgIntensity / 100) * LICHEN_COLORS.length));
  const palette = LICHEN_COLORS[paletteIndex] || LICHEN_COLORS[0];
  const branchDensity = Number((0.3 + (totalDuration / 30) * 0.5 + (avgIntensity / 200) * 0.2).toFixed(3));
  const glowIntensity = Number((0.2 + (avgIntensity / 100) * 0.8).toFixed(2));
  const growthDirection = Number(((rand.next() - 0.5) * 0.3).toFixed(3));

  const specimen: Specimen = {
    id: params.specimenId,
    name: generateBotanicalName(seed),
    seed,
    birthTime: params.birthTime,
    breathDuration: totalDuration,
    breathIntensity: Math.round(avgIntensity),
    breathRhythm: params.curatedSignal.metrics.overallRhythm,
    branchDensity: Math.min(0.9, Math.max(0.2, branchDensity)),
    baseColor: palette.base,
    accentColor: palette.accent,
    growthDirection,
    glowIntensity,
    structure,
    crystalsCount: 0,
    fungalBlooms: 0,
    colorMutationOffset: 0,
    observations: [],
    memories: [],
    schemaVersion: 2,
    eventIds: []
  };

  const evidence: EvidenceRecord = {
    id: `ev_${params.workflowId}_growth`,
    specimenId: params.specimenId,
    sourceType: "growth_simulation",
    timestamp: params.timestamp,
    payload: {
      algorithmVersion,
      seed,
      branchDensity: specimen.branchDensity,
      growthDirection,
      glowIntensity,
      structure
    },
    schemaVersion: 1
  };

  return {
    specimen,
    evidence,
    algorithmVersion,
    growthDelta: Number((specimen.branchDensity * params.curatedSignal.metrics.signalQuality).toFixed(3)),
    evidenceFactors: params.inputEvidenceIds
  };
}
