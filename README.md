<p align="center">
  <img src="src/demo/home.png" alt="The Lichen Vault home screen" width="920" />
</p>

<h1 align="center">The Lichen Vault</h1>

<p align="center">
  A fictional, privacy-preserving digital herbarium for breath-derived procedural specimens.
</p>

<p align="center">
  <img alt="Release" src="https://img.shields.io/badge/release-v0.1.0-d97706?style=for-the-badge" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61dafb?style=for-the-badge&logo=react&logoColor=111111" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6?style=for-the-badge&logo=typescript&logoColor=ffffff" />
  <img alt="Validation" src="https://img.shields.io/badge/Zod-runtime%20schemas-10b981?style=for-the-badge" />
</p>

The Lichen Vault turns a three-breath ritual into a deterministic procedural lichen specimen, stores it locally in the browser, and records evidence, events, workflow traces, and human-in-the-loop policy decisions. It is best classified for the capstone as **Freestyle**.

The system demonstrates a **hybrid agentic workflow**: deterministic Signal Curator, Growth Simulator, policy, and persistence actors coordinate with an optional ADK-backed Archivist agent. It is not described as a full multi-agent system.

## Preview

| Breath ritual | Specimen chamber |
| --- | --- |
| <img src="src/demo/ritual.png" alt="Breath ritual screen" width="440" /> | <img src="src/demo/specimen.png" alt="Specimen inspection screen" width="440" /> |

## Problem

Most generative demos stop at the moment of creation. This project explores the harder shape of an agentic system: private user-owned artifacts that must persist, migrate, recover from corrupt local state, and later support evidence-grounded agent decisions without inventing provenance.

## Current Solution

- Three-step breath capture ritual with microphone input and simulated fallback.
- Deterministic Canvas 2D lichen renderer using seeded growth parameters.
- Canonical `Specimen` domain model with `LichenOrganism` retained as a compatibility alias.
- Runtime Zod validation on storage reads, migration output, specimen writes, event writes, evidence records, traces, proposals, and model endpoint payloads.
- Local vault persistence through `LocalStorageSpecimenRepository`, including corrupt-storage recovery that preserves raw payloads for the user.
- Evidence-grounded Archivist observations through a controlled ADK adapter, with local fallback when no key is configured or model output fails validation.
- Persisted workflow sessions, trace events, evidence records, event ledger entries, and intervention proposals.
- Human approval panel for high-risk proposals; approval/rejection is idempotent and cannot be performed by an agent or tool context.
- Vault MCP stdio server backed by a schema-validated JSON file repository and an explicit browser export/import bridge.
- Safe `/health` endpoint, structured redacted server logs, bounded model retries, model request timeout, and configurable rate limiting for model-backed endpoints.

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

## Development Setup

```bash
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

## Scripts

```bash
npm run dev            # Start the Express + Vite development server
npm run lint           # Type-check the project
npm run test           # Run the deterministic Vitest suite
npm run eval           # Run workflow, operational, MCP, and import bridge tests
npm run mcp:seed       # Create deterministic JSON-file MCP data
npm run mcp:check      # Dry-run MCP tool registration
npm run mcp:dev        # Start the Vault MCP stdio server
npm run mcp:import -- ./path/to/lichen-vault-export.json
npm run build          # Build the client and bundled production server
npm run start          # Serve the production build from dist/
npm run preview        # Build, then start the production server
npm run release:check  # Run deterministic release gate
npm run smoke:adk      # Optional real-model smoke; skips safely without a key
```

`release:check` runs lint, tests, eval, deterministic MCP seed, MCP check, and build. It does not require Gemini credentials.

## Production Build

```bash
npm run release:check
npm run start
```

The production server serves `dist/`, falls back to `index.html` for SPA routes, listens on `0.0.0.0`, and respects a valid `PORT` environment variable. `/health` returns safe service status, model configuration state, ADK package participation, rate-limit configuration, and current server time. It does not expose API keys, authorization data, specimen data, or raw environment values.

Model-backed endpoints emit structured JSON logs with request ids, workflow ids when available, operation, status, duration/fallback fields, and redacted error context. Model rate limiting applies only when a real model key is configured, so the no-key local fallback path remains available for development and demos.

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

The importer validates versioned exports, scrubs sensitive fields, merges records idempotently in memory, rejects conflicting duplicate IDs, validates cross-references, and writes the JSON vault once through staged replacement. Failed imports leave the original vault file unchanged.

## Vault MCP Server

The MCP server exposes schema-validated tools:

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

The default suite uses fake model behavior and local fixtures. It covers deterministic workflow success and failure, corrupt storage, unsupported versions, model fallback paths, missing evidence, duplicate evidence IDs, raw-audio exclusion, secret redaction, human approval boundaries, JSON-file MCP persistence, atomic import rollback, concurrent JSON repository writes, MCP policy rejection traces, production build behavior, and safe health output.

`npm run smoke:adk` is opt-in:

- `grounded`: the real model returned a valid schema and valid evidence citations.
- `local_fallback`: the real model path was attempted but usable grounded output was not produced.
- `skipped`: no key was configured.
- `failed`: the endpoint or smoke implementation itself failed.

The smoke command never prints API keys or full raw provider responses.

## Demo Flow

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`, perform the three-breath ritual, then inspect the new specimen in the cabinet. The Trace panel shows persisted workflow steps. The Human Approval panel shows the high-risk export proposal; approving or rejecting it records an idempotent event and trace. After approval, the UI can prepare a versioned JSON export that may be imported into the MCP repository with `npm run mcp:import`.

## Security Limitations

The browser approval flow represents a local user-consent boundary, not production authentication. Timestamp nonces and client-created contexts are demo controls. Consent and execution remain separate: approval records a decision, while destructive execution tools are not exposed.

The repository must never contain API keys, tokens, generated credentials, private data, raw breath audio, local MCP data files, logs, or environment files. `.env.example` contains placeholders only.

## Documentation

- `docs/architecture.md`
- `docs/evaluation.md`

## Limitations

- Browser `localStorage` provides best-effort consistency only; the repository implements staged writes with rollback, not true database transactions.
- The MCP JSON-file repository uses an in-process mutation queue, not distributed locking.
- The ADK Archivist adapter is server-side only. The primary test suite uses fake model behavior and does not require a real Gemini key.
- Screenshots document the current visual experience; they are not an automated visual regression suite.

## Release Check

Before treating the system as ready for human end-to-end verification, run:

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

Do not report manual browser testing as complete unless the three-breath press-and-hold path was actually completed in a reliable browser session.
