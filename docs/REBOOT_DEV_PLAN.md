# CharacterRPG Reboot Development Plan

## Objective

Build CharacterRPG as a provider-agnostic, backend-first RPG engine that can run local or hosted models, preserve long-running story continuity, and expose the same core runtime to a responsive web app, an Android installable app, and optional ChatGPT companion workflows.

The sibling `RolePlayGPT` repository remains a live, usable project. CharacterRPG will copy and adapt the useful backend patterns from it instead of depending on or modifying that repo.

## Product Direction

The first reliable product should be a text-first RPG engine with excellent continuity, model routing, and debug visibility. Voice, native mobile polish, animated avatars, and live/realtime interaction should come later because they multiply complexity before the core story runtime is proven.

Recommended product order:

1. FastAPI backend with campaign/session/character runtime.
2. Responsive React web app for fast iteration.
3. PWA installation path.
4. Capacitor Android wrapper if an installable Android app is still useful.
5. Native Android/React Native only if we hit requirements Capacitor cannot satisfy, such as advanced low-latency voice capture or platform-specific audio control.

## Target Architecture

### Backend

Use Python and FastAPI.

Reasons:

- RolePlayGPT already proves this stack fits the domain.
- Pydantic models are a good match for strict campaign, turn, and provider contracts.
- Python has stronger AI/RAG/document-processing ecosystem support.
- FastAPI gives a clean OpenAPI contract for web clients, ChatGPT Actions, and future companion tools.
- The backend can run well in Termux for local/private use, then move to a hosted environment later.

### Frontend

Use React + TypeScript as a responsive web app.

Reasons:

- Faster iteration than React Native while the product shape is still changing.
- Easier debugging of state, prompts, provider responses, memory, and transcripts.
- Can become a PWA quickly.
- Can later be wrapped with Capacitor for Android.

The current React Native app remains a useful sketch of screens and state, but it should not drive the architecture.

### Storage

Start with local storage that is easy to inspect and back up:

- SQLite for indexes, lists, queryable metadata, usage records, and session catalogs.
- Markdown/YAML/JSON files for canonical campaign artifacts, transcripts, recaps, timelines, and drop-in character/profile bundles.

This hybrid layout preserves RolePlayGPT's inspectable campaign files while retaining CharacterRPG's useful SQLite concepts.

Potential later migration:

- Postgres for multi-user/cloud deployment.
- Object storage for uploaded docs, avatars, and generated audio.
- Vector store only after retrieval quality requirements are clear.

## Domain Model

### Campaign

A campaign is the canon container.

Canonical artifacts:

- `campaign.json`
- `world_state.yaml`
- `scenario.yaml`
- `factions.yaml`
- `event_queue.yaml`
- `relationship_graph.yaml`
- `rpg_characters.yaml`
- `quests.yaml`
- `timeline.md`
- `recap.md`

### Session

A session is a save slot, continuation slot, or branch within a campaign.

Sessions need:

- stable `session_id`
- parent/fork metadata
- transcript
- session-specific world state copy
- branch notes
- review status
- turn count

### Character

Characters should be reusable across campaigns but instantiated into campaigns/sessions.

Character data:

- name and aliases
- profile/system prompt
- short prompt
- reviewer prompt
- voice settings
- avatar
- age/birth year
- player-controlled vs model-controlled state
- public summary
- private memory
- relationship notes
- knowledge/awareness boundaries

### Turn

Every turn should preserve:

- user input
- normalized user intent
- selected provider/model
- retrieved context
- model request metadata
- model response
- structured assistant turns
- persistence updates
- usage/cost estimates
- errors or fallbacks

## Provider Architecture

The backend should define one internal interface for model generation.

Required capabilities:

- text generation
- structured JSON turn generation
- setup/draft generation
- review/continuity analysis
- optional embedding/retrieval support later
- optional speech and transcription later

Initial provider adapters:

1. `mock`
   - deterministic local testing.
2. `openai_responses`
   - direct OpenAI Responses API support.
3. `openai_compatible`
   - configurable base URL and API key for Venice and similar APIs when compatible.
4. `ollama`
   - local private models through Ollama.
5. `huggingface`
   - Hugging Face Inference Providers or a user-configured endpoint.

Gemini can follow once the first provider interface is stable.

Provider settings should be request-scoped by default. BYOK credentials should not be persisted unless the user explicitly configures a private local `.env` for their own server.

## Runtime Flow

### Setup Flow

1. User chats with setup assistant.
2. Assistant maintains a draft `CampaignBootstrapRequest`.
3. Assistant asks only high-value missing questions.
4. User confirms.
5. Backend writes campaign bundle.
6. UI opens first playable session.

### Play Flow

1. User sends turn.
2. Backend resolves campaign/session/controlled characters.
3. Backend parses OOC/slash commands.
4. Backend loads structured state, recap, timeline, recent transcript, character memory, and selected lore.
5. Provider adapter generates the next GM/NPC response.
6. Backend validates structured output.
7. Backend persists transcript, turn metadata, usage, and state changes.
8. Backend refreshes transcript memory and marks review needs when appropriate.

### Review Flow

1. User requests review or backend detects drift risk.
2. Reviewer receives saved artifacts plus transcript slices.
3. Reviewer returns structured findings.
4. User can approve state corrections.

## API Surface

Initial backend endpoints:

- `GET /health`
- `POST /setup/respond`
- `POST /campaign/bootstrap`
- `GET /campaigns`
- `GET /campaigns/{campaign_id}`
- `GET /campaigns/{campaign_id}/bundle`
- `POST /campaigns/{campaign_id}/sessions`
- `GET /sessions/{session_id}`
- `POST /sessions/{session_id}/turn`
- `GET /sessions/{session_id}/history`
- `POST /sessions/{session_id}/review`
- `POST /memory/index`
- `POST /memory/search`
- `GET /providers`
- `POST /providers/test`

Later endpoints:

- character CRUD
- avatar upload
- document upload/indexing
- rewind/fork management
- TTS/STT
- export/import

## Frontend Plan

Build a responsive React app with:

- campaign browser
- session browser
- setup wizard/chat
- play screen
- character manager
- provider/model settings
- retrieval/memory/debug panel
- continuity review panel

The first UI should be utilitarian and information-dense, not a marketing landing page. It should make the runtime easy to inspect.

## Migration Strategy

### Keep

From RolePlayGPT:

- FastAPI project shape
- campaign bundle schema
- bootstrap service
- setup assistant concept
- local play flow
- campaign/session/fork storage
- transcript memory
- review endpoint
- GPT instructions as a style baseline
- tests as a quality bar

From CharacterRPG:

- product name and repo
- character/profile bundle concepts
- story/session/player-control ideas
- Ollama JSON parsing approach
- provider/model selector goals
- usage telemetry concept
- avatars and uploads
- CLI/playground ideas
- React Native screens as rough UX notes

### Replace

- Node/Express as the long-term core backend.
- React Native as the first production UI.
- provider-specific logic embedded inside turn routes.
- placeholder RAG/reviewer code presented as complete retrieval.

### Preserve For Reference

- Existing `server/` and `app/` should stay in the repo until the new backend and web UI cover their useful behavior.
- Do not delete old code until replacement functionality is tested.

## Implementation Phases

### Phase 1: Backend Foundation

- Add Python FastAPI backend to CharacterRPG.
- Copy/adapt RolePlayGPT campaign models, storage, bootstrap, setup, play, review, transcript memory.
- Rename environment variables and app metadata to CharacterRPG.
- Add a provider abstraction with mock and OpenAI-compatible implementations.
- Add tests for health, bootstrap, provider mock turn, session creation, and transcript persistence.

Acceptance:

- Backend imports cleanly.
- Tests pass in Termux venv.
- A campaign can be bootstrapped and a mock turn can be persisted.

### Phase 2: Provider Routing

- Implement OpenAI Responses adapter.
- Implement generic OpenAI-compatible adapter.
- Implement Ollama adapter.
- Add provider config schema and `/providers` endpoints.
- Normalize errors and usage metadata.

Acceptance:

- Same play request works with `mock`, `openai_responses`, and `ollama`.
- Missing keys and unreachable providers return actionable errors.

### Phase 3: Character Runtime

- Add character library and campaign cast APIs.
- Port player-controlled/model-controlled rules.
- Add character prompt bundle import/export.
- Add per-character memory and awareness boundaries.

Acceptance:

- Multi-character scenes validate speaker names.
- Backend refuses to generate turns for player-controlled characters.

### Phase 4: Web App

- Add React + TypeScript web app.
- Build setup, campaign/session, play, provider settings, and review screens.
- Use the new backend API only.

Acceptance:

- User can create a campaign, start a session, send turns, review history, and switch providers from a browser.

### Phase 5: Retrieval And Continuity

- Improve transcript memory search.
- Add lore/document ingestion.
- Add reviewer-reranker boundary.
- Add state correction approval flow.

Acceptance:

- Earlier transcript details can be recalled without loading full transcripts.
- Review findings are traceable to transcript/artifact evidence.

### Phase 6: Android Packaging

- Convert the web app to PWA.
- Test on Android Chrome.
- Add Capacitor wrapper only if installable app behavior is needed.

Acceptance:

- The same web UI works on desktop and Android.
- Installable Android path does not fork core logic.

### Phase 7: Voice

- Add TTS and STT as optional adapters.
- Keep transcript-first behavior.
- Add barge-in/continuation capsules after basic voice works.

Acceptance:

- Text remains canonical.
- Voice is an ergonomic layer, not a separate runtime.

## Immediate Next Steps

1. Add the new Python backend skeleton.
2. Copy/adapt the RolePlayGPT campaign core.
3. Add provider abstraction.
4. Add tests that prove the new backend is independent from RolePlayGPT.
5. Leave old Node/RN code untouched until equivalent features exist.
