import {
  EvidenceRecord,
  InterventionProposal,
  Specimen,
  SpecimenEvent,
  TraceEvent,
  WorkflowSession,
  validateEvidenceRecord,
  validateInterventionProposal,
  validateSpecimen,
  validateSpecimenEvent,
  validateTraceEvent,
  validateWorkflowSession
} from "../../domain";
import { MigrationError, StorageCorruptionError, StorageError, TransactionRollbackError } from "../../domain/errors";
import {
  SpecimenEventSchema,
  SpecimenEventStorageEnvelopeSchema,
  SpecimenSchema,
  SpecimenStorageEnvelopeSchema,
  EvidenceRecordSchema,
  EvidenceStorageEnvelopeSchema,
  InterventionProposalSchema,
  TraceEventSchema,
  WorkflowSessionSchema
} from "../../shared/schemas";
import { SpecimenRepository } from "./specimenRepository";

const CURRENT_STORAGE_VERSION = 2;
const LEGACY_UNKNOWN_TIME = 1686700000000;

type UnknownRecord = Record<string, unknown>;

export interface RecoverySnapshot {
  storageKey: string;
  rawPayload: string | null;
  errorCode: string;
  reason: string;
  recoverability: "recoverable" | "unrecoverable";
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function deterministicObservationId(specimenId: string, index: number): string {
  return `obs_${stableHash(`legacy-observation:${specimenId}:${index}`)}_${index + 1}`;
}

function deterministicBirthTime(raw: UnknownRecord): number {
  if (typeof raw.birthTime === "number" && Number.isFinite(raw.birthTime) && raw.birthTime > 0) {
    return Math.trunc(raw.birthTime);
  }
  if (typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) && raw.createdAt > 0) {
    return Math.trunc(raw.createdAt);
  }
  if (typeof raw.createdAt === "string") {
    const parsed = Date.parse(raw.createdAt);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  if (typeof raw.id === "string") {
    const match = raw.id.match(/(?:lichen|spore|specimen)?_?(\d{12,})/);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
    }
  }
  return LEGACY_UNKNOWN_TIME;
}

function normalizeObservation(rawObservation: unknown, specimenId: string, birthTime: number, index: number) {
  const raw = isRecord(rawObservation) ? rawObservation : {};
  const explicitOrigin = raw.generatedBy;
  const hasEvidence = Array.isArray(raw.evidenceIds) && raw.evidenceIds.length > 0;
  const hasConfidence = typeof raw.confidence === "number";

  if (explicitOrigin === "gemini" && hasEvidence && hasConfidence) {
    return {
      id: typeof raw.id === "string" && raw.id.trim() ? raw.id : deterministicObservationId(specimenId, index),
      timestamp: typeof raw.timestamp === "number" && raw.timestamp > 0 ? Math.trunc(raw.timestamp) : birthTime,
      observationNumber: typeof raw.observationNumber === "number" && raw.observationNumber > 0 ? Math.trunc(raw.observationNumber) : index + 1,
      text: typeof raw.text === "string" && raw.text.length > 0 ? raw.text : "Unrecorded historical notes on tissue containment.",
      evidenceIds: raw.evidenceIds,
      confidence: raw.confidence,
      generatedBy: "gemini" as const,
      verificationStatus: "grounded" as const
    };
  }

  if (explicitOrigin === "local_fallback") {
    return {
      id: typeof raw.id === "string" && raw.id.trim() ? raw.id : deterministicObservationId(specimenId, index),
      timestamp: typeof raw.timestamp === "number" && raw.timestamp > 0 ? Math.trunc(raw.timestamp) : birthTime,
      observationNumber: typeof raw.observationNumber === "number" && raw.observationNumber > 0 ? Math.trunc(raw.observationNumber) : index + 1,
      text: typeof raw.text === "string" && raw.text.length > 0 ? raw.text : "Unrecorded local fallback note.",
      evidenceIds: hasEvidence ? raw.evidenceIds : [],
      confidence: hasConfidence ? raw.confidence : null,
      generatedBy: "local_fallback" as const,
      verificationStatus: "fallback" as const
    };
  }

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : deterministicObservationId(specimenId, index),
    timestamp: typeof raw.timestamp === "number" && raw.timestamp > 0 ? Math.trunc(raw.timestamp) : birthTime,
    observationNumber: typeof raw.observationNumber === "number" && raw.observationNumber > 0 ? Math.trunc(raw.observationNumber) : index + 1,
    text: typeof raw.text === "string" && raw.text.length > 0 ? raw.text : "Unrecorded historical notes on tissue containment.",
    evidenceIds: [],
    confidence: null,
    generatedBy: "legacy_unverified" as const,
    verificationStatus: "unverified" as const
  };
}

export function migrateLichenOrganismToSpecimen(rawInput: unknown): Specimen {
  try {
    const alreadyParsed = SpecimenSchema.safeParse(rawInput);
    if (alreadyParsed.success && isRecord(rawInput) && rawInput.schemaVersion === CURRENT_STORAGE_VERSION) {
      validateSpecimen(alreadyParsed.data as Specimen);
      return alreadyParsed.data as Specimen;
    }

    if (!isRecord(rawInput)) {
      throw new MigrationError("Element is not a valid JSON object descriptor.", rawInput);
    }

    if (typeof rawInput.schemaVersion === "number" && rawInput.schemaVersion > CURRENT_STORAGE_VERSION) {
      throw new MigrationError(`Unsupported future specimen schema version: ${rawInput.schemaVersion}`, rawInput);
    }

    if (typeof rawInput.id !== "string" || rawInput.id.trim() === "") {
      throw new MigrationError("Missing unique specimen verification identifier (id).", rawInput);
    }
    if (typeof rawInput.name !== "string" || rawInput.name.trim() === "") {
      throw new MigrationError("Missing binomial specimen classification name (name).", rawInput);
    }

    const seed = typeof rawInput.seed === "number" && Number.isInteger(rawInput.seed)
      ? rawInput.seed
      : stableHash(`legacy-seed:${rawInput.id}:${rawInput.name}`);
    const birthTime = deterministicBirthTime(rawInput);
    const rawObservations = Array.isArray(rawInput.observations) ? rawInput.observations : [];

    const migrated = {
      id: rawInput.id,
      name: rawInput.name,
      seed,
      birthTime,
      breathDuration: typeof rawInput.breathDuration === "number" ? rawInput.breathDuration : 0,
      breathIntensity: typeof rawInput.breathIntensity === "number" ? rawInput.breathIntensity : 50,
      breathRhythm: typeof rawInput.breathRhythm === "string" ? rawInput.breathRhythm : "Undefined Rhythm",
      branchDensity: typeof rawInput.branchDensity === "number" ? rawInput.branchDensity : 0.55,
      baseColor: typeof rawInput.baseColor === "string" && /^#[0-9a-fA-F]{6}$/.test(rawInput.baseColor) ? rawInput.baseColor : "#c4caa0",
      accentColor: typeof rawInput.accentColor === "string" && /^#[0-9a-fA-F]{6}$/.test(rawInput.accentColor) ? rawInput.accentColor : "#ffbf00",
      growthDirection: typeof rawInput.growthDirection === "number" ? rawInput.growthDirection : 0,
      glowIntensity: typeof rawInput.glowIntensity === "number" ? rawInput.glowIntensity : 0.4,
      structure: rawInput.structure === "Crustose" || rawInput.structure === "Foliose" || rawInput.structure === "Fruticose" ? rawInput.structure : "Crustose",
      crystalsCount: typeof rawInput.crystalsCount === "number" ? Math.max(0, Math.trunc(rawInput.crystalsCount)) : 0,
      fungalBlooms: typeof rawInput.fungalBlooms === "number" ? Math.max(0, Math.trunc(rawInput.fungalBlooms)) : 0,
      colorMutationOffset: typeof rawInput.colorMutationOffset === "number" ? rawInput.colorMutationOffset : 0,
      observations: rawObservations.map((observation, index) => normalizeObservation(observation, rawInput.id as string, birthTime, index)),
      memories: Array.isArray(rawInput.memories) ? rawInput.memories : [],
      schemaVersion: CURRENT_STORAGE_VERSION,
      eventIds: Array.isArray(rawInput.eventIds) ? [...new Set(rawInput.eventIds.filter((id): id is string => typeof id === "string"))] : []
    };

    const parsed = SpecimenSchema.parse(migrated);
    validateSpecimen(parsed as Specimen);
    return parsed as Specimen;
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new MigrationError(`Structural validation conversion failure: ${message}`, rawInput);
  }
}

export class LocalStorageSpecimenRepository implements SpecimenRepository {
  private specimenKey = "lichen_vault_flora";
  private eventKey = "lichen_vault_events";
  private evidenceKey = "lichen_vault_evidence";
  private workflowKey = "lichen_vault_workflows";
  private traceKey = "lichen_vault_traces";
  private proposalKey = "lichen_vault_proposals";

  constructor(specimenKey?: string, eventKey?: string) {
    if (specimenKey) this.specimenKey = specimenKey;
    if (eventKey) this.eventKey = eventKey;
  }

  getRecoverySnapshot(error: unknown): RecoverySnapshot | null {
    if (!(error instanceof StorageCorruptionError)) return null;
    return {
      storageKey: error.storageKey,
      rawPayload: error.rawPayload,
      errorCode: error.code,
      reason: error.reason,
      recoverability: error.recoverability
    };
  }

  resetStorage(): void {
    localStorage.removeItem(this.specimenKey);
    localStorage.removeItem(this.eventKey);
    localStorage.removeItem(this.evidenceKey);
    localStorage.removeItem(this.workflowKey);
    localStorage.removeItem(this.traceKey);
    localStorage.removeItem(this.proposalKey);
  }

  private parseJson(rawPayload: string, storageKey: string): unknown {
    try {
      return JSON.parse(rawPayload);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new StorageCorruptionError(`Malformed JSON in ${storageKey}.`, storageKey, rawPayload, reason);
    }
  }

  private readSpecimenEnvelope(): Specimen[] {
    const rawPayload = localStorage.getItem(this.specimenKey);
    if (rawPayload === null) return [];
    const parsed = this.parseJson(rawPayload, this.specimenKey);

    if (Array.isArray(parsed)) {
      return parsed.map((raw) => migrateLichenOrganismToSpecimen(raw));
    }

    if (!isRecord(parsed)) {
      throw new StorageCorruptionError("Specimen storage envelope is not an object.", this.specimenKey, rawPayload, "Expected object or legacy array.");
    }
    if (typeof parsed.schemaVersion === "number" && parsed.schemaVersion > CURRENT_STORAGE_VERSION) {
      throw new StorageCorruptionError("Specimen storage uses an unsupported future schema version.", this.specimenKey, rawPayload, `schemaVersion=${parsed.schemaVersion}`, "unrecoverable");
    }

    const envelope = SpecimenStorageEnvelopeSchema.safeParse(parsed);
    if (!envelope.success) {
      throw new StorageCorruptionError("Specimen storage envelope failed validation.", this.specimenKey, rawPayload, envelope.error.message);
    }
    return envelope.data.specimens.map((specimen) => {
      validateSpecimen(specimen as Specimen);
      return specimen as Specimen;
    });
  }

  private readEventEnvelope(): SpecimenEvent[] {
    const rawPayload = localStorage.getItem(this.eventKey);
    if (rawPayload === null) return [];
    const parsed = this.parseJson(rawPayload, this.eventKey);

    const rawEvents = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && typeof parsed.schemaVersion === "number" && parsed.schemaVersion <= CURRENT_STORAGE_VERSION
        ? (() => {
            const envelope = SpecimenEventStorageEnvelopeSchema.safeParse(parsed);
            if (!envelope.success) {
              throw new StorageCorruptionError("Event storage envelope failed validation.", this.eventKey, rawPayload, envelope.error.message);
            }
            return envelope.data.events;
          })()
        : null;

    if (!rawEvents) {
      throw new StorageCorruptionError("Event storage envelope is not supported.", this.eventKey, rawPayload, "Expected legacy array or v2 envelope.");
    }

    return rawEvents.map((raw) => {
      const parsedEvent = SpecimenEventSchema.parse(raw) as SpecimenEvent;
      validateSpecimenEvent(parsedEvent);
      return parsedEvent;
    });
  }

  private writeSpecimens(specimens: Specimen[]): void {
    const envelope = SpecimenStorageEnvelopeSchema.parse({
      schemaVersion: CURRENT_STORAGE_VERSION,
      specimens
    });
    localStorage.setItem(this.specimenKey, JSON.stringify(envelope));
  }

  private writeEvents(events: SpecimenEvent[]): void {
    const envelope = SpecimenEventStorageEnvelopeSchema.parse({
      schemaVersion: CURRENT_STORAGE_VERSION,
      events
    });
    localStorage.setItem(this.eventKey, JSON.stringify(envelope));
  }

  private readEvidenceEnvelope(): EvidenceRecord[] {
    const rawPayload = localStorage.getItem(this.evidenceKey);
    if (rawPayload === null) return [];
    const parsed = this.parseJson(rawPayload, this.evidenceKey);
    const envelope = EvidenceStorageEnvelopeSchema.safeParse(parsed);
    if (!envelope.success) {
      throw new StorageCorruptionError("Evidence storage envelope failed validation.", this.evidenceKey, rawPayload, envelope.error.message);
    }
    return envelope.data.evidence.map((raw) => {
      const evidence = EvidenceRecordSchema.parse(raw) as EvidenceRecord;
      validateEvidenceRecord(evidence);
      return evidence;
    });
  }

  private writeEvidence(evidence: EvidenceRecord[]): void {
    const envelope = EvidenceStorageEnvelopeSchema.parse({
      schemaVersion: 1,
      evidence
    });
    localStorage.setItem(this.evidenceKey, JSON.stringify(envelope));
  }

  private readArrayEnvelope<T>(key: string, label: string, schemaVersion: 1 | 2, itemKey: string, itemSchema: { parse(value: unknown): T }, validate: (value: T) => void): T[] {
    const rawPayload = localStorage.getItem(key);
    if (rawPayload === null) return [];
    const parsed = this.parseJson(rawPayload, key);
    if (!isRecord(parsed) || parsed.schemaVersion !== schemaVersion || !Array.isArray(parsed[itemKey])) {
      throw new StorageCorruptionError(`${label} storage envelope failed validation.`, key, rawPayload, `Expected v${schemaVersion} ${itemKey} array.`);
    }
    return parsed[itemKey].map((raw) => {
      const item = itemSchema.parse(raw);
      validate(item);
      return item;
    });
  }

  private writeArrayEnvelope<T>(key: string, schemaVersion: 1 | 2, itemKey: string, items: T[]): void {
    localStorage.setItem(key, JSON.stringify({ schemaVersion, [itemKey]: items }));
  }

  async getSpecimen(id: string): Promise<Specimen | null> {
    return this.readSpecimenEnvelope().find((item) => item.id === id) ?? null;
  }

  async saveSpecimen(specimen: Specimen): Promise<void> {
    const parsed = SpecimenSchema.parse(specimen) as Specimen;
    validateSpecimen(parsed);
    const specimens = this.readSpecimenEnvelope();
    const index = specimens.findIndex((item) => item.id === parsed.id);
    const nextSpecimens = index >= 0
      ? specimens.map((item) => (item.id === parsed.id ? parsed : item))
      : [parsed, ...specimens];
    this.writeSpecimens(nextSpecimens);
  }

  async listSpecimens(): Promise<Specimen[]> {
    return this.readSpecimenEnvelope();
  }

  async appendEvent(event: SpecimenEvent): Promise<void> {
    const parsedEvent = SpecimenEventSchema.parse(event) as SpecimenEvent;
    validateSpecimenEvent(parsedEvent);

    const previousEventsRaw = localStorage.getItem(this.eventKey);
    const previousSpecimensRaw = localStorage.getItem(this.specimenKey);
    const events = this.readEventEnvelope();
    if (events.some((existing) => existing.id === parsedEvent.id)) {
      return;
    }

    const specimens = this.readSpecimenEnvelope();
    const targetIndex = specimens.findIndex((item) => item.id === parsedEvent.specimenId);
    const nextEvents = [...events, parsedEvent];
    const nextSpecimens = [...specimens];

    if (targetIndex >= 0) {
      const target = {
        ...nextSpecimens[targetIndex],
        eventIds: [...new Set([...nextSpecimens[targetIndex].eventIds, parsedEvent.id])]
      };
      validateSpecimen(target);
      nextSpecimens[targetIndex] = target;
    }

    try {
      this.writeEvents(nextEvents);
      this.writeSpecimens(nextSpecimens);
      const verifiedEvents = this.readEventEnvelope();
      const verifiedSpecimens = this.readSpecimenEnvelope();
      if (!verifiedEvents.some((stored) => stored.id === parsedEvent.id)) {
        throw new StorageError(`Staged event write did not verify for ${parsedEvent.id}.`);
      }
      if (targetIndex >= 0 && !verifiedSpecimens.find((stored) => stored.id === parsedEvent.specimenId)?.eventIds.includes(parsedEvent.id)) {
        throw new StorageError(`Staged specimen reference write did not verify for ${parsedEvent.id}.`);
      }
    } catch (error) {
      try {
        if (previousEventsRaw === null) localStorage.removeItem(this.eventKey);
        else localStorage.setItem(this.eventKey, previousEventsRaw);
        if (previousSpecimensRaw === null) localStorage.removeItem(this.specimenKey);
        else localStorage.setItem(this.specimenKey, previousSpecimensRaw);
      } catch (rollbackError) {
        throw new TransactionRollbackError("Transaction-like staged write failed and rollback also failed.", error, rollbackError);
      }
      throw new StorageError("Transaction-like staged write failed and rolled back.", error);
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
    let events = this.readEventEnvelope().filter((event) => event.specimenId === specimenId);
    if (options?.before) {
      const beforeTime = Date.parse(options.before);
      events = events.filter((event) => Date.parse(event.timestamp) < beforeTime);
    }
    if (options?.types && options.types.length > 0) {
      events = events.filter((event) => options.types!.includes(event.type));
    }
    events = [...events].sort((a, b) => {
      const timeDelta = Date.parse(a.timestamp) - Date.parse(b.timestamp);
      return timeDelta === 0 ? a.id.localeCompare(b.id) : timeDelta;
    });
    if (options?.limit !== undefined) {
      events = events.slice(-options.limit);
    }
    return events;
  }

  async appendEvidence(evidence: EvidenceRecord): Promise<void> {
    const parsed = EvidenceRecordSchema.parse(evidence) as EvidenceRecord;
    validateEvidenceRecord(parsed);
    const existing = this.readEvidenceEnvelope();
    if (existing.some((item) => item.id === parsed.id)) return;
    this.writeEvidence([...existing, parsed]);
  }

  async getEvidence(id: string): Promise<EvidenceRecord | null> {
    return this.readEvidenceEnvelope().find((item) => item.id === id) ?? null;
  }

  async listEvidence(specimenId: string): Promise<EvidenceRecord[]> {
    return this.readEvidenceEnvelope()
      .filter((item) => item.specimenId === specimenId)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id));
  }

  async saveWorkflow(session: WorkflowSession): Promise<void> {
    const parsed = WorkflowSessionSchema.parse(session) as WorkflowSession;
    validateWorkflowSession(parsed);
    const workflows = this.readArrayEnvelope(this.workflowKey, "Workflow", 1, "workflows", WorkflowSessionSchema, validateWorkflowSession);
    const next = workflows.some((item) => item.id === parsed.id)
      ? workflows.map((item) => item.id === parsed.id ? parsed : item)
      : [...workflows, parsed];
    this.writeArrayEnvelope(this.workflowKey, 1, "workflows", next);
  }

  async getWorkflow(id: string): Promise<WorkflowSession | null> {
    return this.readArrayEnvelope(this.workflowKey, "Workflow", 1, "workflows", WorkflowSessionSchema, validateWorkflowSession)
      .find((item) => item.id === id) ?? null;
  }

  async listWorkflows(specimenId: string): Promise<WorkflowSession[]> {
    return this.readArrayEnvelope(this.workflowKey, "Workflow", 1, "workflows", WorkflowSessionSchema, validateWorkflowSession)
      .filter((item) => item.specimenId === specimenId)
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id));
  }

  async appendTrace(trace: TraceEvent): Promise<void> {
    const parsed = TraceEventSchema.parse(trace) as TraceEvent;
    validateTraceEvent(parsed);
    const traces = this.readArrayEnvelope(this.traceKey, "Trace", 1, "traces", TraceEventSchema, validateTraceEvent);
    if (traces.some((item) => item.id === parsed.id)) return;
    this.writeArrayEnvelope(this.traceKey, 1, "traces", [...traces, parsed]);
  }

  async listTraces(specimenId: string, workflowId?: string): Promise<TraceEvent[]> {
    return this.readArrayEnvelope(this.traceKey, "Trace", 1, "traces", TraceEventSchema, validateTraceEvent)
      .filter((item) => item.specimenId === specimenId && (!workflowId || item.workflowId === workflowId))
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id));
  }

  async saveProposal(proposal: InterventionProposal): Promise<void> {
    const parsed = InterventionProposalSchema.parse(proposal) as InterventionProposal;
    validateInterventionProposal(parsed);
    const proposals = this.readArrayEnvelope(this.proposalKey, "Proposal", 1, "proposals", InterventionProposalSchema, validateInterventionProposal) as InterventionProposal[];
    const next = proposals.some((item) => item.id === parsed.id)
      ? proposals.map((item) => item.id === parsed.id ? parsed : item)
      : [...proposals, parsed];
    this.writeArrayEnvelope(this.proposalKey, 1, "proposals", next);
  }

  async getProposal(id: string): Promise<InterventionProposal | null> {
    return (this.readArrayEnvelope(this.proposalKey, "Proposal", 1, "proposals", InterventionProposalSchema, validateInterventionProposal) as InterventionProposal[])
      .find((item) => item.id === id) ?? null;
  }

  async listProposals(specimenId: string): Promise<InterventionProposal[]> {
    return (this.readArrayEnvelope(this.proposalKey, "Proposal", 1, "proposals", InterventionProposalSchema, validateInterventionProposal) as InterventionProposal[])
      .filter((item) => item.specimenId === specimenId)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  }
}
