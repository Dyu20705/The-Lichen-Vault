import http from "http";
import dotenv from "dotenv";

dotenv.config();
const hasKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(api[_-]?key|authorization|secret|token)=?[^\s,}]+/gi, "$1=[redacted]");
}

if (!hasKey) {
  console.log(JSON.stringify({
    ok: true,
    status: "skipped",
    reason: "No GEMINI_API_KEY or GOOGLE_API_KEY configured."
  }, null, 2));
  process.exit(0);
}

process.env.NODE_ENV = "test";
process.env.MODEL_TIMEOUT_MS = process.env.MODEL_TIMEOUT_MS || "12000";
process.env.MAX_MODEL_ATTEMPTS = process.env.MAX_MODEL_ATTEMPTS || "2";

const { app } = await import("../../server");

const evidence = [{
  id: "ev_smoke_breath",
  sourceType: "breath_capture",
  timestamp: "2026-06-30T00:00:00.000Z",
  payload: {
    captureMode: "simulated",
    breathCount: 3,
    totalDuration: 7.1,
    averageIntensity: 46,
    cadence: "even"
  }
}, {
  id: "ev_smoke_growth",
  sourceType: "growth_simulation",
  timestamp: "2026-06-30T00:00:01.000Z",
  payload: {
    algorithmVersion: "growth-simulator.v1",
    seed: 20705,
    structure: "Foliose"
  }
}];

const requestBody = {
  workflowId: "wf_smoke_adk",
  specimen: {
    id: "lichen_smoke_adk",
    name: "Umbilicaria smoketestia",
    structure: "Foliose",
    stageLabel: "contained digital thallus"
  },
  evidence
};

if (/rawAudio|audioBytes|mediaStream/i.test(JSON.stringify(requestBody))) {
  console.error(JSON.stringify({ ok: false, status: "failed", error: "Smoke request contains raw audio fields." }, null, 2));
  process.exit(1);
}

const server = await new Promise<http.Server>((resolve, reject) => {
  const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  listening.on("error", reject);
});
try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not bind smoke server.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const response = await fetch(`http://127.0.0.1:${address.port}/api/archivist/observe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-request-id": "smoke_adk" },
    body: JSON.stringify(requestBody),
    signal: controller.signal
  });
  clearTimeout(timeout);
  const body = await response.json();
  if (!response.ok) throw new Error(`Archivist endpoint returned ${response.status}.`);
  if (!body || typeof body !== "object") throw new Error("Archivist response was not an object.");
  if (!["grounded", "fallback"].includes(body.verificationStatus)) {
    throw new Error("Archivist response had an invalid verification status.");
  }
  const evidenceIds = new Set(evidence.map((item) => item.id));
  if (Array.isArray(body.evidenceIds) && body.evidenceIds.some((id) => !evidenceIds.has(id))) {
    throw new Error("Archivist response cited nonexistent evidence.");
  }
  if (/rawAudio|audioBytes|mediaStream|GEMINI_API_KEY|GOOGLE_API_KEY/i.test(JSON.stringify(body))) {
    throw new Error("Archivist response exposed sensitive fields.");
  }
  console.log(JSON.stringify({
    ok: true,
    status: "passed",
    result: body.generatedBy === "gemini" && body.verificationStatus === "grounded" ? "grounded" : "local_fallback",
    evidenceIds: body.evidenceIds ?? [],
    model: body.model
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    status: "failed",
    error: sanitizeError(error)
  }, null, 2));
  process.exitCode = 1;
} finally {
  await new Promise<void>((resolve) => (server as http.Server).close(() => resolve()));
}
