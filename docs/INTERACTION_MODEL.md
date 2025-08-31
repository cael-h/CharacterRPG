# Interaction Model

## Slash Commands
- `/LLM <directive>`: Meta-instructions that affect style/policy (e.g., `/LLM keep responses to a few sentences`).
- `/<NPCName> <message>`: Address a specific NPC directly without extra narration (nicknames allowed).
- `/scene <note>`: Adjust or annotate scene setting (location/time/participants), e.g., `/scene It's now dusk; we move to the kitchen`.
 - (Optional later) `/timeline <note>`: add a high-level event to the global timeline; the system will also extract events automatically.

Parsing rules
- Commands are only recognized at the start of a new user turn.
- Multiple commands can appear; apply in order, then pass remaining text to the conversation.
- All commands are logged and reflected in transcript/setting as appropriate.

## Transcript and Files
- Database remains the system of record; we also maintain append-only files for portability:
  - `transcripts/<sessionId>.md`: verbatim turns with timestamps and speakers.
  - `memories/<characterId>.(md|json)`: durable facts extracted for each NPC; includes provenance (turn ids) and optional cross-NPC references.

## Memory Extraction
- Runs after each exchange; extracts concise, durable facts (names, relationships, goals, changes, promises, locations, inventory, rules).
- Deduplicates by hashing normalized facts; merges updates; retains provenance.
- Stores in per-NPC files and the `memories` table; can include `applies_to: [characterId,...]` to cover shared memories.

## Setting Document
- Session-scoped, human-readable document updated after each turn with:
  - Location(s), participants present, time-of-day/date, and notable state changes.
  - Longer-term continuity (e.g., travel, quests) persisted across sessions via `scene_state`.
- Heuristics handle likely returns/absences using rough time math; users can override with `/scene`.

## Snapshot/Rewind
- At each turn, record a snapshot pointer (turn id + serialized state summary) in `snapshots`.
- Rewind restores prior state and allows regenerating from that point; the original branch remains accessible.

## Safety & UX Notes
- Commands are sanitized before reaching the LLM; `/LLM` metadata may be injected into system messages.
- Transcript always shows explicit speaker labels; NPC bubbles include circular avatars and `Name:` prefixes.
- Background image behavior is off by default; can be enabled later (`activeSpeaker`).
