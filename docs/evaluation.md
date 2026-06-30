# Evaluation Harness

The deterministic evaluation path runs without Gemini credentials:

```bash
npm run eval
```

It uses fake model injection, local repositories, isolated localStorage shims, operational endpoint tests, MCP tool tests, and JSON-file import bridge tests.

## Test Categories

- Unit tests: domain invariants, schema validation, persistence behavior, trace/evidence helpers, policy decisions.
- Deterministic workflow tests: successful three-breath workflow, invalid breath counts, deterministic seed/growth reproduction, model unavailable fallback, timeout fallback, invalid response fallback, nonexistent evidence citation fallback, raw audio exclusion.
- Storage tests: corrupt browser storage, unsupported storage versions, duplicate evidence ids, rollback behavior, JSON-file MCP persistence, corrupt MCP vault rejection.
- Operational endpoint tests: safe `/health`, redacted logs, no-key fallback, request validation, rate limiting.
- MCP integration tests: tool schemas, imported browser exports, repeated import idempotency, persisted reads, proposal creation, trusted-action denial, persisted policy failure traces, export redaction.
- Optional real-model smoke: `npm run smoke:adk`.

## Scenario Matrix

| Scenario | Expected result |
| --- | --- |
| Successful deterministic workflow | Specimen, evidence, events, traces, workflow, and pending export proposal persist. |
| Invalid number of breaths | Workflow fails visibly and records a failed validation trace. |
| Corrupt browser storage | Typed recovery error; raw payload is preserved. |
| Unsupported storage version | Safe failure; no silent deletion. |
| Model unavailable, timeout, invalid output, or missing evidence citation | Local fallback observation and fallback trace. |
| Raw audio in recordings | Raw audio is absent from model requests, evidence, exports, and logs. |
| Duplicate evidence IDs | Validation/storage error. |
| Agent/tool approval attempt | Policy rejection. |
| Export without trusted confirmation | Policy rejection and failed MCP trace when specimen context exists. |
| Repeated approval/import | Idempotent, no duplicate event or record. |
| MCP import bridge | Versioned export validates and becomes readable through MCP tools. |
| Health endpoint | Safe status only, no sensitive values. |

## Optional Real-Model Smoke

```bash
npm run smoke:adk
```

If neither `GEMINI_API_KEY` nor `GOOGLE_API_KEY` is configured, the command exits successfully with a skipped status. If a key is configured, it invokes the real ADK-backed Archivist endpoint with deterministic fixture evidence, validates the output schema, verifies cited evidence ids exist, checks raw audio is absent, and reports either `grounded` or `local_fallback`. Sensitive error details are redacted.

The smoke command is intentionally not part of normal CI.
