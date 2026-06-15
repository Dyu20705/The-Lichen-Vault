import { LichenStructure, LichenOrganism, BreathRecording } from "../types";

// Linear Congruential / Sine-based PRNG for seed-based consistency
export class SeededRandom {
  public seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  // Returns a float from 0 to 1
  next(): number {
    const x = Math.sin(this.seed++) * 10000;
    return x - Math.floor(x);
  }

  // Returns float in range [min, max]
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  // Choose random item
  pick<T>(arr: T[]): T {
    const idx = Math.floor(this.next() * arr.length);
    return arr[idx];
  }
}

// Generates an elegant, ancient-sounding Latin botanical genus and species
export function generateBotanicalName(seed: number): string {
  const rand = new SeededRandom(seed);
  
  const genera = [
    "Umbilicaria", "Cladonia", "Peltigera", "Ramalina", 
    "Xanthoria", "Physcia", "Lobaria", "Usnea", 
    "Lecanora", "Graphis", "Caloplaca", "Evernia", 
    "Hypogymnia", "Parmelia", "Coelocaulon", "Cetraria"
  ];
  
  const species = [
    "aethelis", "nebulosa", "auraria", "chrysoleuca", 
    "graphica", "silvatica", "nivea", "crystallina", 
    "pulmonaria", "caperata", "subfusca", "physodes", 
    "pruinosa", "floccosa", "vulpina", "spectabilis",
    "borealis", "temeraria", "vespertina", "solaria"
  ];

  const genus = rand.pick(genera);
  const spec = rand.pick(species);
  
  return `${genus} ${spec}`;
}

const LICHEN_COLORS = [
  // Primary (Mossy, stone, slate) / Accent (Spore glow, fluorescent crystal)
  { base: "#2a3d30", accent: "#d97706" }, // Deep Forest / Glowing Spore Amber
  { base: "#4a5a50", accent: "#10b981" }, // Silvery Sage / Bioluminescent Emerald
  { base: "#1e293b", accent: "#06b6d4" }, // Abyssal Slate / Frozen Cyan
  { base: "#1c2e24", accent: "#f59e0b" }, // Charcoal Sage / Warm Marigold
  { base: "#3f4c38", accent: "#a3e635" }, // Dry Moss / Radioactive Lime
  { base: "#2c3e44", accent: "#ec4899" }, // Oxide Teal / Coral Phlox
  { base: "#1e1e24", accent: "#f43f5e" }, // Midnight Ash / Velvet Crimson
];

export function generateLichenFromBreaths(recordings: BreathRecording[]): LichenOrganism {
  // Create a highly robust composite seed from the breath metrics
  const totalDuration = recordings.reduce((acc, r) => acc + r.duration, 0);
  const avgIntensity = recordings.reduce((acc, r) => acc + r.intensity, 0) / recordings.length;
  
  // Calculate variance for rhythmic resonance
  const averageDur = totalDuration / recordings.length;
  const durVariance = recordings.reduce((acc, r) => acc + Math.pow(r.duration - averageDur, 2), 0) / recordings.length;
  
  // Create solid seed integer
  const seedMultiplier = Math.floor(totalDuration * avgIntensity * 137 + durVariance * 253);
  const seed = Math.max(1, seedMultiplier);

  const rand = new SeededRandom(seed);
  const name = generateBotanicalName(seed);

  // Biological Structure determination based on duration
  let structure: LichenStructure = "Foliose"; // Wavy leaves
  if (totalDuration > 15) {
    structure = "Fruticose"; // Shrubby, complex branching structures
  } else if (totalDuration < 8) {
    structure = "Crustose"; // Flat, dense, crystal-clinging scale
  }

  // Choose appropriate color palette based on intensity
  // Energetic breath yields striking colors, gentle breath yields calm stone colors
  const paletteIdx = Math.min(
    LICHEN_COLORS.length - 1,
    Math.floor((avgIntensity / 100) * LICHEN_COLORS.length)
  );
  const palette = LICHEN_COLORS[paletteIdx] || LICHEN_COLORS[0];

  // Rhythm textual classification
  let breathRhythm = "Steady Deep Resonance";
  if (durVariance > 2.5) {
    breathRhythm = "Saccadic Kinetic Whisper";
  } else if (durVariance > 0.8) {
    breathRhythm = "Resonant Tidal Pulse";
  } else {
    breathRhythm = "Symmetric Crystalline Cadence";
  }

  // Branch density based on duration and intensity combo
  const branchDensity = Number((0.3 + (totalDuration / 30) * 0.5 + (avgIntensity / 200) * 0.2).toFixed(3));
  const glowIntensity = Number((0.2 + (avgIntensity / 100) * 0.8).toFixed(2));
  const growthDirection = Number(((rand.next() - 0.5) * 0.3).toFixed(3)); // radial offset

  return {
    id: `lichen_${Date.now()}_${Math.floor(rand.next() * 100000)}`,
    name,
    seed,
    birthTime: Date.now(),
    breathDuration: Number(totalDuration.toFixed(1)),
    breathIntensity: Math.round(avgIntensity),
    breathRhythm,
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
    memories: []
  };
}

// Function to calculate simulated growth state parameters based on age
// ageSeconds = (currentTime - birthTime) / 1000
export interface GrowthState {
  scale: number;          // 0.2 (justborn) to 1.1 (fully mature)
  complexity: number;     // recursion depth (2 to 6)
  crystalFactor: number;  // number of crystal shards (0 to 15)
  bloomFactor: number;    // number of fungal blooms spawning (0 to 8)
  hueShift: number;       // color evolution in degrees (0 to 45)
  stageLabel: string;     // botanical description of life-cycle frame
}

export function calculateGrowthState(birthTime: number): GrowthState {
  const ageMs = Date.now() - birthTime;
  const ageSeconds = Math.max(0, ageMs / 1000);
  
  // Real-time growth curves:
  // - First 30 seconds: Spore Node (scale 0.2 to 0.4)
  // - 30s to 5 mins: Filamentous Hatch (scale 0.4 to 0.65)
  // - 5 mins to 1 hour: Arboreal Expansion (scale 0.65 to 0.85)
  // - 1 hour to 1 day: Ancient Maturation (scale 0.85 to 1.0)
  // - After 1 day: Deep Calcification (scale 1.0 to 1.15, with mineral crystals and fungal blooms)

  let scale = 0.2;
  let complexity = 2;
  let crystalFactor = 0;
  let bloomFactor = 0;
  let hueShift = 0;
  let stageLabel = "Embryonic Spore";

  if (ageSeconds < 30) {
    // Embryonic Phase
    scale = 0.2 + (ageSeconds / 30) * 0.2;
    complexity = 2;
    stageLabel = "Geminating Spore Node";
  } else if (ageSeconds < 300) {
    // Filamentous Hatch (30s to 5 mins)
    const ratio = (ageSeconds - 30) / (300 - 30);
    scale = 0.4 + ratio * 0.25;
    complexity = 3;
    stageLabel = "Filamentous Hyphae";
    hueShift = ratio * 5;
  } else if (ageSeconds < 3600) {
    // Young Thallus (5 mins to 1 hour)
    const ratio = (ageSeconds - 300) / (3600 - 300);
    scale = 0.65 + ratio * 0.2;
    complexity = 4;
    crystalFactor = Math.floor(ratio * 3);
    stageLabel = "Young Squamulose Thallus";
    hueShift = 5 + ratio * 15;
  } else if (ageSeconds < 86400) {
    // Mature Organism (1 hour to 24 hours)
    const ratio = (ageSeconds - 3600) / (86400 - 3600);
    scale = 0.85 + ratio * 0.15;
    complexity = 5;
    crystalFactor = 3 + Math.floor(ratio * 7);
    bloomFactor = Math.floor(ratio * 4);
    stageLabel = "Arboreal Foliation";
    hueShift = 20 + ratio * 15;
  } else {
    // Deep Calcification (> 24 hours)
    const ratio = Math.min(1, (ageSeconds - 86400) / (86400 * 7)); // Cap at 1 week
    scale = 1.0 + ratio * 0.15;
    complexity = 6;
    crystalFactor = 10 + Math.floor(ratio * 15);
    bloomFactor = 4 + Math.floor(ratio * 6);
    stageLabel = "Venerable Apothecia Bloom";
    hueShift = 35 + ratio * 15;
  }

  return {
    scale: Number(scale.toFixed(3)),
    complexity,
    crystalFactor,
    bloomFactor,
    hueShift: Math.round(hueShift),
    stageLabel
  };
}
