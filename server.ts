import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { FunctionTool, InMemoryRunner, LlmAgent, stringifyContent } from "@google/adk";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const app = express();

function readPort(value: string | undefined): number {
  const parsed = Number(value || 3000);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    log("warn", "invalid_port", { value: redact(value), fallback: 3000 });
    return 3000;
  }
  return parsed;
}

const PORT = readPort(process.env.PORT);
const PROMPT_VERSION = "archivist.v1";
const MODEL_ID = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 8000);
const MAX_MODEL_ATTEMPTS = 2;

const isProduction =
  process.env.NODE_ENV === "production" ||
  process.argv.includes("--production") ||
  process.env.npm_lifecycle_event === "start";

app.use(express.json({ limit: "128kb" }));

function redact(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length <= 6) return value ? "[redacted]" : value;
  return `${value.slice(0, 2)}...[redacted]...${value.slice(-2)}`;
}

function log(level: "info" | "warn" | "error", message: string, fields: Record<string, unknown> = {}): void {
  const safeFields = { ...fields };
  delete safeFields.rawAudio;
  delete safeFields.audio;
  console[level](JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...safeFields
  }));
}

app.use((req, res, next) => {
  const requestId = req.header("x-request-id") || `req_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
});

const rateBuckets = new Map<string, { resetAt: number; count: number }>();
function modelRateLimit(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const key = req.ip || "local";
  const now = Date.now();
  const existing = rateBuckets.get(key);
  const bucket = existing && existing.resetAt > now ? existing : { resetAt: now + 60_000, count: 0 };
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count > 12) {
    res.status(429).json({ error: "rate_limited", requestId: res.locals.requestId });
    return;
  }
  next();
}

const EvidenceForModelSchema = z.object({
  id: z.string().min(1),
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
  evidenceIds: z.array(z.string()).min(1).max(8)
});

const ArchivistResponseSchema = z.object({
  text: z.string().min(1),
  evidenceIds: z.array(z.string()).default([]),
  verificationStatus: z.enum(["grounded", "fallback", "unverified"]),
  generatedBy: z.enum(["gemini", "local_fallback"]),
  promptVersion: z.string(),
  model: z.string(),
  fallbackReason: z.string().optional(),
  latencyMs: z.number().int().nonnegative().optional()
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

async function runAdkArchivist(request: ArchivistRequest, signal: AbortSignal): Promise<{ text: string; evidenceIds: string[] }> {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    throw new Error("model_not_configured");
  }
  if (signal.aborted) throw new Error("model_timeout");

  const runner = new InMemoryRunner({
    appName: "the-lichen-vault",
    agent: createArchivistAgent(request)
  });

  let finalText = "";
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
    finalText = stringifyContent(event) || finalText;
  }

  const parsed = ArchivistModelOutputSchema.parse(JSON.parse(finalText));
  return parsed;
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
    modelConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    adkPackage: "@google/adk",
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
      evidence: [{ id: "invalid", sourceType: "validation", timestamp: new Date().toISOString(), payload: {} }]
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
        specimenId: parsed.data.specimen.id,
        model: MODEL_ID,
        promptVersion: PROMPT_VERSION,
        latencyMs: response.latencyMs,
        attempt
      });
      res.json(response);
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "model_error";
      log(attempt === MAX_MODEL_ATTEMPTS ? "warn" : "info", "archivist_model_attempt_failed", {
        requestId,
        workflowId: parsed.data.workflowId,
        errorCategory: "model",
        reason,
        attempt
      });
      if (attempt === MAX_MODEL_ATTEMPTS) {
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

startServer();
