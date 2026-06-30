# The Lichen Vault Architecture

The Lichen Vault is a local-first React and Express application for a fictional procedural digital herbarium. It preserves the breath ritual, procedural renderer, museum cabinet, evidence inspection, trace inspection, local fallback behavior, and human approval interface while keeping deterministic responsibilities separate from the optional model-backed Archivist.

## Runtime Flow

```text
Breath capture
-> Signal Curator
-> evidence persistence
-> deterministic Growth Simulator
-> ADK Archivist
-> policy validation
-> events and traces
-> human decision
-> optional consent-based export
-> MCP import and inspection
```

## Component Roles

- React UI: landing, breath ritual, germination progress, reveal, vault cabinet, evidence viewer, trace panel, proposal decisions, and consent-based export.
- Express server: Vite development middleware, production static hosting, `/health`, local fallback endpoint, and ADK-backed `/api/archivist/observe`.
- Deterministic application services: Signal Curator, Growth Simulator, policy checks, evidence validation, workflow sessions, and trace emission.
- Persistence: `SpecimenRepository` interface with browser `localStorage`, in-memory tests, and Node JSON-file MCP implementations.
- MCP: stdio tool server for schema-validated reads, proposal creation, trusted decisions, traces, and exports.

This is a hybrid agentic workflow. Signal Curator, Growth Simulator, policy, and persistence are workflow actors, not LLM agents. The Archivist is the only model-backed agent path.

## ADK Boundary

The server imports `@google/adk` and uses `LlmAgent`, `FunctionTool`, and `InMemoryRunner` for Archivist observations. The agent receives bounded specimen context and a validated evidence manifest. It must return structured JSON, cite real evidence ids, and avoid medical, psychological, respiratory-disease, stress, mood, or biological diagnosis claims.

When a model key is absent, the model times out, the output is invalid, or cited evidence is missing, the workflow writes a local fallback observation and a fallback trace. The deterministic workflow does not rely on external API keys.

## Persistence

`SpecimenRepository` covers specimens, events, evidence, workflows, traces, and intervention proposals.

- `LocalStorageSpecimenRepository` stores validated browser data in versioned envelopes and preserves corrupt payloads for recovery.
- `JsonFileSpecimenRepository` stores the standalone MCP vault in a schema-validated JSON file, scrubs forbidden sensitive fields, rejects corrupt or unsupported data, serializes in-process mutations through a write queue, and writes through a staged temporary file replacement.
- `InMemorySpecimenRepository` supports deterministic tests.

Browser storage and MCP storage are intentionally separate. The bridge is explicit:

```bash
npm run mcp:import -- ./path/to/lichen-vault-export.json --data ./data/mcp-vault.json
```

MCP import is atomic for the JSON-file repository: the importer validates and scrubs the complete export, merges entities idempotently in memory, rejects conflicting duplicate IDs or broken cross-references, validates the final vault, and writes the file once. Failed imports leave the original file unchanged.

## Evidence And Traces

Evidence records use `ev_` identifiers and structured payloads. Raw audio, audio bytes, media streams, secrets, approval tokens, and raw prompts are excluded from evidence, traces, exports, logs, and MCP JSON persistence.

Trace records capture workflow and MCP operations with actor, operation, status, duration, evidence references, fallback reason, and error metadata where applicable. MCP policy failures are persisted as failed traces when a specimen/proposal context is known.

## Trusted-Action Boundary

The UI approval flow is a local user-consent boundary, not production authentication. A timestamp nonce or client-created context is not secure identity. Approval records consent only; execution remains separate. Agent, system, and tool contexts cannot approve proposals through policy, and the standalone MCP server does not install a trusted-action validator by default.

## Operational Boundary

`/health` returns safe service status only. It does not expose API keys, authorization headers, specimen data, environment dumps, raw audio, or secret values. Structured logs recursively redact sensitive fields.
