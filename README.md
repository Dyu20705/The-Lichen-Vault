# The Lichen Vault

The Lichen Vault is a fictional, privacy-preserving digital herbarium. It turns a three-breath ritual into a deterministic procedural lichen specimen, stores the result locally in the browser, and records evidence, events, workflow traces, and human-in-the-loop policy decisions.

Recommended capstone classification: **Freestyle**.

This repository demonstrates a hybrid agentic workflow: deterministic Signal Curator, Growth Simulator, policy, and persistence actors coordinate with an optional ADK-backed Archivist agent. It is not presented as a full multi-agent system.

## Architecture Flow

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

Raw audio is never uploaded or persisted. The app derives duration, intensity, and cadence metrics locally. Normal operation works without `GEMINI_API_KEY` or `GOOGLE_API_KEY`; the Archivist step falls back to local text when model access is unavailable, times out, or returns invalid or ungrounded output.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Optional `GEMINI_API_KEY` or `GOOGLE_API_KEY` for real ADK Archivist calls

## Setup

```bash
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

## Scripts

```bash
npm run lint           # Type-check
npm run test           # Full deterministic Vitest suite
npm run eval           # Evaluation, operational, MCP, and import bridge tests
npm run mcp:seed       # Create deterministic JSON-file MCP data
npm run mcp:check      # Verify MCP stdio tool registration
npm run mcp:dev        # Start MCP stdio server
npm run mcp:import -- ./path/to/lichen-vault-export.json
npm run build          # Production client and server build
npm run release:check  # Deterministic release gate
npm run smoke:adk      # Optional real-model smoke; skips safely without a key
```

`release:check` runs lint, tests, eval, deterministic MCP seed, MCP check, and build. It does not require Gemini credentials.

## Browser Storage And MCP Persistence

The browser app remains local-first and stores specimens in validated browser storage. The standalone MCP process uses a Node-compatible JSON file repository (`JsonFileSpecimenRepository`) configured by:

```bash
MCP_VAULT_PATH=./data/mcp-vault.json
npm run mcp:dev -- --data ./data/mcp-vault.json
```

Browser data reaches MCP only through an explicit consent-based export from the UI followed by:

```bash
npm run mcp:import -- ./path/to/lichen-vault-export.json --data ./data/mcp-vault.json
```

The importer validates versioned exports, scrubs sensitive fields, rejects corrupt or unsupported data, and is idempotent for repeated imports of the same export.

## MCP Tools

The stdio server exposes:

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

Approval, rejection, and export require an application-controlled trusted-action validator. The default standalone server can inspect and propose, but it does not grant autonomous approval authority.

## Evaluation And Smoke Testing

The default suite uses fake model behavior and local fixtures. It covers deterministic workflow success and failure, corrupt storage, unsupported versions, model fallback paths, missing evidence, duplicate evidence IDs, raw-audio exclusion, secret redaction, human approval boundaries, JSON-file MCP persistence, import idempotency, MCP policy rejection traces, production build behavior, and safe health output.

`npm run smoke:adk` is opt-in. Without a configured model key it exits successfully with a skipped status. With a key, it calls the real ADK-backed Archivist endpoint using deterministic fixture evidence, validates the response schema and evidence citations, checks that raw audio is absent, reports `grounded` or `local_fallback`, and redacts sensitive errors.

## Security Limitations

The browser approval flow represents a local user-consent boundary, not production authentication. Timestamp nonces and client-created contexts are demo controls. Consent and execution remain separate: approval records a decision, while destructive execution tools are not exposed.

The repository must never contain API keys, tokens, generated credentials, private data, raw breath audio, local MCP data files, logs, or environment files. `.env.example` contains placeholders only.

## Documentation

- `docs/architecture.md`
- `docs/evaluation.md`

## Release Check

Before treating the system as ready for resource preparation, run:

```bash
npm ci
npm run lint
npm run test
npm run eval
npm run mcp:seed
npm run mcp:check
npm run build
npm run release:check
npm run smoke:adk
```

Report `smoke:adk` as passed with a real model, safely skipped because no key was configured, or failed with a sanitized reason.
