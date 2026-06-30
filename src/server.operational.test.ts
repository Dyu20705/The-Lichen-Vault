import { createServer, Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

type TestResponse = {
  status: number;
  headers: Headers;
  body: string;
  json: any;
};

let server: Server | undefined;

async function loadServer(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VITEST", "true");
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      vi.stubEnv(key, "");
    } else {
      vi.stubEnv(key, value);
    }
  }
  return import("../server");
}

async function startApp(app: any): Promise<string> {
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port.");
  return `http://127.0.0.1:${address.port}`;
}

async function request(baseUrl: string, path: string, init?: RequestInit): Promise<TestResponse> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body,
    json: body ? JSON.parse(body) : null
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (server) {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    }
    server = undefined;
  }
});

describe("server operational hardening", () => {
  it("health endpoint returns safe operational state only", async () => {
    const { app } = await loadServer({ GEMINI_API_KEY: "SECRET_KEY" });
    const baseUrl = await startApp(app);
    const response = await request(baseUrl, "/health");

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      status: "ok",
      service: "the-lichen-vault",
      modelConfigured: true,
      adkPackage: "@google/adk"
    });
    expect(response.json.rateLimit.modelMaxRequests).toBeGreaterThan(0);
    expect(response.body).not.toContain("SECRET_KEY");
    expect(response.body).not.toContain("GEMINI_API_KEY");
  }, 15_000);

  it("redacts secrets and raw audio from structured logs", async () => {
    const { redactOperationalValue } = await loadServer();
    const redacted = redactOperationalValue({
      apiKey: "SECRET_KEY",
      authorization: "Bearer SECRET",
      rawAudio: "SECRET_AUDIO",
      nested: { token: "SECRET_TOKEN", visible: "ok" }
    });
    const serialized = JSON.stringify(redacted);

    expect(serialized).toContain("ok");
    expect(serialized).not.toContain("SECRET_KEY");
    expect(serialized).not.toContain("Bearer SECRET");
    expect(serialized).not.toContain("SECRET_AUDIO");
    expect(serialized).not.toContain("SECRET_TOKEN");
  }, 15_000);

  it("missing model configuration returns fallback and bypasses model rate limiting", async () => {
    const { app } = await loadServer({
      GEMINI_API_KEY: "",
      GOOGLE_API_KEY: "",
      MODEL_RATE_LIMIT_MAX: "1"
    });
    const baseUrl = await startApp(app);
    const payload = {
      workflowId: "wf_no_key",
      specimen: {
        id: "sp_no_key",
        name: "Umbilicaria noxia",
        structure: "Foliose",
        stageLabel: "Young thallus"
      },
      evidence: [{
        id: "ev_no_key_signal",
        sourceType: "signal_analysis",
        timestamp: "2026-06-30T00:00:00.000Z",
        payload: { signalQuality: 0.7 }
      }]
    };

    const first = await request(baseUrl, "/api/archivist/observe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const second = await request(baseUrl, "/api/archivist/observe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.json).toMatchObject({
      generatedBy: "local_fallback",
      verificationStatus: "fallback",
      fallbackReason: "model_not_configured"
    });
    expect(second.json.generatedBy).toBe("local_fallback");
  }, 15_000);

  it("configured model endpoint returns clear rate-limit responses", async () => {
    const { app } = await loadServer({
      GEMINI_API_KEY: "fake-key-for-rate-limit",
      MODEL_RATE_LIMIT_MAX: "1",
      MODEL_RATE_LIMIT_WINDOW_MS: "60000"
    });
    const baseUrl = await startApp(app);
    const invalidPayload = { invalid: true };

    const first = await request(baseUrl, "/api/archivist/observe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(invalidPayload)
    });
    const second = await request(baseUrl, "/api/archivist/observe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(invalidPayload)
    });

    expect(first.status).toBe(400);
    expect(second.status).toBe(429);
    expect(second.json).toMatchObject({
      error: "rate_limited"
    });
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
  }, 15_000);

  it("classifies deterministic model failures as non-retryable", async () => {
    const { isRetryableModelError } = await loadServer();

    expect(isRetryableModelError(new Error("model_not_configured"))).toBe(false);
    expect(isRetryableModelError(new Error("model_referenced_missing_evidence"))).toBe(false);
    expect(isRetryableModelError(new Error("JSON parse failed"))).toBe(false);
    expect(isRetryableModelError(new Error("network timeout"))).toBe(true);
  }, 15_000);
});
