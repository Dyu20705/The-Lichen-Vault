# The Lichen Vault Agent Architecture

The Lichen Vault remains a local-first React and Express application. The three-breath ritual, seeded renderer, museum cabinet, local storage migration, and corruption recovery flow are preserved.

## Runtime Flow

Capture or simulation -> Signal Curator -> evidence persistence -> Growth Simulator -> Archivist Agent -> policy validation -> event persistence -> trace persistence -> UI update.

## Components

- React UI: breath ritual, specimen renderer, cabinet, trace panel, evidence viewer, and human approval controls.
- Express server: static production hosting, Vite middleware in development, `/health`, fallback fragment endpoint, and ADK-backed Archivist endpoint.
- Application services: signal curator, growth simulator, Archivist conversion, workflow runtime, and policy decisions.
- Persistence: `SpecimenRepository` abstraction with in-memory and localStorage implementations.
- MCP: stdio tool server for controlled external access to reads, proposals, decisions, traces, and exports.

## Deterministic Responsibilities

- Breath duration, intensity, cadence, signal quality, and recommendation rules.
- Evidence, event, workflow, trace, proposal, and specimen schema validation.
- Seed generation and growth parameters in `growth-simulator.v1`.
- Repository writes, idempotent event append, and local storage migration/recovery.
- Risk classification and human approval enforcement.

## LLM Responsibility

The Archivist is the only model-backed step. It receives a bounded specimen summary and persisted evidence manifest. It must return structured JSON, cite real evidence ids, avoid medical or psychological claims, and use prompt version `archivist.v1`.

When model access is missing, fails, times out, returns invalid JSON, or cites nonexistent evidence, the workflow writes a local fallback observation and a fallback trace. Retry is bounded, and deterministic schema/configuration failures are not retried.

## ADK Boundary

The server imports `@google/adk` and uses `LlmAgent`, `FunctionTool`, and `InMemoryRunner` in `/api/archivist/observe`. The ADK agent has a read-only evidence-manifest tool and `includeContents: "none"` so it only sees the current controlled request context.

The deterministic workflow does not use ADK. This keeps critical calculations and policy decisions inspectable and testable.

## Operational Boundary

The Express server exposes `/health` with safe service status, model configuration state, ADK participation, rate-limit configuration, and current time. It does not expose secrets, authorization headers, full environment data, specimen content, or evidence payloads.

Server logs are structured JSON and include request ids, workflow ids where available, operation, status, duration, error category, and fallback reason. Log fields are recursively redacted for API keys, authorization data, secrets, tokens, raw audio, audio bytes, and media streams.

The Archivist endpoint has a request timeout, bounded attempts, abort propagation into fetch/ADK paths where supported, schema validation, and local fallback. Rate limiting is configurable through `MODEL_RATE_LIMIT_WINDOW_MS` and `MODEL_RATE_LIMIT_MAX`, and applies only when a real model key is configured so local fallback remains available for no-key demos.

## Persistence

`SpecimenRepository` now covers specimens, events, evidence, workflows, traces, and intervention proposals. `LocalStorageSpecimenRepository` stores these in versioned local-storage envelopes. Corrupted payloads raise recovery errors and are not automatically deleted.

Browser storage is still best-effort. Event appends keep the existing staged write and rollback behavior for specimen/event references.

## Evidence Lifecycle

Evidence records are structured, versioned, and identified with the `ev_` prefix. Signal curation creates breath and signal evidence from normalized metrics, growth simulation creates deterministic growth evidence, and policy/actions may reference only existing evidence for the same specimen. Grounded observations and proposals cannot cite missing or duplicate evidence ids.

Raw audio is intentionally outside the evidence model. Only derived duration, intensity, cadence, and quality metrics are persisted.

## Trace Lifecycle

Workflow and MCP operations emit `TraceEvent` records with actor, operation, status, duration, timestamp, evidence references, fallback reason, and error category where applicable. Traces are persisted by specimen and grouped in the UI by workflow id. Failed deterministic steps create failed traces; model fallback creates fallback traces.

## Proposal Lifecycle

High-risk actions such as export are created as pending `InterventionProposal` records. Proposal approval or rejection requires a trusted user action context, records an idempotent event, and remains read-only after decision. Approval records consent only; execution is separate and cannot be performed by the Archivist model.

## Policy Boundary

The policy layer owns risk classification, evidence-reference checks, trusted decision validation, and idempotent decision behavior. Agent, system, and tool contexts cannot manufacture approval. MCP approval/export calls require an injected trusted-action validator; the standalone server does not grant trust by default.

## MCP

The Vault MCP server runs over stdio via:

```bash
npm run mcp:dev
```

Tools:

- `list_specimens`
- `get_specimen`
- `get_specimen_events`
- `get_evidence`
- `get_workflow_traces`
- `append_observation`
- `propose_intervention`
- `approve_intervention`
- `reject_intervention`
- `export_specimen`

There is no direct `delete_specimen` tool. High-risk actions can be proposed, but approval and export require trusted user-action context.

## Security And Privacy

The local-first app stores specimen data in browser storage. Server model calls receive bounded specimen context and redacted evidence summaries only. Structured logs, health output, model payloads, evidence inspection, and exports exclude secrets, authorization values, approval tokens, raw audio, audio bytes, media streams, and raw prompts.
