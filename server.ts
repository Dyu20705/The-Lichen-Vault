import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { FunctionTool, InMemoryRunner, LlmAgent, stringifyContent } from "@google/adk";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const app = express();

type LogLevel = "info" | "warn" | "error";
type RateBucket = { resetAt: number; count: number };

function redactOperationalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactOperationalValue(item));
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (/api[_-]?key|authorization|secret|token|raw[_-]?audio|rawaudio|audio(bytes)?|mediastream/i.test(key)) {
        next[key] = "[redacted]";
      } else {
        next[key] = redactOperationalValue(child);
      }
    }
    return next;
  }
  if (typeof value === "string" && /api[_-]?key|authorization|secret|token|raw[_-]?audio|rawaudio/i.test(value)) {
    return "[redacted]";
  }
  return value;
}

function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const safeFields = redactOperationalValue(fields) as Record<string, unknown>;
  console[level](JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...safeFields
  }));
}

function readPort(value: string | undefined): number {
  const parsed = Number(value || 3000);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    log("warn", "invalid_port", { value, fallback: 3000 });
    return 3000;
  }
  return parsed;
}

function readPositiveInt(value: string | undefined, fallback: number, field: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    log("warn", "invalid_numeric_config", { field, fallback });
    return fallback;
  }
  return parsed;
}

const PORT = readPort(process.env.PORT);
const PROMPT_VERSION = "archivist.v1";
const MODEL_ID = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MODEL_TIMEOUT_MS = readPositiveInt(process.env.MODEL_TIMEOUT_MS, 8000, "MODEL_TIMEOUT_MS");
const MAX_MODEL_ATTEMPTS = readPositiveInt(process.env.MAX_MODEL_ATTEMPTS, 2, "MAX_MODEL_ATTEMPTS");
const MODEL_RATE_LIMIT_WINDOW_MS = readPositiveInt(process.env.MODEL_RATE_LIMIT_WINDOW_MS, 60_000, "MODEL_RATE_LIMIT_WINDOW_MS");
const MODEL_RATE_LIMIT_MAX = readPositiveInt(process.env.MODEL_RATE_LIMIT_MAX, 12, "MODEL_RATE_LIMIT_MAX");

const isProduction =
  process.env.NODE_ENV === "production" ||
  process.argv.includes("--production") ||
  process.env.npm_lifecycle_event === "start";

app.use(express.json({ limit: "128kb" }));

app.use((req, res, next) => {
  const requestId = req.header("x-request-id") || `req_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
});

const rateBuckets = new Map<string, RateBucket>();
function modelConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

function modelRateLimit(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!modelConfigured()) {
    next();
    return;
  }
  const key = req.ip || "local";
  const now = Date.now();
  const existing = rateBuckets.get(key);
  const bucket = existing && existing.resetAt > now ? existing : { resetAt: now + MODEL_RATE_LIMIT_WINDOW_MS, count: 0 };
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count > MODEL_RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader("Retry-After", String(retryAfterSeconds));
    log("warn", "archivist_rate_limited", {
      requestId: res.locals.requestId,
      operation: "archivist_observe",
      status: "rate_limited",
      retryAfterSeconds
    });
    res.status(429).json({
      error: "rate_limited",
      retryAfterSeconds,
      requestId: res.locals.requestId
    });
    return;
  }
  next();
}

const EvidenceIdSchema = z.string().regex(/^ev_[A-Za-z0-9_-]+$/);

const EvidenceForModelSchema = z.object({
  id: EvidenceIdSchema,
  sourceType: z.string().min(1),
  timestamp: z.string(),
  payload: z.record(z.string(), z.unknown())
});

const ArchivistRequestSchema = z.object({
  workflowId: z.string().min(1),
  specimen: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    structure: z.string().min(1),
    stageLabel: z.string().min(1)
  }),
  evidence: z.array(EvidenceForModelSchema).min(1)
});

const ArchivistModelOutputSchema = z.object({
  text: z.string().min(1).max(420),
  evidenceIds: z.array(EvidenceIdSchema).min(1).max(8)
}).superRefine((output, ctx) => {
  const uniqueEvidenceIds = new Set(output.evidenceIds);
  if (uniqueEvidenceIds.size !== output.evidenceIds.length) {
    ctx.addIssue({
      code: "custom",
      path: ["evidenceIds"],
      message: "Evidence references must not contain duplicates."
    });
  }
});

const ArchivistResponseSchema = z.object({
  text: z.string().min(1),
  evidenceIds: z.array(EvidenceIdSchema).default([]),
  verificationStatus: z.enum(["grounded", "fallback", "unverified"]),
  generatedBy: z.enum(["gemini", "local_fallback"]),
  promptVersion: z.string(),
  model: z.string(),
  fallbackReason: z.string().optional(),
  latencyMs: z.number().int().nonnegative().optional()
}).superRefine((response, ctx) => {
  const uniqueEvidenceIds = new Set(response.evidenceIds);
  if (uniqueEvidenceIds.size !== response.evidenceIds.length) {
    ctx.addIssue({
      code: "custom",
      path: ["evidenceIds"],
      message: "Evidence references must not contain duplicates."
    });
  }
  if (response.generatedBy === "gemini" && response.verificationStatus === "grounded" && response.evidenceIds.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["evidenceIds"],
      message: "Grounded responses require evidence references."
    });
  }
});

type ArchivistRequest = z.infer<typeof ArchivistRequestSchema>;

function localFallback(request: ArchivistRequest, reason: string, latencyMs?: number): z.infer<typeof ArchivistResponseSchema> {
  return {
    text: `The ${request.specimen.name} specimen remains stable under glass; ${request.specimen.stageLabel.toLowerCase()} structures are recorded without further inference.`,
    evidenceIds: request.evidence.map((item) => item.id),
    verificationStatus: "fallback",
    generatedBy: "local_fallback",
    promptVersion: PROMPT_VERSION,
    model: "local-fallback",
    fallbackReason: reason,
    latencyMs
  };
}

function cleanEvidencePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...payload };
  delete clone.rawAudio;
  delete clone.audio;
  delete clone.audioBytes;
  delete clone.mediaStream;
  return clone;
}

function createArchivistAgent(request: ArchivistRequest): LlmAgent {
  const evidenceManifest = request.evidence.map((item) => ({
    id: item.id,
    sourceType: item.sourceType,
    timestamp: item.timestamp,
    payload: cleanEvidencePayload(item.payload)
  }));
  const readEvidenceManifest = new FunctionTool({
    name: "read_evidence_manifest",
    description: "Return the validated evidence ids and non-audio evidence summaries available for this specimen.",
    parameters: z.object({}),
    execute: () => ({ evidence: evidenceManifest })
  });

  return new LlmAgent({
    name: "ArchivistAgent",
    description: "Writes a short evidence-grounded museum observation for a lichen specimen.",
    model: MODEL_ID,
    includeContents: "none",
    tools: [readEvidenceManifest],
    outputSchema: ArchivistModelOutputSchema,
    generateContentConfig: {
      temperature: 0.4,
      maxOutputTokens: 180
    },
    instruction: `You are the Archivist of The Lichen Vault.
Write one or two calm museum-ledger sentences about the supplied specimen.
Use only the evidence returned by read_evidence_manifest.
Do not make medical, psychological, respiratory-disease, stress, mood, or biological diagnosis claims.
Do not mention software, algorithms, prompts, or digital systems.
Return JSON matching the output schema. evidenceIds must be real ids from the evidence manifest.`
  });
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return extractJsonObject(fenced[1]);
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return null;
}

function extractEventText(event: unknown): string[] {
  const texts: string[] = [];
  const stringified = stringifyContent(event as Parameters<typeof stringifyContent>[0]);
  if (stringified) texts.push(stringified);
  const content = (event as { content?: { parts?: Array<{ text?: string }> } })?.content;
  for (const part of content?.parts ?? []) {
    if (typeof part.text === "string" && part.text.trim()) texts.push(part.text);
  }
  return texts;
}

function parseArchivistOutput(candidates: string[]): { text: string; evidenceIds: string[] } {
  for (const candidate of [...candidates].reverse()) {
    const json = extractJsonObject(candidate);
    if (!json) continue;
    try {
      return ArchivistModelOutputSchema.parse(JSON.parse(json));
    } catch {
      // Keep looking; ADK event streams can contain intermediate user/tool text.
    }
  }
  if (candidates.length === 0) throw new Error("model_returned_empty_content");
  throw new Error("model_returned_unparseable_json");
}

async function runAdkArchivist(request: ArchivistRequest, signal: AbortSignal): Promise<{ text: string; evidenceIds: string[] }> {
  if (!modelConfigured()) {
    throw new Error("model_not_configured");
  }
  if (signal.aborted) throw new Error("model_timeout");

  const runner = new InMemoryRunner({
    appName: "the-lichen-vault",
    agent: createArchivistAgent(request)
  });

  const textCandidates: string[] = [];
  for await (const event of runner.runEphemeral({
    userId: "local_curator",
    newMessage: {
      parts: [{
        text: JSON.stringify({
          specimen: request.specimen,
          evidenceIds: request.evidence.map((item) => item.id),
          promptVersion: PROMPT_VERSION
        })
      }]
    },
    stateDelta: {
      workflowId: request.workflowId,
      specimenId: request.specimen.id
    }
  })) {
    if (signal.aborted) throw new Error("model_timeout");
    textCandidates.push(...extractEventText(event));
  }

  return parseArchivistOutput(textCandidates);
}

function isRetryableModelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("model_not_configured")) return false;
  if (message.includes("model_referenced_missing_evidence")) return false;
  if (message.includes("model_returned_empty_content")) return true;
  if (message.includes("invalid") || message.includes("schema") || message.includes("json")) return false;
  return message.includes("timeout") || message.includes("fetch") || message.includes("network") || message.includes("rate") || message.includes("temporar");
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "the-lichen-vault",
    modelConfigured: modelConfigured(),
    adkPackage: "@google/adk",
    rateLimit: {
      modelWindowMs: MODEL_RATE_LIMIT_WINDOW_MS,
      modelMaxRequests: MODEL_RATE_LIMIT_MAX
    },
    time: new Date().toISOString()
  });
});

app.post("/api/archivist/observe", modelRateLimit, async (req, res) => {
  const started = Date.now();
  const requestId = res.locals.requestId;
  const parsed = ArchivistRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    log("warn", "archivist_request_invalid", { requestId, errorCategory: "validation", details: parsed.error.message });
    res.status(400).json(localFallback({
      workflowId: "invalid",
      specimen: { id: "invalid", name: "Uncatalogued specimen", structure: "unknown", stageLabel: "unknown" },
      evidence: [{ id: "ev_invalid_request", sourceType: "validation", timestamp: new Date().toISOString(), payload: {} }]
    }, "invalid_request", Date.now() - started));
    return;
  }

  const evidenceIds = new Set(parsed.data.evidence.map((item) => item.id));
  for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt += 1) {
    try {
      const modelOutput = await withTimeout((signal) => runAdkArchivist(parsed.data, signal));
      if (modelOutput.evidenceIds.some((id) => !evidenceIds.has(id))) {
        throw new Error("model_referenced_missing_evidence");
      }
      const response = ArchivistResponseSchema.parse({
        text: modelOutput.text,
        evidenceIds: modelOutput.evidenceIds,
        verificationStatus: "grounded",
        generatedBy: "gemini",
        promptVersion: PROMPT_VERSION,
        model: MODEL_ID,
        latencyMs: Date.now() - started
      });
      log("info", "archivist_observation_grounded", {
        requestId,
        workflowId: parsed.data.workflowId,
        operation: "archivist_observe",
        status: "succeeded",
        specimenId: parsed.data.specimen.id,
        model: MODEL_ID,
        promptVersion: PROMPT_VERSION,
        durationMs: response.latencyMs,
        attempt
      });
      res.json(response);
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "model_error";
      const retryable = isRetryableModelError(error);
      const finalAttempt = attempt === MAX_MODEL_ATTEMPTS || !retryable;
      log(finalAttempt ? "warn" : "info", "archivist_model_attempt_failed", {
        requestId,
        workflowId: parsed.data.workflowId,
        operation: "archivist_observe",
        status: finalAttempt ? "fallback" : "retrying",
        errorCategory: "model",
        fallbackReason: finalAttempt ? reason : undefined,
        reason,
        attempt,
        retryable
      });
      if (finalAttempt) {
        res.json(localFallback(parsed.data, reason, Date.now() - started));
        return;
      }
    }
  }
});

const GenerateFragmentRequestSchema = z.object({
  name: z.string().min(1),
  age: z.string().min(1),
  growthStage: z.string().min(1)
});

app.post("/api/generate-fragment", async (req, res) => {
  const parsed = GenerateFragmentRequestSchema.safeParse(req.body);
  const name = parsed.success ? parsed.data.name : "Uncatalogued specimen";
  const stage = parsed.success ? parsed.data.growthStage : "thallus";
  res.json({
    fragment: `The ${name} specimen remains under quiet observation; ${stage.toLowerCase()} changes require persisted evidence before further claims are entered.`,
    origin: "local_fallback",
    confidence: null,
    evidenceIds: [],
    verificationStatus: "fallback"
  });
});

async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    log("info", "server_started", { port: PORT, url: `http://localhost:${PORT}` });
  });
}

if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
  startServer();
}

export {
  app,
  isRetryableModelError,
  log,
  modelRateLimit,
  redactOperationalValue,
  startServer
};
