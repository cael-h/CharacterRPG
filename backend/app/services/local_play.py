from __future__ import annotations

from datetime import UTC, datetime
from functools import lru_cache
from typing import Any, Protocol

import yaml

from backend.app.config import PROJECT_ROOT, settings
from backend.app.model_utils import model_dump
from backend.app.models.bootstrap import CampaignBundle
from backend.app.models.play import LocalPlayRequest, LocalPlayResponse, PlaySessionSummary, PlayTranscriptEntry
from backend.app.services.campaign_storage import CampaignStorage
from backend.app.services.model_providers import (
    ModelMessage,
    ModelProviderError,
    ModelRequest,
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


def _build_runtime_instructions(
    bundle: CampaignBundle,
    *,
    session_summary: PlaySessionSummary | None = None,
    include_choices: bool = False,
) -> str:
    base_instructions = load_gpt_instructions()
    campaign_context = _build_campaign_context(bundle, session_summary)
    choice_policy = (
        '- Offer a short choice list only when the player explicitly asks for options or the scene has become genuinely hard to parse.\n'
        if not include_choices
        else '- Include a short, optional choice list at the end of the turn because this session explicitly asked for it.\n'
    )
    return (
        f"{base_instructions}\n\n"
        "LOCAL BACKEND EMULATION MODE\n"
        "- You are running through a local backend play endpoint for self-testing.\n"
        "- The backend campaign bundle below is the current source of truth.\n"
        "- Keep replies focused on the GM response only.\n"
        "- Do not claim files were updated unless the backend confirms persistence.\n"
        "- Treat any player message beginning with OOC: or [OOC: as an out-of-character rule or preference update. Acknowledge it briefly, follow it immediately, and do not turn it into an in-world action.\n"
        "- Default to narrative judgment instead of dice unless the campaign preferences explicitly call for rolls in a specific case.\n"
        "- Drive the scene forward. NPCs and the environment should take small but meaningful actions, offer invitations, interrupt, reveal, complicate, or emotionally escalate when appropriate instead of only reacting passively.\n"
        "- Do not merely paraphrase the player's move and ask what happens next. Advance the moment while preserving player agency.\n"
        f"{choice_policy}"
        "\nCURRENT CAMPAIGN BUNDLE\n"
        f"{campaign_context}"
    )


def _history_to_responses_input(history: list[PlayTranscriptEntry], user_message: str) -> list[dict[str, str]]:
    messages = [{"role": entry.role, "content": entry.content} for entry in history]
    messages.append({"role": "user", "content": user_message})
    return messages


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
    history_limit = request.max_history_turns * 2 if request.max_history_turns else 0
    history = active_storage.load_play_history(limit=history_limit) if history_limit else []
    model = request.model or settings.default_model
    provider = request.provider or settings.default_provider
    instructions = _build_runtime_instructions(
        bundle,
        session_summary=session_summary,
        include_choices=request.include_choices,
    )
    if client is not None:
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
        reply = _extract_output_text(response.json())
        resolved_provider = "client"
        resolved_model = model
    else:
        try:
            model_response = generate_model_text(
                ModelRequest(
                    provider=provider,
                    model=request.model,
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
        reply = model_response.text
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
        bundle.world_state.turn = next_turn
        active_storage.save_world_state(bundle.world_state)

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
