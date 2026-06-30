# The Lichen Vault Agent Architecture

The Lichen Vault remains a local-first React and Express application. The three-breath ritual, seeded renderer, museum cabinet, local storage migration, and corruption recovery flow are preserved.

## Runtime Flow

Capture or simulation -> Signal Curator -> evidence persistence -> Growth Simulator -> Archivist Agent -> policy validation -> event persistence -> trace persistence -> UI update.

## Deterministic Responsibilities

- Breath duration, intensity, cadence, signal quality, and recommendation rules.
- Evidence, event, workflow, trace, proposal, and specimen schema validation.
- Seed generation and growth parameters in `growth-simulator.v1`.
- Repository writes, idempotent event append, and local storage migration/recovery.
- Risk classification and human approval enforcement.

## LLM Responsibility

The Archivist is the only model-backed step. It receives a bounded specimen summary and persisted evidence manifest. It must return structured JSON, cite real evidence ids, avoid medical or psychological claims, and use prompt version `archivist.v1`.

When model access fails, times out, returns invalid JSON, or cites nonexistent evidence, the workflow writes a local fallback observation and a fallback trace.

## ADK Boundary

The server imports `@google/adk` and uses `LlmAgent`, `FunctionTool`, and `InMemoryRunner` in `/api/archivist/observe`. The ADK agent has a read-only evidence-manifest tool and `includeContents: "none"` so it only sees the current controlled request context.

The deterministic workflow does not use ADK. This keeps critical calculations and policy decisions inspectable and testable.

## Persistence

`SpecimenRepository` now covers specimens, events, evidence, workflows, traces, and intervention proposals. `LocalStorageSpecimenRepository` stores these in versioned local-storage envelopes. Corrupted payloads raise recovery errors and are not automatically deleted.

Browser storage is still best-effort. Event appends keep the existing staged write and rollback behavior for specimen/event references.

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
- `append_observation`
- `propose_intervention`
- `approve_intervention`
- `reject_intervention`
- `export_specimen`

There is no direct `delete_specimen` tool. High-risk actions can be proposed, but approval and export require trusted user-action context.
