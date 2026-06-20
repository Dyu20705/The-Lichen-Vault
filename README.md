<p align="center">
  <img src="src/demo/home.png" alt="The Lichen Vault home screen" width="920" />
</p>

<h1 align="center">The Lichen Vault</h1>

<p align="center">
  A breath-driven digital herbarium and Capstone foundation for privacy-preserving specimen agents.
</p>

<p align="center">
  <img alt="Release" src="https://img.shields.io/badge/release-v0.1.0-d97706?style=for-the-badge" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61dafb?style=for-the-badge&logo=react&logoColor=111111" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6?style=for-the-badge&logo=typescript&logoColor=ffffff" />
  <img alt="Validation" src="https://img.shields.io/badge/Zod-runtime%20schemas-10b981?style=for-the-badge" />
</p>

The Lichen Vault turns a three-breath deposition ritual into a persistent procedural lichen specimen. The current checkpoint keeps the original museum-cabinet experience while adding a validated domain and persistence foundation for later agent work.

## Preview

| Breath ritual | Specimen chamber |
| --- | --- |
| <img src="src/demo/ritual.png" alt="Breath ritual screen" width="440" /> | <img src="src/demo/specimen.png" alt="Specimen inspection screen" width="440" /> |

## Problem

Most generative demos stop at the moment of creation. This project explores the harder shape of an agentic system: private user-owned artifacts that must persist, migrate, recover from corrupt local state, and later support evidence-grounded agent decisions without inventing provenance.

## Current Solution

- Three-step breath capture ritual with microphone input and simulated fallback.
- Deterministic Canvas 2D lichen renderer using seeded growth parameters.
- Canonical `Specimen` domain model with `LichenOrganism` retained only as a compatibility alias.
- Runtime Zod validation on storage reads, migration output, specimen writes, event writes, and the observation API request body.
- Local vault persistence through `LocalStorageSpecimenRepository` instead of raw app-level `localStorage` parsing.
- Legacy record migration with deterministic missing seed/time derivation.
- Corruption recovery UI that exposes the failed key, reason, raw payload, retry, copy, ignore, and explicit reset paths.
- Event ledger support with idempotent duplicate appends and deterministic ordering.
- Optional Gemini-generated archival observations with local fallback when no key is configured.

## Completed Architecture

The current foundation includes modular domain entities for specimens, evidence records, episodic events, traces, workflows, and intervention proposals. Repository interfaces decouple the React app from storage details, while the localStorage implementation uses a v2 envelope and keeps compatibility with the original array-based records.

Persistence uses a transaction-like staged write with rollback across specimen snapshots and event records. Browser storage cannot provide true multi-key atomicity, so the implementation validates first, captures previous values, writes both stores, verifies the result, and restores previous values if a staged write fails.

## Agent Roadmap

Planned checkpoints will build on this foundation:

- Semantic memory over specimen evidence and observations.
- Multi-agent orchestration for anomaly investigation and care proposals.
- Human approval workflows for risky interventions.
- Evaluation harnesses for provenance, fallback behavior, and recovery quality.
- Deployment hardening, health endpoints, structured logging, and production observability.

These capabilities are planned. They are not claimed as complete in this checkpoint.

## Domain And Persistence

`Specimen` is the canonical persisted domain entity. Legacy observations are not upgraded into false certainty:

- `gemini` observations require evidence ids, numeric confidence, and `grounded` verification.
- `local_fallback` observations may omit evidence and are marked `fallback`.
- `legacy_unverified` observations preserve original text with empty evidence, `null` confidence, and `unverified` status.

Migration is deterministic and idempotent: the same legacy record produces the same specimen, already migrated specimens are accepted without destructive transformation, malformed JSON raises a typed recovery error, and unsupported future versions fail safely.

## Privacy

Specimens are stored locally in the browser under The Lichen Vault storage keys. Breath audio is not uploaded; the microphone stream is used client-side to derive simple duration, intensity, and cadence metrics during the ritual.

`GEMINI_API_KEY` is optional. Without it, the app remains functional through local fallback observation text. When Gemini is enabled, the server sends only specimen context such as name, age label, and growth stage to `/api/generate-fragment`.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Optional Gemini API key for AI-generated archival observations

## Development Setup

```bash
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | No | Enables Gemini-generated observation entries. Without it, the server returns local fallback entries. |
| `APP_URL` | No | Public app URL for deployments that need self-referential links. |

Cloud Run secrets and service URLs should be injected through deployment configuration. `.env.example` contains placeholders only.

## Scripts

```bash
npm run dev            # Start the Express + Vite development server
npm run lint           # Type-check the project
npm run test           # Run Vitest tests
npm run build          # Build the client and bundled production server
npm run start          # Serve the production build from dist/
npm run preview        # Build, then start the production server
npm run release:check  # Run lint, tests, and build
npm run clean          # Remove generated local build artifacts
```

## Production Build

```bash
npm run release:check
npm run start
```

The production server serves `dist/`, falls back to `index.html` for SPA routes, listens on `0.0.0.0`, and respects a valid `PORT` environment variable. Cloud Run readiness requires later deployment work such as health checks, container configuration, and operational logging.

## Limitations

- Browser `localStorage` provides best-effort consistency only; the repository implements staged writes with rollback, not true database transactions.
- The observation API has graceful local fallback, but no production observability or rate limiting yet.
- Screenshots document the current visual experience; they are not an automated visual regression suite.

## Project Evolution

The original MVP established the identity, breath ritual, renderer, vault inspection flow, optional Gemini fallback, and production-buildable Express/Vite server. This checkpoint preserves those strengths while replacing direct app-level storage access with validated domain repositories and explicit recovery behavior.
