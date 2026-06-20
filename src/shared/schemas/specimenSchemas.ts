import { z } from "zod";

export const LichenStructureSchema = z.enum(['Crustose', 'Foliose', 'Fruticose']);
export const ObservationOriginSchema = z.enum(["gemini", "local_fallback", "legacy_unverified"]);
export const VerificationStatusSchema = z.enum(["grounded", "fallback", "unverified"]);

export const ArchivalObservationSchema = z.object({
  id: z.string().min(1, "ID cannot be empty"),
  timestamp: z.number().int().positive(),
  observationNumber: z.number().int().positive(),
  text: z.string().min(1),
  evidenceIds: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  generatedBy: ObservationOriginSchema.optional(),
  verificationStatus: VerificationStatusSchema.optional()
});

export const LegacyMemorySchema = z.object({
  text: z.string(),
  timestamp: z.number().int().positive()
});

export const SpecimenSchema = z.object({
  id: z.string().min(1, "ID cannot be empty"),
  name: z.string().min(1, "Binomial taxonomic identifier cannot be empty"),
  seed: z.number().int(),
  birthTime: z.number().int().positive(),
  breathDuration: z.number().nonnegative(),
  breathIntensity: z.number().min(0).max(100),
  breathRhythm: z.string(),
  branchDensity: z.number().min(0).max(1),
  baseColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color format"),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color format"),
  growthDirection: z.number(),
  glowIntensity: z.number().nonnegative(),
  structure: LichenStructureSchema,
  crystalsCount: z.number().int().nonnegative().default(0),
  fungalBlooms: z.number().int().nonnegative().default(0),
  colorMutationOffset: z.number().default(0),
  observations: z.array(ArchivalObservationSchema).default([]),
  memories: z.array(LegacyMemorySchema).default([]),
  schemaVersion: z.number().int().positive().default(1),
  eventIds: z.array(z.string()).default([])
});

export type SpecimenDTO = z.infer<typeof SpecimenSchema>;

export const SpecimenStorageEnvelopeSchema = z.object({
  schemaVersion: z.literal(2),
  migratedAt: z.string().optional(),
  specimens: z.array(SpecimenSchema)
});

export const SpecimenEventSchema = z.object({
  id: z.string().min(1),
  specimenId: z.string().min(1),
  timestamp: z.string().datetime(),
  type: z.enum([
    "breath_deposited",
    "signal_analyzed",
    "growth_simulated",
    "anomaly_detected",
    "archival_entry_created",
    "intervention_proposed",
    "intervention_approved",
    "intervention_rejected",
    "workflow_fallback"
  ]),
  schemaVersion: z.number().int().positive(),
  evidenceIds: z.array(z.string()).default([]),
  payload: z.record(z.string(), z.unknown())
});

export const SpecimenEventStorageEnvelopeSchema = z.object({
  schemaVersion: z.literal(2),
  events: z.array(SpecimenEventSchema)
});
