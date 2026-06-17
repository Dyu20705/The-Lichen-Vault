# The Lichen Vault

The Lichen Vault is a breath-driven digital herbarium. Visitors perform a three-breath deposition ritual, then the app transforms cadence, duration, and audio intensity into a persistent procedural lichen specimen that can be revisited in a private vault.

The MVP is production-buildable, works without an AI key, and keeps specimen data in the browser by default. When `GEMINI_API_KEY` is configured, the server can generate new archival observation notes for each specimen; otherwise it falls back to bundled local observations.

## Features

- Three-step breath capture ritual with microphone input and a graceful simulated fallback.
- Deterministic procedural lichen renderer using Canvas 2D and seeded growth parameters.
- Local vault persistence through `localStorage`.
- Time-based specimen growth states, crystal formation, bloom emergence, and color mutation.
- Archival inspection view with generated or local observation entries.
- Express production server that serves the Vite build and `/api/generate-fragment`.
- Responsive, dark museum-cabinet interface built with React, Tailwind CSS, Motion, and Lucide icons.

## Tech Stack

- React 19
- Vite 6
- TypeScript 5
- Tailwind CSS 4
- Express
- Google GenAI SDK, optional
- Canvas 2D procedural rendering

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Optional Gemini API key for AI-generated archival notes

## Getting Started

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

The app asks for microphone access during the deposition ritual. If access is denied or unavailable, the ritual still works with simulated pressure data so the MVP remains fully usable in restricted environments.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | No | Enables Gemini-generated observation entries. Without it, the server returns local fallback entries. |
| `APP_URL` | No | Public app URL for deployments that need self-referential links. |

## Scripts

```bash
npm run dev            # Start the Express + Vite development server
npm run lint           # Type-check the project
npm run build          # Build the client and bundled production server
npm run start          # Serve the production build from dist/
npm run preview        # Build, then start the production server
npm run release:check  # Run the release verification gate
npm run clean          # Remove dist/
```

## Production Build

```bash
npm run release:check
npm run start
```

The production server listens on `0.0.0.0:3000` and serves `dist/index.html` for SPA routes.

## Data And Privacy

Specimens are stored locally in the user's browser under the `lichen_vault_flora` key. The app does not upload breath audio. The microphone stream is used client-side only to derive simple intensity and cadence metrics during the ritual.

When Gemini is enabled, only specimen metadata such as name, age label, and growth stage is sent to `/api/generate-fragment` for text generation. The endpoint falls back to local text if Gemini is unavailable.

## Release Artifact

This repository ships as a local production bundle. A release archive should include:

- `dist/`
- `package.json`
- `package-lock.json`
- `README.md`
- `.env.example`
- `metadata.json`

Install production dependencies and start the packaged app with:

```bash
npm ci --omit=dev
npm run start
```

## Status

MVP release: `v0.1.0`

The core loop is complete: deposit breath, generate a specimen, preserve it locally, inspect it in the vault, and append archival observations with AI or local fallback text.
