import fs from "fs/promises";
import path from "path";
import { z } from "zod";
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
import { StorageCorruptionError, StorageError } from "../../domain/errors";
import {
  EvidenceRecordSchema,
  InterventionProposalSchema,
  SpecimenEventSchema,
  SpecimenSchema,
  TraceEventSchema,
  WorkflowSessionSchema
} from "../../shared/schemas";
import { SpecimenRepository } from "./specimenRepository";

const CURRENT_FILE_SCHEMA_VERSION = 1;
const SENSITIVE_FIELD_PATTERN = /api[_-]?key|authorization|secret|approval[_-]?token|token|raw[_-]?audio|rawaudio|audio(bytes)?|mediastream|raw[_-]?prompt|model[_-]?prompt/i;

const JsonVaultSchema = z.object({
  schemaVersion: z.literal(CURRENT_FILE_SCHEMA_VERSION),
  specimens: z.array(SpecimenSchema).default([]),
  events: z.array(SpecimenEventSchema).default([]),
  evidence: z.array(EvidenceRecordSchema).default([]),
  workflows: z.array(WorkflowSessionSchema).default([]),
  traces: z.array(TraceEventSchema).default([]),
  proposals: z.array(InterventionProposalSchema).default([])
});

type JsonVault = {
  schemaVersion: 1;
  specimens: Specimen[];
  events: SpecimenEvent[];
  evidence: EvidenceRecord[];
  workflows: WorkflowSession[];
  traces: TraceEvent[];
  proposals: InterventionProposal[];
};

export type JsonVaultImportData = {
  specimen: Specimen;
  events: SpecimenEvent[];
  evidence: EvidenceRecord[];
  workflows: WorkflowSession[];
  traces: TraceEvent[];
  proposals: InterventionProposal[];
};

function emptyVault(): JsonVault {
  return {
    schemaVersion: CURRENT_FILE_SCHEMA_VERSION,
    specimens: [],
    events: [],
    evidence: [],
    workflows: [],
    traces: [],
    proposals: []
  };
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameContent(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

export function scrubPersistentValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => scrubPersistentValue(item)) as T;
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_FIELD_PATTERN.test(key)) continue;
      next[key] = scrubPersistentValue(child);
    }
    return next as T;
  }
  return value;
}

function assertUnique<T>(items: T[], idFor: (item: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const id = idFor(item);
    if (seen.has(id)) throw new StorageError(`Duplicate ${label} id ${id} in JSON vault.`);
    seen.add(id);
  }
}

function validateVault(vault: JsonVault, options: { strictCrossReferences?: boolean } = {}): JsonVault {
  assertUnique(vault.specimens, (item) => item.id, "specimen");
  assertUnique(vault.events, (item) => item.id, "event");
  assertUnique(vault.evidence, (item) => item.id, "evidence");
  assertUnique(vault.workflows, (item) => item.id, "workflow");
  assertUnique(vault.traces, (item) => item.id, "trace");
  assertUnique(vault.proposals, (item) => item.id, "proposal");

  vault.evidence.forEach((item) => validateEvidenceRecord(item as EvidenceRecord));
  vault.specimens.forEach((item) => validateSpecimen(item as Specimen));
  vault.events.forEach((item) => validateSpecimenEvent(item as SpecimenEvent));
  vault.workflows.forEach((item) => validateWorkflowSession(item as WorkflowSession));
  vault.traces.forEach((item) => validateTraceEvent(item as TraceEvent));
  vault.proposals.forEach((item) => validateInterventionProposal(item as InterventionProposal));

  for (const specimen of vault.specimens as Specimen[]) {
    assertSpecimenObservationEvidence(vault, specimen);
  }
  for (const proposal of vault.proposals as InterventionProposal[]) {
    assertProposalEvidence(vault, proposal);
  }
  if (options.strictCrossReferences) {
    assertVaultCrossReferences(vault);
  }

  return vault;
}

function assertEvidenceIdsResolve(vault: JsonVault, specimenId: string, evidenceIds: string[], label: string): void {
  const evidence = evidenceIds.map((id) => vault.evidence.find((item) => item.id === id) ?? null);
  const missing = evidenceIds.filter((_, index) => evidence[index] === null);
  if (missing.length > 0) throw new StorageError(`${label} references missing evidence: ${missing.join(", ")}`);
  if (evidence.some((item) => item && item.specimenId !== specimenId)) {
    throw new StorageError(`${label} evidence references must belong to the same specimen.`);
  }
}

function assertVaultCrossReferences(vault: JsonVault): void {
  const specimenIds = new Set(vault.specimens.map((item) => item.id));
  const eventById = new Map(vault.events.map((item) => [item.id, item]));
  const traceById = new Map(vault.traces.map((item) => [item.id, item]));

  for (const specimen of vault.specimens) {
    const missingEvents = specimen.eventIds.filter((id) => !eventById.has(id));
    if (missingEvents.length > 0) throw new StorageError(`Specimen ${specimen.id} references missing events: ${missingEvents.join(", ")}`);
    const wrongEvents = specimen.eventIds
      .map((id) => eventById.get(id))
      .filter((item): item is SpecimenEvent => !!item && item.specimenId !== specimen.id);
    if (wrongEvents.length > 0) throw new StorageError(`Specimen ${specimen.id} event references must belong to the same specimen.`);
  }

  for (const event of vault.events) {
    if (!specimenIds.has(event.specimenId)) throw new StorageError(`Event ${event.id} references missing specimen ${event.specimenId}.`);
    assertEvidenceIdsResolve(vault, event.specimenId, event.evidenceIds, `Event ${event.id}`);
  }

  for (const evidence of vault.evidence) {
    if (!specimenIds.has(evidence.specimenId)) throw new StorageError(`Evidence ${evidence.id} references missing specimen ${evidence.specimenId}.`);
  }

  for (const workflow of vault.workflows) {
    if (!specimenIds.has(workflow.specimenId)) throw new StorageError(`Workflow ${workflow.id} references missing specimen ${workflow.specimenId}.`);
    const missingTraces = workflow.traceIds.filter((id) => !traceById.has(id));
    if (missingTraces.length > 0) throw new StorageError(`Workflow ${workflow.id} references missing traces: ${missingTraces.join(", ")}`);
    const wrongTraces = workflow.traceIds
      .map((id) => traceById.get(id))
      .filter((item): item is TraceEvent => !!item && (item.workflowId !== workflow.id || item.specimenId !== workflow.specimenId));
    if (wrongTraces.length > 0) throw new StorageError(`Workflow ${workflow.id} trace references must belong to the same workflow and specimen.`);
  }

  for (const trace of vault.traces) {
    if (!specimenIds.has(trace.specimenId)) throw new StorageError(`Trace ${trace.id} references missing specimen ${trace.specimenId}.`);
    assertEvidenceIdsResolve(vault, trace.specimenId, [...trace.inputEvidenceIds, ...trace.outputEvidenceIds], `Trace ${trace.id}`);
  }

  for (const proposal of vault.proposals) {
    if (!specimenIds.has(proposal.specimenId)) throw new StorageError(`Proposal ${proposal.id} references missing specimen ${proposal.specimenId}.`);
  }
}

function assertSpecimenObservationEvidence(vault: JsonVault, specimen: Specimen): void {
  for (const observation of specimen.observations) {
    const evidenceIds = observation.evidenceIds ?? [];
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      throw new StorageError("Observation evidence references must not contain duplicates.");
    }
    if (observation.verificationStatus !== "grounded") continue;
    const records = evidenceIds.map((id) => vault.evidence.find((item) => item.id === id) ?? null);
    const missing = evidenceIds.filter((_, index) => records[index] === null);
    if (missing.length > 0) throw new StorageError(`Missing evidence references: ${missing.join(", ")}`);
    if (records.some((item) => item && item.specimenId !== specimen.id)) {
      throw new StorageError("Observation evidence references must belong to the saved specimen.");
    }
  }
}

function assertProposalEvidence(vault: JsonVault, proposal: InterventionProposal): void {
  if (new Set(proposal.evidenceIds).size !== proposal.evidenceIds.length) {
    throw new StorageError("Proposal evidence references must not contain duplicates.");
  }
  const records = proposal.evidenceIds.map((id) => vault.evidence.find((item) => item.id === id) ?? null);
  const missing = proposal.evidenceIds.filter((_, index) => records[index] === null);
  if (missing.length > 0) throw new StorageError(`Missing evidence references: ${missing.join(", ")}`);
  if (records.some((item) => item && item.specimenId !== proposal.specimenId)) {
    throw new StorageError("Proposal evidence references must belong to the proposal specimen.");
  }
}

export class JsonFileSpecimenRepository implements SpecimenRepository {
  readonly filePath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  async getSpecimen(id: string): Promise<Specimen | null> {
    const vault = await this.readVault();
    const specimen = vault.specimens.find((item) => item.id === id);
    return specimen ? deepClone(specimen as Specimen) : null;
  }

  async saveSpecimen(specimen: Specimen): Promise<void> {
    const parsed = SpecimenSchema.parse(scrubPersistentValue(specimen)) as Specimen;
    validateSpecimen(parsed);
    await this.updateVault((vault) => {
      assertSpecimenObservationEvidence(vault, parsed);
      const index = vault.specimens.findIndex((item) => item.id === parsed.id);
      vault.specimens = index >= 0
        ? vault.specimens.map((item) => item.id === parsed.id ? parsed : item)
        : [parsed, ...vault.specimens];
    });
  }

  async listSpecimens(): Promise<Specimen[]> {
    return (await this.readVault()).specimens.map((item) => deepClone(item as Specimen));
  }

  async appendEvent(event: SpecimenEvent): Promise<void> {
    const parsed = SpecimenEventSchema.parse(scrubPersistentValue(event)) as SpecimenEvent;
    validateSpecimenEvent(parsed);
    await this.updateVault((vault) => {
      const existing = vault.events.find((item) => item.id === parsed.id);
      if (existing) {
        if (stableJson(existing) === stableJson(parsed)) {
          vault.specimens = vault.specimens.map((item) => item.id === parsed.specimenId
            ? { ...item, eventIds: item.eventIds.includes(parsed.id) ? item.eventIds : [...item.eventIds, parsed.id] }
            : item);
          return;
        }
        throw new StorageError(`Event id ${parsed.id} already exists with different content.`);
      }
      vault.events = [...vault.events, parsed];
      vault.specimens = vault.specimens.map((item) => item.id === parsed.specimenId
        ? { ...item, eventIds: item.eventIds.includes(parsed.id) ? item.eventIds : [...item.eventIds, parsed.id] }
        : item);
    });
  }

  async listEvents(specimenId: string, options?: { limit?: number; before?: string; types?: SpecimenEvent["type"][] }): Promise<SpecimenEvent[]> {
    let events = (await this.readVault()).events.filter((item) => item.specimenId === specimenId);
    if (options?.before) {
      const before = Date.parse(options.before);
      events = events.filter((item) => Date.parse(item.timestamp) < before);
    }
    if (options?.types?.length) events = events.filter((item) => options.types!.includes(item.type));
    events = [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id));
    if (options?.limit !== undefined) events = events.slice(-options.limit);
    return events.map((item) => deepClone(item as SpecimenEvent));
  }

  async appendEvidence(evidence: EvidenceRecord): Promise<void> {
    const parsed = EvidenceRecordSchema.parse(scrubPersistentValue(evidence)) as EvidenceRecord;
    validateEvidenceRecord(parsed);
    await this.updateVault((vault) => {
      const existing = vault.evidence.find((item) => item.id === parsed.id);
      if (existing) {
        if (stableJson(existing) === stableJson(parsed)) return;
        throw new StorageError(`Evidence id ${parsed.id} already exists with different content.`);
      }
      vault.evidence = [...vault.evidence, parsed]
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id));
    });
  }

  async getEvidence(id: string): Promise<EvidenceRecord | null> {
    const evidence = (await this.readVault()).evidence.find((item) => item.id === id);
    return evidence ? deepClone(evidence as EvidenceRecord) : null;
  }

  async listEvidence(specimenId: string): Promise<EvidenceRecord[]> {
    return (await this.readVault()).evidence
      .filter((item) => item.specimenId === specimenId)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id))
      .map((item) => deepClone(item as EvidenceRecord));
  }

  async saveWorkflow(session: WorkflowSession): Promise<void> {
    const parsed = WorkflowSessionSchema.parse(scrubPersistentValue(session)) as WorkflowSession;
    validateWorkflowSession(parsed);
    await this.updateVault((vault) => {
      vault.workflows = vault.workflows.some((item) => item.id === parsed.id)
        ? vault.workflows.map((item) => item.id === parsed.id ? parsed : item)
        : [...vault.workflows, parsed];
    });
  }

  async getWorkflow(id: string): Promise<WorkflowSession | null> {
    const workflow = (await this.readVault()).workflows.find((item) => item.id === id);
    return workflow ? deepClone(workflow as WorkflowSession) : null;
  }

  async listWorkflows(specimenId: string): Promise<WorkflowSession[]> {
    return (await this.readVault()).workflows
      .filter((item) => item.specimenId === specimenId)
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id))
      .map((item) => deepClone(item as WorkflowSession));
  }

  async appendTrace(trace: TraceEvent): Promise<void> {
    const parsed = TraceEventSchema.parse(scrubPersistentValue(trace)) as TraceEvent;
    validateTraceEvent(parsed);
    await this.updateVault((vault) => {
      const existing = vault.traces.find((item) => item.id === parsed.id);
      if (existing) {
        if (stableJson(existing) === stableJson(parsed)) return;
        throw new StorageError(`Trace id ${parsed.id} already exists with different content.`);
      }
      vault.traces = [...vault.traces, parsed];
    });
  }

  async listTraces(specimenId: string, workflowId?: string): Promise<TraceEvent[]> {
    return (await this.readVault()).traces
      .filter((item) => item.specimenId === specimenId && (!workflowId || item.workflowId === workflowId))
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id))
      .map((item) => deepClone(item as TraceEvent));
  }

  async saveProposal(proposal: InterventionProposal): Promise<void> {
    const parsed = InterventionProposalSchema.parse(scrubPersistentValue(proposal)) as InterventionProposal;
    validateInterventionProposal(parsed);
    await this.updateVault((vault) => {
      assertProposalEvidence(vault, parsed);
      vault.proposals = vault.proposals.some((item) => item.id === parsed.id)
        ? vault.proposals.map((item) => item.id === parsed.id ? parsed : item)
        : [...vault.proposals, parsed];
    });
  }

  async getProposal(id: string): Promise<InterventionProposal | null> {
    const proposal = (await this.readVault()).proposals.find((item) => item.id === id);
    return proposal ? deepClone(proposal as InterventionProposal) : null;
  }

  async listProposals(specimenId: string): Promise<InterventionProposal[]> {
    return (await this.readVault()).proposals
      .filter((item) => item.specimenId === specimenId)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
      .map((item) => deepClone(item as InterventionProposal));
  }

  async importVaultData(data: JsonVaultImportData): Promise<void> {
    const parsed = this.parseImportData(data);
    await this.updateVault((vault) => {
      mergeUnique(vault.evidence, parsed.evidence, (item) => item.id, "evidence");
      mergeUnique(vault.specimens, [parsed.specimen], (item) => item.id, "specimen");
      mergeUnique(vault.events, parsed.events, (item) => item.id, "event");
      mergeUnique(vault.workflows, parsed.workflows, (item) => item.id, "workflow");
      mergeUnique(vault.traces, parsed.traces, (item) => item.id, "trace");
      mergeUnique(vault.proposals, parsed.proposals, (item) => item.id, "proposal");
      vault.evidence = vault.evidence.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id));
      vault.events = vault.events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id));
      vault.workflows = vault.workflows.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id));
      vault.traces = vault.traces.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id));
      vault.proposals = vault.proposals.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
    }, { strictCrossReferences: true });
  }

  private async updateVault(mutator: (vault: JsonVault) => void, options: { strictCrossReferences?: boolean } = {}): Promise<void> {
    await this.withMutationLock(async () => {
      const vault = await this.readVault();
      mutator(vault);
      await this.writeVault(validateVault(JsonVaultSchema.parse(scrubPersistentValue(vault)) as unknown as JsonVault, options));
    });
  }

  private async readVault(): Promise<JsonVault> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyVault();
      throw new StorageError(`Could not read MCP vault file ${this.filePath}.`, error);
    }

    try {
      const parsed = JSON.parse(raw);
      return validateVault(JsonVaultSchema.parse(parsed) as unknown as JsonVault);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new StorageCorruptionError("MCP JSON vault file is corrupt or unsupported.", this.filePath, raw, reason, "unrecoverable");
    }
  }

  private async writeVault(vault: JsonVault): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const unique = `${process.pid}.${Date.now()}.${Math.floor(Math.random() * 1_000_000)}`;
    const tempPath = `${this.filePath}.${unique}.tmp`;
    const backupPath = `${this.filePath}.${unique}.bak`;
    const payload = `${JSON.stringify(vault, null, 2)}\n`;
    let backupCreated = false;
    try {
      await fs.writeFile(tempPath, payload, { encoding: "utf8", flag: "wx" });
      try {
        await fs.rename(tempPath, this.filePath);
      } catch (renameError) {
        const code = (renameError as NodeJS.ErrnoException).code;
        if (code !== "EEXIST" && code !== "EPERM") throw renameError;
        try {
          await fs.rename(this.filePath, backupPath);
          backupCreated = true;
        } catch (backupError) {
          if ((backupError as NodeJS.ErrnoException).code !== "ENOENT") throw backupError;
        }
        try {
          await fs.rename(tempPath, this.filePath);
          if (backupCreated) await fs.rm(backupPath, { force: true });
        } catch (replaceError) {
          if (backupCreated) {
            await fs.rename(backupPath, this.filePath).catch(() => {});
          }
          throw replaceError;
        }
      }
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      if (backupCreated) await fs.rm(backupPath, { force: true }).catch(() => {});
      throw new StorageError(`Could not atomically write MCP vault file ${this.filePath}.`, error);
    }
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release!: () => void;
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private parseImportData(data: JsonVaultImportData): JsonVaultImportData {
    const scrubbed = scrubPersistentValue(data);
    const parsed: JsonVaultImportData = {
      specimen: SpecimenSchema.parse(scrubbed.specimen) as Specimen,
      events: scrubbed.events.map((item) => SpecimenEventSchema.parse(item) as SpecimenEvent),
      evidence: scrubbed.evidence.map((item) => EvidenceRecordSchema.parse(item) as EvidenceRecord),
      workflows: scrubbed.workflows.map((item) => WorkflowSessionSchema.parse(item) as WorkflowSession),
      traces: scrubbed.traces.map((item) => TraceEventSchema.parse(item) as TraceEvent),
      proposals: scrubbed.proposals.map((item) => InterventionProposalSchema.parse(item) as InterventionProposal)
    };
    validateSpecimen(parsed.specimen);
    parsed.events.forEach(validateSpecimenEvent);
    parsed.evidence.forEach(validateEvidenceRecord);
    parsed.workflows.forEach(validateWorkflowSession);
    parsed.traces.forEach(validateTraceEvent);
    parsed.proposals.forEach(validateInterventionProposal);
    validateVault({
      schemaVersion: CURRENT_FILE_SCHEMA_VERSION,
      specimens: [parsed.specimen],
      events: parsed.events,
      evidence: parsed.evidence,
      workflows: parsed.workflows,
      traces: parsed.traces,
      proposals: parsed.proposals
    }, { strictCrossReferences: true });
    return parsed;
  }
}

function mergeUnique<T>(target: T[], incoming: T[], idFor: (item: T) => string, label: string): void {
  const index = new Map(target.map((item) => [idFor(item), item]));
  const incomingSeen = new Map<string, T>();
  for (const item of incoming) {
    const id = idFor(item);
    const duplicateInImport = incomingSeen.get(id);
    if (duplicateInImport && !sameContent(duplicateInImport, item)) {
      throw new StorageError(`Import contains conflicting duplicate ${label} id ${id}.`);
    }
    incomingSeen.set(id, item);

    const existing = index.get(id);
    if (existing) {
      if (!sameContent(existing, item)) throw new StorageError(`${label} id ${id} already exists with different content.`);
      continue;
    }
    target.push(item);
    index.set(id, item);
  }
}
