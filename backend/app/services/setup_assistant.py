from __future__ import annotations

import json
from typing import Any

from backend.app.config import settings
from backend.app.model_utils import model_dump, model_validate
from backend.app.models.bootstrap import CampaignBootstrapRequest
from backend.app.models.setup import CampaignSetupRequest, CampaignSetupResponse, SetupChatMessage
from backend.app.services.campaign_bootstrap import _load_lore_context
from backend.app.services.local_play import _extract_error_message, _extract_output_text
from backend.app.services.model_providers import (
    ModelMessage,
    ModelProviderError,
    ModelRequest,
    generate_model_text,
)


def _setup_messages(conversation: list[SetupChatMessage], user_message: str) -> list[dict[str, str]]:
    messages = [{"role": message.role, "content": message.content} for message in conversation]
    messages.append({"role": "user", "content": user_message})
    return messages


def _build_setup_instructions(request: CampaignSetupRequest, lore_context: str | None) -> str:
    draft_payload = model_dump(request.draft)
    lore_block = lore_context or "No lore files were provided."
    return (
        "You are the CharacterRPG campaign setup guide. "
        "Your job is to help the player shape a campaign in a natural, collaborative way before play begins.\n\n"
        "Goals:\n"
        "- Make the setup feel conversational, creative, and light instead of form-filling.\n"
        "- Use the player's lore carefully; do not invent canon that contradicts provided material.\n"
        "- Ask only the highest-value follow-up questions. One to three concrete questions is enough when details are missing.\n"
        "- If enough information already exists, stop asking setup questions and present a concise review for confirmation.\n"
        "- Keep the tone imaginative and inviting, but still practical.\n\n"
        "Return ONLY valid JSON with this shape:\n"
        "{\n"
        '  "assistant_reply": "string",\n'
        '  "draft": { ... CampaignBootstrapRequest fields ... },\n'
        '  "ready_to_bootstrap": true or false,\n'
        '  "missing_fields": ["field.path", "..."]\n'
        "}\n\n"
        "Rules for the draft:\n"
        "- Preserve useful existing draft values unless the user clearly changes them.\n"
        "- Keep allow_inference true unless the user asks for stricter confirmation.\n"
        "- Use lore_text or lore_paths from the existing draft when they were provided.\n"
        "- Missing fields should name only the most important unresolved items.\n\n"
        f"Current draft:\n{json.dumps(draft_payload, ensure_ascii=True, indent=2)}\n\n"
        f"Available lore context:\n{lore_block}\n"
    )


def _extract_json_object(text: str) -> dict[str, Any]:
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
        raise RuntimeError("Setup assistant returned no JSON object.")
    return json.loads(stripped[start : end + 1])


def _normalize_missing_fields(payload: Any) -> list[str]:
    if not isinstance(payload, list):
        return []
    return [str(entry).strip() for entry in payload if str(entry).strip()]


def _minimum_missing_fields(draft: CampaignBootstrapRequest) -> list[str]:
    missing: list[str] = []
    if not (draft.setting and draft.setting.strip()) and not (draft.lore_text and draft.lore_text.strip()) and not draft.lore_paths:
        missing.append("setting_or_lore")
    if not (draft.genre_vibe and draft.genre_vibe.strip()):
        missing.append("genre_vibe")
    if not (draft.player_character.concept and draft.player_character.concept.strip()):
        missing.append("player_character.concept")
    return missing


def generate_setup_response(
    request: CampaignSetupRequest,
    client: Any | None = None,
) -> CampaignSetupResponse:
    user_message = request.user_message.strip()
    if not user_message:
        raise ValueError("user_message must not be empty.")

    lore_context, lore_sources = _load_lore_context(request.draft)
    model = request.model or settings.default_model
    instructions = _build_setup_instructions(request, lore_context)
    if client is not None:
        response = client.post(
            "/responses",
            json={
                "model": model,
                "instructions": instructions,
                "input": _setup_messages(request.conversation, user_message),
            },
        )
        if getattr(response, "status_code", 200) >= 400:
            raise RuntimeError(_extract_error_message(response.json()))
        output_text = _extract_output_text(response.json())
    else:
        try:
            model_response = generate_model_text(
                ModelRequest(
                    provider=request.provider,
                    model=request.model,
                    api_key=request.provider_api_key,
                    base_url=request.provider_base_url,
                    instructions=instructions,
                    messages=[
                        *[
                            ModelMessage(role=message.role, content=message.content)
                            for message in request.conversation
                        ],
                        ModelMessage(role="user", content=user_message),
                    ],
                )
            )
        except ModelProviderError as exc:
            raise RuntimeError(str(exc)) from exc
        output_text = model_response.text
    if not output_text:
        raise RuntimeError("Model provider returned an empty setup response.")

    payload = _extract_json_object(output_text)
    assistant_reply = str(payload.get("assistant_reply") or "").strip()
    if not assistant_reply:
        raise RuntimeError("Setup assistant response did not include assistant_reply.")

    draft_payload = payload.get("draft") or {}
    draft = model_validate(CampaignBootstrapRequest, draft_payload)
    if request.draft.lore_paths and not draft.lore_paths:
        draft.lore_paths = list(request.draft.lore_paths)
    if request.draft.lore_text and not draft.lore_text:
        draft.lore_text = request.draft.lore_text
    if request.draft.context_summary and not draft.context_summary:
        draft.context_summary = request.draft.context_summary

    missing_fields = _normalize_missing_fields(payload.get("missing_fields"))
    minimum_missing = _minimum_missing_fields(draft)
    for field in minimum_missing:
        if field not in missing_fields:
            missing_fields.append(field)

    ready_flag = bool(payload.get("ready_to_bootstrap"))
    ready_to_bootstrap = ready_flag and not minimum_missing

    return CampaignSetupResponse(
        assistant_reply=assistant_reply,
        draft=draft,
        ready_to_bootstrap=ready_to_bootstrap,
        missing_fields=missing_fields,
        lore_sources=lore_sources,
    )
