# Evaluation Harness

The primary evaluation suite runs without Gemini or any real model key:

```bash
npm run eval
```

It covers:

- Observations and proposals cannot reference nonexistent evidence ids.
- Model unavailability creates local fallback observations.
- Corrupted storage is surfaced without automatic deletion.
- High-risk interventions are proposed but not executed.
- Identical normalized input, evidence ids, seed material, and algorithm version reproduce the same growth result.
- Repeated approval does not duplicate approval events.
- MCP write tools use schema validation and policy checks.
- Invalid model output becomes fallback.
- Raw audio is not included in model request payloads.
- Workflow fallback traces are persisted.
- Agent/tool contexts cannot approve proposals.
- Unsupported storage schema versions fail safely.

The normal test suite also includes domain and repository migration coverage:

```bash
npm run test
```

Real-model smoke testing is intentionally not part of the default suite. To exercise Gemini through ADK, configure `GEMINI_API_KEY` or `GOOGLE_API_KEY`, start the server, and use the breath workflow manually. The workflow still falls back locally if the model fails validation.
