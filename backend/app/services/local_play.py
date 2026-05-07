from __future__ import annotations

import json
import re
import shutil
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any, Literal, Protocol
from uuid import uuid4

import yaml

from backend.app.config import PROJECT_ROOT, settings
from backend.app.model_utils import model_dump, model_validate
from backend.app.models.bootstrap import CampaignBundle
from backend.app.models.play import (
    AssistantResponseVariant,
    AssistantResponseVariantGroup,
    LocalPlayRequest,
    LocalPlayResponse,
    PlayQuestUpdate,
    PlaySessionSummary,
    PlayStoryThreadUpdate,
    PlayTranscriptEntry,
    ResponseVariantSwitchRequest,
    ResponseVariantSwitchResponse,
    RuntimeSettings,
    StructuredPlayTurn,
    TranscriptMutationRequest,
    TranscriptMutationResponse,
)
from backend.app.models.quest import QuestState
from backend.app.models.story import StoryThread
from backend.app.services.campaign_storage import CampaignStorage
from backend.app.services.model_providers import (
    ModelMessage,
    ModelProviderError,
    ModelRequest,
    ModelResponse,
    generate_model_text,
)


INSTRUCTIONS_PATH = PROJECT_ROOT / "gpt_builder" / "instructions.md"


class ResponsesClientProtocol(Protocol):
    def create(self, **kwargs: Any) -> Any:
        ...


class OpenAIClientProtocol(Protocol):
    def post(self, url: str, **kwargs: Any) -> Any:
        ...


@lru_cache(maxsize=1)
def load_gpt_instructions() -> str:
    return INSTRUCTIONS_PATH.read_text(encoding="utf-8").strip()


def _get_openai_client() -> OpenAIClientProtocol:
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")

    try:
        import httpx
    except ImportError as exc:
        raise RuntimeError(
            "The httpx package is not installed. Install it with `python -m pip install -e .[play]`."
        ) from exc

    return httpx.Client(
        base_url=settings.openai_base_url,
        headers={
            "Authorization": f"Bearer {settings.openai_api_key}",
            "Content-Type": "application/json",
        },
        timeout=60.0,
    )


def _build_campaign_context(bundle: CampaignBundle, session_summary: PlaySessionSummary | None) -> str:
    payload = {
        "campaign_id": bundle.world_state.campaign_id,
        "turn": bundle.world_state.turn,
        "scenario": model_dump(bundle.scenario),
        "world_state": {
            "current_scene": bundle.world_state.current_scene,
            "location": bundle.world_state.location,
            "time_of_day": bundle.world_state.time_of_day,
            "world_pressure": bundle.world_state.world_pressure,
            "pressure_clock": bundle.world_state.pressure_clock,
            "notes": bundle.world_state.notes,
        },
        "factions": [model_dump(faction) for faction in bundle.factions],
        "story_threads": [model_dump(thread) for thread in bundle.story_threads],
        "event_queue": bundle.event_queue,
        "quests": [model_dump(quest) for quest in bundle.quests],
        "relationship_graph": bundle.relationship_graph,
        "rpg_characters": [model_dump(character) for character in bundle.rpg_characters],
        "recent_timeline": bundle.timeline[-8:],
        "recap": bundle.recap,
    }
    if session_summary is not None:
        payload["session"] = model_dump(session_summary)
    return yaml.safe_dump(payload, sort_keys=False).strip()


def _player_character_name(bundle: CampaignBundle) -> str | None:
    for character in bundle.rpg_characters:
        if "player" in character.role.lower():
            return character.name
    return None


def _select_director_thread(bundle: CampaignBundle) -> StoryThread | None:
    active_threads = [
        thread
        for thread in bundle.story_threads
        if thread.status.lower() not in {"resolved", "closed", "complete"}
    ]
    if not active_threads:
        return None
    return sorted(
        active_threads,
        key=lambda thread: (thread.last_advanced_turn, -thread.tension, thread.thread_id),
    )[0]


def _build_story_director_brief(bundle: CampaignBundle) -> str:
    thread = _select_director_thread(bundle)
    if thread is None:
        return (
            "STORY DIRECTOR BRIEF\n"
            "- No explicit story threads are available yet. Keep momentum by revealing information, "
            "deepening a relationship, adding a complication, changing the situation, or moving the scene."
        )

    turns_since_advance = max(0, bundle.world_state.turn - thread.last_advanced_turn)
    pressure_note = (
        "This thread has been quiet; bring it onstage now."
        if turns_since_advance >= 2
        else "Use it if it naturally fits the player's move."
    )
    return (
        "STORY DIRECTOR BRIEF\n"
        "- Story momentum does not require factions. Use factions only if they fit this campaign.\n"
        "- Every GM turn should do at least one concrete movement job: reveal information, complicate "
        "the situation, deepen a relationship, escalate a threat, change the environment, force a "
        "meaningful choice, or resolve/mutate a story thread.\n"
        f"- Focus thread: {thread.title} ({thread.type}, tension {thread.tension}/10).\n"
        f"- Current beat: {thread.current_beat}\n"
        f"- Suggested next beat: {thread.next_beat}\n"
        f"- Unresolved question: {thread.unresolved_question or 'What changes because of this turn?'}\n"
        f"- Director note: {pressure_note}"
    )


def _build_runtime_instructions(
    bundle: CampaignBundle,
    *,
    session_summary: PlaySessionSummary | None = None,
    runtime_settings: RuntimeSettings | None = None,
    include_choices: bool = False,
) -> str:
    base_instructions = load_gpt_instructions()
    campaign_context = _build_campaign_context(bundle, session_summary)
    director_brief = _build_story_director_brief(bundle)
    choice_policy = (
        '- Offer a short choice list only when the player explicitly asks for options or the scene has become genuinely hard to parse.\n'
        if not include_choices
        else '- Include a short, optional choice list at the end of the turn because this session explicitly asked for it.\n'
    )
    player_character = _player_character_name(bundle)
    player_character_policy = (
        f"- Current player character: {player_character}. The user controls this character. Do not rename them, speak for them, emote for them, or reuse their name for an NPC.\n"
        if player_character
        else ""
    )
    mature_policy = (
        "- Mature/NSFW material is enabled for this runtime. Allow consenting-adult themes when they naturally follow from the story; do not force them. Never include sexual content involving minors or sexual violence.\n"
        if runtime_settings and runtime_settings.mature_content_enabled
        else ""
    )
    runtime_notes = (
        f"\nOPERATOR RUNTIME NOTES\n{runtime_settings.notes.strip()}\n"
        if runtime_settings and runtime_settings.notes and runtime_settings.notes.strip()
        else ""
    )
    return (
        f"{base_instructions}\n\n"
        "LOCAL BACKEND EMULATION MODE\n"
        "- You are running through a local backend play endpoint for self-testing.\n"
        "- The backend campaign bundle below is the current source of truth.\n"
        "- Keep replies focused on the GM response only.\n"
        "- Preserve the campaign title, setting, player character, NPC names, faction facts, and scene facts from the bundle unless the user explicitly changes them.\n"
        "- Do not claim files were updated unless the backend confirms persistence.\n"
        "- Treat any player message beginning with OOC: or [OOC: as an out-of-character rule or preference update. Acknowledge it briefly, follow it immediately, and do not turn it into an in-world action.\n"
        "- Never reveal hidden planning, analysis, or response-writing notes. Do not mention the prompt, instructions, user prompt, established style, or what you intend to write.\n"
        "- Default to narrative judgment instead of dice unless the campaign preferences explicitly call for rolls in a specific case.\n"
        "- Drive the scene forward. NPCs and the environment should take small but meaningful actions, offer invitations, interrupt, reveal, complicate, or emotionally escalate when appropriate instead of only reacting passively.\n"
        "- Do not merely paraphrase the player's move and ask what happens next. Advance the moment while preserving player agency.\n"
        "\nPLAYER-INTERPRETATION POLICY\n"
        "- Describe observable action, dialogue, body language, sensory detail, and physical consequences. Let the player interpret what those details mean.\n"
        "- Do not narrate the player character's thoughts, assumptions, feelings, conclusions, or sense that a statement 'lands' unless the player explicitly wrote that reaction.\n"
        "- Avoid empty interpretive filler such as 'That lands,' 'That alone says something,' 'You can tell,' 'It is clear,' or similar claims that tell the player what to think.\n"
        "- If an NPC implies they know something hidden, decide the concrete hidden fact before implying it. If it is not revealed in `reply`, record the unrevealed fact in `npc_memory_notes`, `notes_append`, or a story thread update so it can be paid off later.\n"
        "- Do not create vague mystery implications as mood. Every implied secret should have a specific answer, holder, and plausible reveal path.\n"
        f"{player_character_policy}"
        f"{mature_policy}"
        f"{choice_policy}"
        "\nSTRUCTURED TURN OUTPUT\n"
        "- Return exactly one JSON object and no markdown fences.\n"
        "- The `reply` field is the only player-facing text shown in the transcript.\n"
        "- Do not put [OOC], GM notes, mechanics notes, JSON, or state bookkeeping in `reply`; put changed facts in the update fields.\n"
        "- Use update fields only for concrete changes established by this turn. Leave fields empty when nothing changed.\n"
        "- Keep state updates conservative. Do not close quests, move location, or change pressure unless the reply actually establishes it.\n"
        "- Use `npc_memory_notes` for unrevealed NPC knowledge, planned secrets, and private motivations implied by the reply.\n"
        "- JSON shape:\n"
        "{\n"
        '  "reply": "player-facing narration and dialogue only",\n'
        '  "state_updates": {"current_scene": null, "location": null, "time_of_day": null, "world_pressure": null, "pressure_clock": null, "notes_append": []},\n'
        '  "timeline_entries": [],\n'
        '  "recap_delta": null,\n'
        '  "quest_updates": [{"quest_id": null, "title": "string", "status": "open|closed|changed", "summary": "string", "source_faction": "string"}],\n'
        '  "story_thread_updates": [{"thread_id": null, "type": "mystery|relationship|threat|personal_arc|environment|faction|scene|continuity|story", "title": "string", "status": "active|resolved|changed", "tension": null, "summary": "string", "current_beat": "string", "next_beat": "string", "unresolved_question": "string"}],\n'
        '  "event_queue_updates": {"add": [], "remove": []},\n'
        '  "npc_memory_notes": []\n'
        "}\n"
        f"{runtime_notes}"
        f"\n{director_brief}\n"
        "\nCURRENT CAMPAIGN BUNDLE\n"
        f"{campaign_context}"
    )


def _history_to_responses_input(history: list[PlayTranscriptEntry], user_message: str) -> list[dict[str, str]]:
    messages = [{"role": entry.role, "content": entry.content} for entry in history]
    messages.append({"role": "user", "content": user_message})
    return messages


def _is_ooc_message(user_message: str) -> bool:
    lowered = user_message.lstrip().lower()
    return lowered.startswith("ooc:") or lowered.startswith("[ooc:")


def _looks_like_hidden_planning(text: str) -> bool:
    lowered = " ".join(text.lower().split())[:700]
    starts = (
        "okay, i'm going to",
        "ok, i'm going to",
        "i will write",
        "i'm going to write",
        "i need to write",
        "i should write",
    )
    if lowered.startswith(starts):
        return True
    markers = (
        "the user's prompt",
        "the user prompt",
        "write a response",
        "response prose here",
        "i should describe",
        "i need to advance the scene",
        "in the established style",
        "end with a prompt",
    )
    return any(marker in lowered for marker in markers)


def _model_response_looks_like_hidden_planning(text: str) -> bool:
    if _looks_like_hidden_planning(text):
        return True
    structured_turn = _parse_structured_turn(text)
    return structured_turn is not None and _looks_like_hidden_planning(structured_turn.reply)


def _generate_with_retry_on_hidden_planning(request: ModelRequest) -> ModelResponse:
    response = generate_model_text(request)
    if not _model_response_looks_like_hidden_planning(response.text):
        return response

    retry_response = generate_model_text(
        ModelRequest(
            provider=request.provider,
            model=request.model,
            api_key=request.api_key,
            base_url=request.base_url,
            temperature=request.temperature,
            instructions=(
                f"{request.instructions}\n\n"
                "OUTPUT REPAIR\n"
                "- The prior attempt exposed hidden planning instead of a player-facing GM response.\n"
                "- Rewrite the response as final narration and NPC dialogue only.\n"
                "- Do not mention prompts, instructions, the user prompt, planning, analysis, or the act of writing.\n"
                "- Preserve the existing campaign facts and player agency."
            ),
            messages=request.messages,
        )
    )
    if _model_response_looks_like_hidden_planning(retry_response.text):
        raise ModelProviderError("Model returned hidden planning text after one repair attempt.")
    return retry_response


def _generate_with_structured_repair(request: ModelRequest) -> tuple[ModelResponse, StructuredPlayTurn | None]:
    response = _generate_with_retry_on_hidden_planning(request)
    structured_turn = _parse_structured_turn(response.text)
    if structured_turn is not None or (request.provider or settings.default_provider) == "mock":
        return response, structured_turn

    try:
        repair_response = _generate_with_retry_on_hidden_planning(
            ModelRequest(
                provider=request.provider,
                model=request.model,
                api_key=request.api_key,
                base_url=request.base_url,
                temperature=request.temperature,
                instructions=(
                    f"{request.instructions}\n\n"
                    "STRUCTURED OUTPUT REPAIR\n"
                    "- The prior attempt produced a usable GM reply but did not follow the required JSON contract.\n"
                    "- Convert the prior response below into exactly one JSON object using the required schema.\n"
                    "- Preserve the player-facing narration and dialogue in `reply`.\n"
                    "- Use empty arrays and null state fields when the prior response did not establish a concrete update.\n"
                    "- Return JSON only, with no markdown fences.\n\n"
                    "PRIOR NON-JSON RESPONSE\n"
                    f"{response.text[:5000]}"
                ),
                messages=request.messages,
            )
        )
    except ModelProviderError:
        return response, None

    repaired_turn = _parse_structured_turn(repair_response.text)
    if repaired_turn is None:
        return response, None
    return repair_response, repaired_turn


def _extract_json_object(text: str) -> dict[str, Any] | None:
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()

    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end < start:
        return None
    try:
        payload = json.loads(stripped[start : end + 1])
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _parse_structured_turn(text: str) -> StructuredPlayTurn | None:
    payload = _extract_json_object(text)
    if payload is None or "reply" not in payload:
        return None
    try:
        turn = model_validate(StructuredPlayTurn, payload)
    except Exception:
        return None
    return turn


def _clean_player_facing_reply(text: str) -> str:
    lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.lower().startswith(("[ooc:", "(ooc:", "ooc:")):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def _reply_excerpt(text: str, *, limit: int = 220) -> str:
    flattened = " ".join(text.split()).strip()
    if len(flattened) <= limit:
        return flattened
    return flattened[: limit - 3].rstrip() + "..."


def _clean_update_entries(entries: list[str], *, max_entries: int = 8) -> list[str]:
    cleaned: list[str] = []
    for entry in entries:
        value = " ".join(str(entry).split()).strip()
        if value and value not in cleaned:
            cleaned.append(value)
        if len(cleaned) >= max_entries:
            break
    return cleaned


def _apply_quest_update(
    quests: list[QuestState],
    update: PlayQuestUpdate,
    *,
    next_turn: int,
) -> None:
    title = (update.title or "").strip()
    summary = (update.summary or "").strip()
    quest_id = (update.quest_id or "").strip()
    target: QuestState | None = None
    if quest_id:
        target = next((quest for quest in quests if quest.quest_id == quest_id), None)
    if target is None and title:
        target = next((quest for quest in quests if quest.title.lower() == title.lower()), None)

    if target is None:
        if not title or not summary:
            return
        base_id = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "quest"
        existing_ids = {quest.quest_id for quest in quests}
        candidate_id = quest_id or f"{base_id}-{next_turn}"
        suffix = 2
        while candidate_id in existing_ids:
            candidate_id = f"{base_id}-{next_turn}-{suffix}"
            suffix += 1
        quests.append(
            QuestState(
                quest_id=candidate_id,
                title=title,
                status=(update.status or "open").strip() or "open",
                summary=summary,
                source_faction=(update.source_faction or "unknown").strip() or "unknown",
                created_turn=next_turn,
            )
        )
        return

    if update.status and update.status.strip():
        target.status = update.status.strip()
    if summary:
        target.summary = summary
    if update.source_faction and update.source_faction.strip():
        target.source_faction = update.source_faction.strip()


def _apply_story_thread_update(
    story_threads: list[StoryThread],
    update: PlayStoryThreadUpdate,
    *,
    next_turn: int,
) -> None:
    title = (update.title or "").strip()
    thread_id = (update.thread_id or "").strip()
    target: StoryThread | None = None
    if thread_id:
        target = next((thread for thread in story_threads if thread.thread_id == thread_id), None)
    if target is None and title:
        target = next((thread for thread in story_threads if thread.title.lower() == title.lower()), None)

    if target is None:
        summary = (update.summary or "").strip()
        current_beat = (update.current_beat or "").strip()
        next_beat = (update.next_beat or "").strip()
        if not title or not (summary or current_beat or next_beat):
            return
        base_id = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "thread"
        existing_ids = {thread.thread_id for thread in story_threads}
        candidate_id = thread_id or f"{base_id}-{next_turn}"
        suffix = 2
        while candidate_id in existing_ids:
            candidate_id = f"{base_id}-{next_turn}-{suffix}"
            suffix += 1
        story_threads.append(
            StoryThread(
                thread_id=candidate_id,
                type=(update.type or "story").strip() or "story",
                title=title,
                status=(update.status or "active").strip() or "active",
                tension=update.tension if update.tension is not None else 1,
                summary=summary or current_beat or next_beat,
                current_beat=current_beat or summary or "This thread has entered play.",
                next_beat=next_beat or "Push this thread with a concrete reveal, complication, or choice.",
                unresolved_question=(update.unresolved_question or "").strip() or None,
                created_turn=next_turn,
                last_advanced_turn=next_turn,
            )
        )
        return

    changed = False
    if update.type and update.type.strip():
        target.type = update.type.strip()
        changed = True
    if update.status and update.status.strip():
        target.status = update.status.strip()
        changed = True
    if update.tension is not None:
        target.tension = update.tension
        changed = True
    if update.summary and update.summary.strip():
        target.summary = update.summary.strip()
        changed = True
    if update.current_beat and update.current_beat.strip():
        target.current_beat = update.current_beat.strip()
        changed = True
    if update.next_beat and update.next_beat.strip():
        target.next_beat = update.next_beat.strip()
        changed = True
    if update.unresolved_question and update.unresolved_question.strip():
        target.unresolved_question = update.unresolved_question.strip()
        changed = True
    if changed:
        target.last_advanced_turn = next_turn


def _apply_structured_turn_updates(
    bundle: CampaignBundle,
    structured_turn: StructuredPlayTurn | None,
    *,
    next_turn: int,
) -> None:
    if structured_turn is None:
        return

    updates = structured_turn.state_updates
    if updates.current_scene and updates.current_scene.strip():
        bundle.world_state.current_scene = updates.current_scene.strip()
    if updates.location and updates.location.strip():
        bundle.world_state.location = updates.location.strip()
    if updates.time_of_day and updates.time_of_day.strip():
        bundle.world_state.time_of_day = updates.time_of_day.strip()
    if updates.world_pressure is not None:
        bundle.world_state.world_pressure = updates.world_pressure
    if updates.pressure_clock is not None:
        bundle.world_state.pressure_clock = updates.pressure_clock

    for note in _clean_update_entries(updates.notes_append + structured_turn.npc_memory_notes):
        formatted = f"Turn {next_turn}: {note}"
        if formatted not in bundle.world_state.notes:
            bundle.world_state.notes.append(formatted)

    for entry in _clean_update_entries(structured_turn.timeline_entries):
        bundle.timeline.append(f"Turn {next_turn}: {entry}")

    if structured_turn.recap_delta and structured_turn.recap_delta.strip():
        recap_delta = structured_turn.recap_delta.strip()
        bundle.recap = f"{bundle.recap.strip()}\n\nTurn {next_turn}: {recap_delta}".strip()

    for event in _clean_update_entries(structured_turn.event_queue_updates.remove):
        bundle.event_queue = [existing for existing in bundle.event_queue if existing != event]
    for event in _clean_update_entries(structured_turn.event_queue_updates.add):
        if event not in bundle.event_queue:
            bundle.event_queue.append(event)

    for quest_update in structured_turn.quest_updates:
        _apply_quest_update(bundle.quests, quest_update, next_turn=next_turn)

    for story_thread_update in structured_turn.story_thread_updates:
        _apply_story_thread_update(bundle.story_threads, story_thread_update, next_turn=next_turn)

    bundle.world_state.active_quests = bundle.quests
    bundle.world_state.pending_events = bundle.event_queue


def _advance_director_thread_from_reply(
    bundle: CampaignBundle,
    reply: str,
    *,
    next_turn: int,
) -> None:
    thread = _select_director_thread(bundle)
    if thread is None:
        return
    thread.current_beat = f"Turn {next_turn}: {_reply_excerpt(reply)}"
    thread.last_advanced_turn = next_turn


def _extract_output_text(payload: dict[str, Any]) -> str:
    top_level = payload.get("output_text")
    if isinstance(top_level, str) and top_level.strip():
        return top_level.strip()

    text_chunks: list[str] = []
    for item in payload.get("output", []):
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content_item in item.get("content", []):
            if not isinstance(content_item, dict):
                continue
            text = content_item.get("text")
            if isinstance(text, str) and text.strip():
                text_chunks.append(text.strip())

    return "\n\n".join(text_chunks).strip()


def _extract_error_message(payload: Any) -> str:
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            if isinstance(message, str) and message.strip():
                return message.strip()
        detail = payload.get("detail")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()
    return "OpenAI request failed."


def resolve_play_storage(request: LocalPlayRequest, storage: CampaignStorage) -> tuple[CampaignStorage, PlaySessionSummary | None]:
    if not request.session_id:
        if request.campaign_id:
            campaign_storage = storage.for_campaign(request.campaign_id)
            if not campaign_storage.has_bundle():
                raise ValueError(f'Campaign {request.campaign_id!r} does not exist.')
            return campaign_storage, None
        return storage, None

    try:
        target_storage = storage.resolve_session_storage(request.session_id, request.campaign_id)
    except ValueError as exc:
        if 'does not exist' not in str(exc):
            raise
        target_storage = None

    if target_storage is not None:
        if request.fork_from_turn is not None or request.fork_from_session_id:
            raise ValueError('Fork parameters can only be used when creating a new session.')
        summary = target_storage.touch_session_summary(
            campaign_id=request.campaign_id or target_storage.current_campaign_id,
            title=request.session_title,
        )
        return target_storage, summary

    if not request.create_session_if_missing:
        raise ValueError(f'Session {request.session_id!r} does not exist.')

    source_storage = storage
    parent_session_id = None
    resolved_campaign_id = request.campaign_id
    if request.fork_from_session_id:
        source_storage = storage.resolve_session_storage(request.fork_from_session_id, request.campaign_id)
        parent_summary = source_storage.load_session_summary()
        parent_session_id = parent_summary.session_id
        resolved_campaign_id = resolved_campaign_id or parent_summary.campaign_id
    elif resolved_campaign_id:
        source_storage = storage.for_campaign(resolved_campaign_id)
        if not source_storage.has_bundle():
            raise ValueError(f'Campaign {resolved_campaign_id!r} does not exist.')
    elif not resolved_campaign_id and storage.has_bundle():
        resolved_campaign_id = storage.load_bundle().world_state.campaign_id

    created_storage = storage.initialize_session(
        request.session_id,
        campaign_id=resolved_campaign_id,
        title=request.session_title,
        source_storage=source_storage,
        parent_session_id=parent_session_id,
        fork_from_turn=request.fork_from_turn,
    )
    return created_storage, created_storage.load_session_summary()


def _resolve_runtime_settings(
    active_storage: CampaignStorage,
    storage: CampaignStorage,
    session_summary: PlaySessionSummary | None,
) -> RuntimeSettings:
    has_active_settings = active_storage.runtime_settings_path.exists()
    runtime_settings = active_storage.load_runtime_settings()
    if session_summary is not None and not has_active_settings:
        runtime_settings = storage.for_campaign(session_summary.campaign_id).load_runtime_settings()
    return runtime_settings


def _max_history_turn(history: list[PlayTranscriptEntry]) -> int:
    return max((entry.turn for entry in history), default=0)


def _resolve_transcript_mutation_storage(
    request: TranscriptMutationRequest,
    storage: CampaignStorage,
) -> tuple[CampaignStorage, PlaySessionSummary | None]:
    if request.session_id:
        active_storage = storage.resolve_session_storage(request.session_id, request.campaign_id)
        return active_storage, active_storage.load_session_summary()
    if request.campaign_id:
        campaign_storage = storage.for_campaign(request.campaign_id)
        if not campaign_storage.has_bundle():
            raise ValueError(f"Campaign {request.campaign_id!r} does not exist.")
        return campaign_storage, None
    return storage, storage.load_session_summary() if storage.session_metadata_path.exists() else None


def _backup_transcript_storage(active_storage: CampaignStorage) -> str:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    backup_dir = active_storage.base_dir.parent / "_transcript_edit_backups" / f"{stamp}-{active_storage.base_dir.name}"
    backup_dir.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(active_storage.base_dir, backup_dir)
    return str(backup_dir)


def _restore_transcript_storage(active_storage: CampaignStorage, backup_path: str) -> None:
    if active_storage.base_dir.exists():
        shutil.rmtree(active_storage.base_dir)
    shutil.copytree(backup_path, active_storage.base_dir)


def _memory_index_request(
    active_storage: CampaignStorage,
    session_summary: PlaySessionSummary | None,
):
    from backend.app.models.transcript_memory import TranscriptMemoryBuildRequest

    if session_summary is not None:
        return TranscriptMemoryBuildRequest(
            campaign_id=session_summary.campaign_id,
            session_id=session_summary.session_id,
            refresh=True,
        )
    campaign_id = None if active_storage.current_campaign_id == "root" else active_storage.current_campaign_id
    return TranscriptMemoryBuildRequest(campaign_id=campaign_id, session_id=None, refresh=True)


def _rebuild_transcript_memory(
    active_storage: CampaignStorage,
    storage: CampaignStorage,
    session_summary: PlaySessionSummary | None,
) -> int:
    from backend.app.services.transcript_memory import build_transcript_memory_index

    memory_index = build_transcript_memory_index(
        _memory_index_request(active_storage, session_summary),
        storage,
    )
    return memory_index.sections_indexed


def _touch_transcript_container(
    active_storage: CampaignStorage,
    session_summary: PlaySessionSummary | None,
    title: str | None = None,
) -> PlaySessionSummary | None:
    if session_summary is not None:
        return active_storage.touch_session_summary(campaign_id=session_summary.campaign_id, title=title)
    if active_storage.current_campaign_id != "root":
        active_storage.touch_campaign_summary(title=title)
    return None


def _restore_bundle_to_history(active_storage: CampaignStorage, history: list[PlayTranscriptEntry]) -> None:
    target_turn = _max_history_turn(history)
    snapshot = active_storage.load_turn_snapshot(target_turn)
    if snapshot is not None:
        active_storage.save_bundle(snapshot)
        active_storage.delete_turn_snapshots_after(target_turn)
        return
    if not active_storage.has_bundle():
        return
    bundle = active_storage.load_bundle()
    bundle.world_state.turn = target_turn
    active_storage.save_bundle(bundle)
    active_storage.save_turn_snapshot(target_turn, bundle)
    active_storage.delete_turn_snapshots_after(target_turn)


def _variant_group_id(turn: int) -> str:
    return f"turn-{turn}"


def _active_variant_index(group: AssistantResponseVariantGroup) -> int:
    for index, variant in enumerate(group.variants, start=1):
        if variant.variant_id == group.active_variant_id:
            return index
    return 1


def _active_variant(group: AssistantResponseVariantGroup) -> AssistantResponseVariant:
    for variant in group.variants:
        if variant.variant_id == group.active_variant_id:
            return variant
    if not group.variants:
        raise ValueError("Response variant group is empty.")
    return group.variants[0]


def _entry_with_variant_metadata(
    entry: PlayTranscriptEntry,
    group: AssistantResponseVariantGroup,
) -> PlayTranscriptEntry:
    active_variant = _active_variant(group)
    payload = model_dump(entry)
    payload["content"] = active_variant.content
    payload["variant_group_id"] = group.group_id
    payload["variant_id"] = active_variant.variant_id
    payload["variant_index"] = _active_variant_index(group)
    payload["variant_count"] = len(group.variants)
    return model_validate(PlayTranscriptEntry, payload)


def _snapshot_payload_for_turn(active_storage: CampaignStorage, turn: int) -> dict[str, Any] | None:
    snapshot = active_storage.load_turn_snapshot(turn)
    if snapshot is not None:
        return model_dump(snapshot)
    if not active_storage.has_bundle():
        return None
    bundle = active_storage.load_bundle()
    if bundle.world_state.turn != turn:
        return None
    return model_dump(bundle)


def _new_response_variant(
    content: str,
    *,
    source: Literal["original", "regenerated", "edited"],
    provider: str | None = None,
    model: str | None = None,
    bundle_snapshot: dict[str, Any] | None = None,
) -> AssistantResponseVariant:
    return AssistantResponseVariant(
        variant_id=f"rv-{uuid4().hex}",
        content=content,
        recorded_at=datetime.now(UTC).isoformat(),
        provider=provider,
        model=model,
        source=source,
        bundle_snapshot=bundle_snapshot,
    )


def _seed_variant_group_from_entry(
    active_storage: CampaignStorage,
    entry: PlayTranscriptEntry,
    *,
    content: str,
    source: Literal["original", "regenerated", "edited"],
) -> AssistantResponseVariantGroup:
    response_variants = active_storage.load_response_variants()
    group_id = entry.variant_group_id or _variant_group_id(entry.turn)
    group = response_variants.groups.get(group_id)
    if group is None:
        variant = _new_response_variant(
            content,
            source=source,
            bundle_snapshot=_snapshot_payload_for_turn(active_storage, entry.turn),
        )
        group = AssistantResponseVariantGroup(
            group_id=group_id,
            turn=entry.turn,
            active_variant_id=variant.variant_id,
            variants=[variant],
        )
        response_variants.groups[group_id] = group
        active_storage.save_response_variants(response_variants)
        return group

    active_id = entry.variant_id or group.active_variant_id
    active_variant = next((variant for variant in group.variants if variant.variant_id == active_id), None)
    if active_variant is None:
        active_variant = _new_response_variant(
            content,
            source=source,
            bundle_snapshot=_snapshot_payload_for_turn(active_storage, entry.turn),
        )
        group.variants.append(active_variant)
    else:
        active_variant.content = content
        active_variant.source = source
        snapshot = _snapshot_payload_for_turn(active_storage, entry.turn)
        if snapshot is not None:
            active_variant.bundle_snapshot = snapshot
    group.active_variant_id = active_variant.variant_id
    active_storage.save_response_variants(response_variants)
    return group


def _add_regenerated_variant(
    active_storage: CampaignStorage,
    group: AssistantResponseVariantGroup,
    response: LocalPlayResponse,
) -> AssistantResponseVariantGroup:
    response_variants = active_storage.load_response_variants()
    persisted_group = response_variants.groups.get(group.group_id, group)
    variant = _new_response_variant(
        response.reply,
        source="regenerated",
        provider=response.provider,
        model=response.model,
        bundle_snapshot=_snapshot_payload_for_turn(active_storage, response.turn),
    )
    persisted_group.turn = response.turn
    persisted_group.variants.append(variant)
    persisted_group.active_variant_id = variant.variant_id
    response_variants.groups[persisted_group.group_id] = persisted_group
    active_storage.save_response_variants(response_variants)
    return persisted_group


def _prune_response_variants_after_turn(
    active_storage: CampaignStorage,
    turn: int,
    *,
    keep_group_id: str | None = None,
) -> None:
    response_variants = active_storage.load_response_variants()
    if not response_variants.groups:
        return
    response_variants.groups = {
        group_id: group
        for group_id, group in response_variants.groups.items()
        if group.turn <= turn or group_id == keep_group_id
    }
    active_storage.save_response_variants(response_variants)


def _prune_response_variants_to_history(
    active_storage: CampaignStorage,
    history: list[PlayTranscriptEntry],
) -> None:
    response_variants = active_storage.load_response_variants()
    if not response_variants.groups:
        return
    assistant_group_ids = {
        entry.variant_group_id or _variant_group_id(entry.turn)
        for entry in history
        if entry.role == "assistant"
    }
    response_variants.groups = {
        group_id: group
        for group_id, group in response_variants.groups.items()
        if group_id in assistant_group_ids
    }
    active_storage.save_response_variants(response_variants)


def _assistant_entry_index_for_turn(history: list[PlayTranscriptEntry], turn: int) -> int | None:
    for index in range(len(history) - 1, -1, -1):
        entry = history[index]
        if entry.role == "assistant" and entry.turn == turn:
            return index
    return None


def _find_regeneration_prompt_index(
    original_history: list[PlayTranscriptEntry],
    *,
    original_index: int,
    original_entry: PlayTranscriptEntry,
    deleted: bool,
) -> int | None:
    if original_entry.role == "user":
        return None if deleted else original_index

    start_index = min(original_index, len(original_history) - 1)
    for index in range(start_index, -1, -1):
        if original_history[index].role == "user":
            return index
    return None


def _effective_mutation_identity(
    active_storage: CampaignStorage,
    session_summary: PlaySessionSummary | None,
) -> tuple[str, str]:
    if session_summary is not None:
        return session_summary.campaign_id, session_summary.session_id
    return active_storage.current_campaign_id, "root"


def mutate_play_transcript(
    request: TranscriptMutationRequest,
    storage: CampaignStorage,
) -> TranscriptMutationResponse:
    active_storage, session_summary = _resolve_transcript_mutation_storage(request, storage)
    history = active_storage.load_play_history()
    if request.entry_index >= len(history):
        raise ValueError(f"Transcript entry index {request.entry_index} does not exist.")

    if not request.delete_entry and not (request.content or "").strip():
        raise ValueError("content must not be empty unless delete_entry is true.")

    backup_path = _backup_transcript_storage(active_storage)
    original_entry = history[request.entry_index]
    mutated_history = list(history)
    action = "deleted" if request.delete_entry else "edited"

    if request.delete_entry:
        del mutated_history[request.entry_index]
    else:
        payload = model_dump(original_entry)
        payload["content"] = (request.content or "").strip()
        mutated_history[request.entry_index] = model_validate(PlayTranscriptEntry, payload)

    regenerated: LocalPlayResponse | None = None
    if request.mode == "regenerate":
        variant_group: AssistantResponseVariantGroup | None = None
        if original_entry.role == "assistant" and not request.delete_entry:
            variant_source = "edited" if mutated_history[request.entry_index].content != original_entry.content else "original"
            variant_group = _seed_variant_group_from_entry(
                active_storage,
                original_entry,
                content=mutated_history[request.entry_index].content,
                source=variant_source,
            )

        prompt_index = _find_regeneration_prompt_index(
            history,
            original_index=request.entry_index,
            original_entry=original_entry,
            deleted=request.delete_entry,
        )
        if prompt_index is None:
            base_history = mutated_history[: request.entry_index]
            active_storage.save_play_history(base_history)
            _restore_bundle_to_history(active_storage, base_history)
            _prune_response_variants_after_turn(active_storage, _max_history_turn(base_history))
            memory_sections = _rebuild_transcript_memory(active_storage, storage, session_summary)
            session_summary = _touch_transcript_container(active_storage, session_summary, request.session_title)
            campaign_id, session_id = _effective_mutation_identity(active_storage, session_summary)
            return TranscriptMutationResponse(
                campaign_id=campaign_id,
                session_id=session_id,
                mode=request.mode,
                action="deleted_and_truncated",
                turn=_max_history_turn(base_history),
                transcript_entries=len(base_history),
                memory_sections_indexed=memory_sections,
                backup_path=backup_path,
                regenerated_reply=None,
            )

        prompt_entry = mutated_history[prompt_index]
        base_history = mutated_history[:prompt_index]
        active_storage.save_play_history(base_history)
        _restore_bundle_to_history(active_storage, base_history)
        _prune_response_variants_after_turn(
            active_storage,
            _max_history_turn(base_history),
            keep_group_id=variant_group.group_id if variant_group is not None else None,
        )
        session_summary = _touch_transcript_container(active_storage, session_summary, request.session_title)
        try:
            regenerated = generate_local_play_response(
                LocalPlayRequest(
                    user_message=prompt_entry.content,
                    provider=request.provider,
                    model=request.model,
                    provider_api_key=request.provider_api_key,
                    provider_base_url=request.provider_base_url,
                    campaign_id=request.campaign_id,
                    session_id=request.session_id,
                    create_session_if_missing=False,
                    session_title=request.session_title,
                    include_choices=request.include_choices,
                ),
                storage,
            )
        except RuntimeError:
            _restore_transcript_storage(active_storage, backup_path)
            raise
        refreshed_history = active_storage.load_play_history()
        if variant_group is not None:
            variant_group = _add_regenerated_variant(active_storage, variant_group, regenerated)
            assistant_index = _assistant_entry_index_for_turn(refreshed_history, regenerated.turn)
            if assistant_index is not None:
                refreshed_history[assistant_index] = _entry_with_variant_metadata(
                    refreshed_history[assistant_index],
                    variant_group,
                )
                active_storage.save_play_history(refreshed_history)
        memory_sections = len(active_storage.load_transcript_memory())
        session_summary = active_storage.load_session_summary() if request.session_id else session_summary
        campaign_id, session_id = _effective_mutation_identity(active_storage, session_summary)
        return TranscriptMutationResponse(
            campaign_id=campaign_id,
            session_id=session_id,
            mode=request.mode,
            action=f"{action}_and_regenerated",
            turn=regenerated.turn,
            transcript_entries=len(refreshed_history),
            memory_sections_indexed=memory_sections,
            backup_path=backup_path,
            regenerated_reply=regenerated.reply,
        )

    if request.delete_entry:
        _prune_response_variants_to_history(active_storage, mutated_history)
    elif mutated_history[request.entry_index].role == "assistant" and mutated_history[request.entry_index].variant_group_id:
        _seed_variant_group_from_entry(
            active_storage,
            mutated_history[request.entry_index],
            content=mutated_history[request.entry_index].content,
            source="edited",
        )
    active_storage.save_play_history(mutated_history)
    memory_sections = _rebuild_transcript_memory(active_storage, storage, session_summary)
    session_summary = _touch_transcript_container(active_storage, session_summary, request.session_title)
    campaign_id, session_id = _effective_mutation_identity(active_storage, session_summary)
    return TranscriptMutationResponse(
        campaign_id=campaign_id,
        session_id=session_id,
        mode=request.mode,
        action=f"{action}_and_reindexed",
        turn=_max_history_turn(mutated_history),
        transcript_entries=len(mutated_history),
        memory_sections_indexed=memory_sections,
        backup_path=backup_path,
        regenerated_reply=None,
    )


def _resolve_response_variant_storage(
    request: ResponseVariantSwitchRequest,
    storage: CampaignStorage,
) -> tuple[CampaignStorage, PlaySessionSummary | None]:
    if request.session_id:
        active_storage = storage.resolve_session_storage(request.session_id, request.campaign_id)
        return active_storage, active_storage.load_session_summary()
    if request.campaign_id:
        campaign_storage = storage.for_campaign(request.campaign_id)
        if not campaign_storage.has_bundle():
            raise ValueError(f"Campaign {request.campaign_id!r} does not exist.")
        return campaign_storage, None
    return storage, storage.load_session_summary() if storage.session_metadata_path.exists() else None


def switch_response_variant(
    request: ResponseVariantSwitchRequest,
    storage: CampaignStorage,
) -> ResponseVariantSwitchResponse:
    active_storage, session_summary = _resolve_response_variant_storage(request, storage)
    history = active_storage.load_play_history()
    if request.entry_index >= len(history):
        raise ValueError(f"Transcript entry index {request.entry_index} does not exist.")

    entry = history[request.entry_index]
    if entry.role != "assistant":
        raise ValueError("Only GM response entries can have response variants.")

    group_id = entry.variant_group_id or _variant_group_id(entry.turn)
    response_variants = active_storage.load_response_variants()
    group = response_variants.groups.get(group_id)
    if group is None or len(group.variants) < 2:
        raise ValueError("This response does not have alternate variants.")

    active_index = _active_variant_index(group) - 1
    target_index: int | None = None
    if request.variant_id:
        target_index = next(
            (index for index, variant in enumerate(group.variants) if variant.variant_id == request.variant_id),
            None,
        )
        if target_index is None:
            raise ValueError(f"Response variant {request.variant_id!r} does not exist.")
    elif request.direction == "previous":
        target_index = (active_index - 1) % len(group.variants)
    elif request.direction == "next":
        target_index = (active_index + 1) % len(group.variants)
    else:
        raise ValueError("Provide either variant_id or direction.")

    target_variant = group.variants[target_index]
    group.active_variant_id = target_variant.variant_id
    response_variants.groups[group.group_id] = group
    active_storage.save_response_variants(response_variants)

    history[request.entry_index] = _entry_with_variant_metadata(entry, group)
    trimmed_history = [history_entry for history_entry in history if history_entry.turn <= group.turn]
    active_storage.save_play_history(trimmed_history)

    if target_variant.bundle_snapshot is not None:
        bundle = model_validate(CampaignBundle, target_variant.bundle_snapshot)
        active_storage.save_bundle(bundle)
        active_storage.save_turn_snapshot(group.turn, bundle)
    else:
        _restore_bundle_to_history(active_storage, trimmed_history)
    active_storage.delete_turn_snapshots_after(group.turn)
    _prune_response_variants_after_turn(active_storage, group.turn)

    memory_sections = _rebuild_transcript_memory(active_storage, storage, session_summary)
    session_summary = _touch_transcript_container(active_storage, session_summary, request.session_title)
    campaign_id, session_id = _effective_mutation_identity(active_storage, session_summary)
    return ResponseVariantSwitchResponse(
        campaign_id=campaign_id,
        session_id=session_id,
        turn=group.turn,
        entry_index=request.entry_index,
        variant_group_id=group.group_id,
        variant_id=target_variant.variant_id,
        variant_index=target_index + 1,
        variant_count=len(group.variants),
        content=target_variant.content,
        memory_sections_indexed=memory_sections,
    )


def generate_local_play_response(
    request: LocalPlayRequest,
    storage: CampaignStorage,
    client: OpenAIClientProtocol | None = None,
) -> LocalPlayResponse:
    user_message = request.user_message.strip()
    if not user_message:
        raise ValueError("user_message must not be empty.")

    active_storage, session_summary = resolve_play_storage(request, storage)
    bundle = active_storage.load_bundle()
    if request.persist_transcript:
        active_storage.save_turn_snapshot(bundle.world_state.turn, bundle)
    history_limit = request.max_history_turns * 2 if request.max_history_turns else 0
    history = active_storage.load_play_history(limit=history_limit) if history_limit else []
    runtime_settings = _resolve_runtime_settings(active_storage, storage, session_summary)
    model = request.model or runtime_settings.model or settings.default_model
    provider = request.provider or runtime_settings.provider or settings.default_provider
    include_choices = request.include_choices or runtime_settings.include_choices
    instructions = _build_runtime_instructions(
        bundle,
        session_summary=session_summary,
        runtime_settings=runtime_settings,
        include_choices=include_choices,
    )
    structured_turn: StructuredPlayTurn | None = None
    if _is_ooc_message(user_message):
        reply = "[OOC: Understood. I'll apply that preference going forward and keep the saved campaign facts unchanged.]"
        resolved_provider = "local"
        resolved_model = "ooc-ack"
    elif client is not None:
        response = client.post(
            "/responses",
            json={
                "model": model,
                "instructions": instructions,
                "input": _history_to_responses_input(history, user_message),
            },
        )
        if getattr(response, "status_code", 200) >= 400:
            raise RuntimeError(_extract_error_message(response.json()))
        output_text = _extract_output_text(response.json())
        structured_turn = _parse_structured_turn(output_text)
        reply = structured_turn.reply if structured_turn is not None else output_text
        reply = _clean_player_facing_reply(reply)
        resolved_provider = "client"
        resolved_model = model
    else:
        try:
            model_response, structured_turn = _generate_with_structured_repair(
                ModelRequest(
                    provider=provider,
                    model=request.model or runtime_settings.model,
                    api_key=request.provider_api_key,
                    base_url=request.provider_base_url,
                    instructions=instructions,
                    messages=[
                        *[ModelMessage(role=entry.role, content=entry.content) for entry in history],
                        ModelMessage(role="user", content=user_message),
                    ],
                )
            )
        except ModelProviderError as exc:
            raise RuntimeError(str(exc)) from exc
        reply = structured_turn.reply if structured_turn is not None else model_response.text
        reply = _clean_player_facing_reply(reply)
        resolved_provider = model_response.provider
        resolved_model = model_response.model
    if not reply:
        raise RuntimeError("Model provider returned an empty response.")

    current_turn = bundle.world_state.turn
    next_turn = current_turn + 1 if request.persist_transcript else current_turn
    appended = 0
    if request.persist_transcript:
        recorded_at = datetime.now(UTC).isoformat()
        entries = [
            PlayTranscriptEntry(
                role="user",
                content=user_message,
                turn=next_turn,
                recorded_at=recorded_at,
            ),
            PlayTranscriptEntry(
                role="assistant",
                content=reply,
                turn=next_turn,
                recorded_at=recorded_at,
            ),
        ]
        active_storage.append_play_history(entries)
        _apply_structured_turn_updates(bundle, structured_turn, next_turn=next_turn)
        if structured_turn is None or not structured_turn.story_thread_updates:
            _advance_director_thread_from_reply(bundle, reply, next_turn=next_turn)
        bundle.world_state.turn = next_turn
        active_storage.save_bundle(bundle)
        active_storage.save_turn_snapshot(next_turn, bundle)

        from backend.app.models.transcript_memory import TranscriptMemoryBuildRequest
        from backend.app.services.transcript_memory import build_transcript_memory_index

        build_transcript_memory_index(
            TranscriptMemoryBuildRequest(
                campaign_id=None if session_summary is None else session_summary.campaign_id,
                session_id=None if session_summary is None else session_summary.session_id,
                refresh=True,
            ),
            storage,
        )

        appended = len(entries)
        if request.session_id:
            session_summary = active_storage.touch_session_summary(
                campaign_id=None if session_summary is None else session_summary.campaign_id,
                title=request.session_title,
            )

    effective_session_id = session_summary.session_id if session_summary is not None else 'root'
    effective_campaign_id = bundle.world_state.campaign_id if session_summary is None else session_summary.campaign_id
    return LocalPlayResponse(
        campaign_id=effective_campaign_id,
        session_id=effective_session_id,
        turn=next_turn,
        provider=resolved_provider,
        model=resolved_model,
        reply=reply,
        transcript_entries_appended=appended,
        used_history_turns=len(history) // 2,
    )
