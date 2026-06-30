# Evaluation Harness

The primary evaluation suite runs without Gemini or any real model key:

```bash
npm run eval
```

The harness uses fake model injection, mocked fetch responses, local in-memory repositories, and isolated localStorage shims. It does not require network access or a Gemini API key.

## Scenario Matrix

| Scenario | Test coverage | Expected result |
| --- | --- | --- |
| Observation cannot reference missing evidence | `workflow.evaluation.test.ts` evidence reference rejection | Policy rejects missing `ev_` reference. |
| Missing model configuration causes fallback | `server.operational.test.ts` no-key endpoint test | `/api/archivist/observe` returns `local_fallback`. |
| Model timeout causes fallback | `workflow.evaluation.test.ts` timeout adapter test | Fallback observation and fallback trace. |
| Invalid model output causes fallback | `workflow.evaluation.test.ts` invalid endpoint response test | Fallback observation. |
| Corrupted storage is not automatically deleted | `workflow.evaluation.test.ts` corrupt localStorage test | Typed corruption error and payload preserved. |
| High-risk proposal is not auto-executed | `workflow.evaluation.test.ts` high-risk proposal test | Pending proposal, no decision event. |
| Agent cannot approve its own proposal | `workflow.evaluation.test.ts` agent context test | Policy rejects non-user context. |
| Same seed and normalized evidence produce same growth | `workflow.evaluation.test.ts` deterministic growth test | Identical growth result. |
| Repeated approval/rejection does not duplicate decisions | `workflow.evaluation.test.ts`, `vaultInspection.test.ts`, `vaultTools.test.ts` | Existing decision is idempotent; duplicate event is not appended. |
| MCP write cannot bypass schemas | `vaultTools.test.ts` and repository schema tests | Invalid tool/repository inputs return validation errors. |
| MCP write cannot bypass policy | `vaultTools.test.ts` trusted-action and evidence-policy tests | Approval/export require trusted boundary; missing evidence fails. |
| Raw audio is absent from model payload | `workflow.evaluation.test.ts` raw-audio model payload test | Serialized model request contains no raw audio fields. |
| Raw audio is absent from export | `vaultTools.test.ts` and `vaultInspection.test.ts` export redaction tests | Export payload omits raw audio and secrets. |
| Workflow failure creates failed trace | `workflow.evaluation.test.ts` bad signal test | Failed trace and failed workflow status. |
| Fallback creates fallback trace | `workflow.evaluation.test.ts` unavailable/timeout tests | Archivist trace has fallback status. |
| Unsupported storage version fails safely | `workflow.evaluation.test.ts` future schema test | Typed storage error and original payload preserved. |
| Legacy observation without evidence remains unverified | `specimenRepository.test.ts` migration coverage | Legacy records preserve text with `unverified` status. |
| Export schema is valid | `vaultTools.test.ts` and `vaultInspection.test.ts` | Versioned export parses against schema. |
| Health endpoint is safe | `server.operational.test.ts` health test | Safe status only; no secrets or env dump. |
| Model endpoint rate limit is clear and configurable | `server.operational.test.ts` rate-limit test | HTTP 429 with `Retry-After` and request id. |
| Structured logs redact sensitive fields | `server.operational.test.ts` redaction test | Secrets, tokens, authorization, and raw audio are redacted. |

## Fake Model

Workflow tests inject an `archivistAdapter` directly into `runBreathWorkflow`. This fake model returns deterministic structured Archivist responses or controlled failures. Server endpoint tests use invalid requests and no-key fallback to avoid real ADK calls while still testing endpoint behavior.

## Optional Real-Model Smoke Test

Real-model smoke testing is intentionally opt-in:

1. Set `GEMINI_API_KEY` or `GOOGLE_API_KEY`.
2. Run `npm run dev`.
3. Open `http://localhost:3000`.
4. Complete the three-breath ritual.
5. Inspect the cabinet trace panel for an Archivist trace with `Succeeded` or `Fallback path`.

The expected safe result is either a grounded `gemini` observation citing persisted evidence ids, or a local fallback observation with a fallback trace. The app should not upload raw audio or expose secrets in logs.

## Limitations

- The default harness does not assert model quality, only schema, provenance, fallback, privacy, and policy behavior.
- Browser visual regression is manual; UI state contracts are tested through pure helper tests and repository/policy integration.
- The MCP stdio server smoke test is `npm run mcp:check`; browser localStorage data is not shared with the standalone MCP process.
