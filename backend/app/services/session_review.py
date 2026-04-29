from __future__ import annotations

import json
from typing import Any

import yaml

from backend.app.config import settings
from backend.app.model_utils import model_dump, model_validate
from backend.app.models.review import SessionReviewFinding, SessionReviewRequest, SessionReviewResponse
from backend.app.services.campaign_storage import CampaignStorage
from backend.app.services.local_play import _extract_error_message, _extract_output_text
from backend.app.services.model_providers import (
    ModelMessage,
    ModelProviderError,
    ModelRequest,
    generate_model_text,
)


def _resolve_review_storage(request: SessionReviewRequest, storage: CampaignStorage) -> tuple[CampaignStorage, str, str]:
    if not request.session_id:
        if request.campaign_id:
            campaign_storage = storage.for_campaign(request.campaign_id)
            if not campaign_storage.has_bundle():
                raise ValueError(f'Campaign {request.campaign_id!r} does not exist.')
            return campaign_storage, campaign_storage.current_campaign_id, 'root'
        return storage, 'root', 'root'

    session_storage = storage.resolve_session_storage(request.session_id, request.campaign_id)
    summary = session_storage.load_session_summary()
    return session_storage, summary.campaign_id, summary.session_id


def _build_review_context(
    request: SessionReviewRequest,
    storage: CampaignStorage,
    campaign_id: str,
    session_id: str,
) -> tuple[str, int, int]:
    bundle = storage.load_bundle()
    history_limit = request.transcript_turns * 2
    history = storage.load_play_history(limit=history_limit)
    session_summary = storage.load_session_summary() if session_id != 'root' else None

    payload = {
        'campaign_id': campaign_id,
        'session_id': session_id,
        'session_summary': model_dump(session_summary) if session_summary is not None else None,
        'focus_areas': request.focus_areas,
        'world_state': model_dump(bundle.world_state),
        'scenario': model_dump(bundle.scenario),
        'relationship_graph': bundle.relationship_graph,
        'recent_timeline': bundle.timeline[-12:],
        'recap': bundle.recap,
        'event_queue': bundle.event_queue,
        'characters': [model_dump(character) for character in bundle.rpg_characters],
        'recent_transcript': [model_dump(entry) for entry in history],
        'user_note': request.user_note,
    }
    return yaml.safe_dump(payload, sort_keys=False).strip(), len(history), len(bundle.timeline[-12:])


def _build_review_instructions(request: SessionReviewRequest, context: str) -> str:
    focus_list = ', '.join(request.focus_areas)
    return (
        'You are reviewing a CharacterRPG campaign session for continuity and persistence errors. '
        'Your goal is to compare the saved bundle artifacts against the recent transcript and identify likely mismatches.\n\n'
        'Audit priorities:\n'
        '- Catch wrong locations, map or spatial continuity errors, incorrect recap/timeline state, relationship drift, and session branch confusion.\n'
        '- Prefer concrete, actionable findings over vague criticism.\n'
        '- If something looks correct, it is fine to say so.\n'
        '- Treat "map" as location/spatial continuity reflected in world_state, recap, timeline, notes, and transcript beats.\n'
        '- Focus only on the requested areas unless another critical inconsistency is obvious.\n\n'
        'Return ONLY valid JSON with this shape:\n'
        '{\n'
        '  "assistant_summary": "string",\n'
        '  "findings": [\n'
        '    {\n'
        '      "severity": "info|warning|critical",\n'
        '      "artifact": "world_state|recap|timeline|relationship_graph|scenario|session|other",\n'
        '      "issue": "string",\n'
        '      "evidence": ["string", "..."],\n'
        '      "suggested_update": "string or null"\n'
        '    }\n'
        '  ]\n'
        '}\n\n'
        f'Requested focus areas: {focus_list}\n\n'
        f'Context to review:\n{context}'
    )


def _extract_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith('```'):
        lines = stripped.splitlines()
        if lines and lines[0].startswith('```'):
            lines = lines[1:]
        if lines and lines[-1].startswith('```'):
            lines = lines[:-1]
        stripped = '\n'.join(lines).strip()

    start = stripped.find('{')
    end = stripped.rfind('}')
    if start == -1 or end == -1 or end < start:
        raise RuntimeError('Session review returned no JSON object.')
    return json.loads(stripped[start : end + 1])


def generate_session_review(
    request: SessionReviewRequest,
    storage: CampaignStorage,
    client: Any | None = None,
) -> SessionReviewResponse:
    active_storage, campaign_id, session_id = _resolve_review_storage(request, storage)
    review_context, transcript_entries, timeline_entries = _build_review_context(
        request,
        active_storage,
        campaign_id,
        session_id,
    )
    model = request.model or settings.default_model
    instructions = _build_review_instructions(request, review_context)
    if client is not None:
        response = client.post(
            '/responses',
            json={
                'model': model,
                'instructions': instructions,
                'input': [
                    {
                        'role': 'user',
                        'content': 'Review this session for continuity and saved-state accuracy.',
                    }
                ],
            },
        )
        if getattr(response, 'status_code', 200) >= 400:
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
                        ModelMessage(
                            role='user',
                            content='Review this session for continuity and saved-state accuracy.',
                        )
                    ],
                )
            )
        except ModelProviderError as exc:
            raise RuntimeError(str(exc)) from exc
        output_text = model_response.text
    if not output_text:
        raise RuntimeError('Model provider returned an empty session review response.')

    payload = _extract_json_object(output_text)
    summary = str(payload.get('assistant_summary') or '').strip()
    if not summary:
        raise RuntimeError('Session review response did not include assistant_summary.')

    findings_payload = payload.get('findings') or []
    findings = [model_validate(SessionReviewFinding, item) for item in findings_payload]

    return SessionReviewResponse(
        campaign_id=campaign_id,
        session_id=session_id,
        focus_areas=list(request.focus_areas),
        assistant_summary=summary,
        findings=findings,
        transcript_entries_analyzed=transcript_entries,
        timeline_entries_analyzed=timeline_entries,
    )
