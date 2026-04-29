from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any

from backend.app.config import settings
from backend.app.model_utils import model_dump, model_validate
from backend.app.models.play import PlayTranscriptEntry
from backend.app.models.transcript_memory import (
    TranscriptMemoryBuildRequest,
    TranscriptMemoryIndexResponse,
    TranscriptMemorySearchHit,
    TranscriptMemorySearchRequest,
    TranscriptMemorySearchResponse,
    TranscriptMemorySection,
)
from backend.app.services.campaign_storage import CampaignStorage
from backend.app.services.local_play import _extract_error_message, _extract_output_text
from backend.app.services.model_providers import (
    ModelMessage,
    ModelProviderError,
    ModelRequest,
    generate_model_text,
)


STOPWORDS = {
    'about', 'after', 'again', 'against', 'almost', 'along', 'also', 'always', 'another', 'around', 'because',
    'before', 'being', 'between', 'could', 'does', 'doing', 'during', 'every', 'first', 'from', 'going', 'great',
    'have', 'into', 'just', 'like', 'look', 'maybe', 'more', 'most', 'much', 'only', 'over', 'really', 'seems',
    'some', 'still', 'such', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
    'under', 'until', 'very', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your', 'olive', 'diana',
    'ellis', 'woman', 'women', 'sister', 'sisters', 'looked', 'looking', 'walk', 'walked', 'walking', 'turn', 'turned',
}

RELATIONSHIP_PATTERNS = {
    'romantic_tension': ['eye contact', 'lingering look', 'blush', 'blushing', 'spark', 'chemistry', 'closer than', 'heart skips'],
    'bonding': ['laugh together', 'smile', 'soften', 'comfort', 'trust', 'understand', 'gentle', 'warmth'],
    'conflict': ['argue', 'snap', 'glare', 'tense', 'friction', 'disagree', 'bristle'],
    'revelation': ['admits', 'confesses', 'reveals', 'realizes', 'figures out', 'understands'],
    'physical_contact': ['touch', 'brush', 'hand', 'shoulder', 'bump', 'embrace', 'hug'],
    'humor': ['laugh', 'chuckle', 'joke', 'snicker', 'grin'],
}

SCENE_PATTERNS = {
    'location_shift': ['arrive', 'leave', 'enter', 'step into', 'stairs', 'hallway', 'corridor', 'street', 'station'],
    'investigation': ['notice', 'study', 'inspect', 'search', 'figure out', 'anomaly'],
    'danger': ['threat', 'danger', 'risk', 'hit', 'fall', 'panic', 'weapon'],
    'intimacy': ['close', 'kiss', 'softly', 'whisper', 'warm', 'breath'],
    'mystery': ['odd', 'strange', 'wrong', 'hallucination', 'vision', 'anomaly'],
}


def _resolve_storage(
    session_id: str | None,
    campaign_id: str | None,
    storage: CampaignStorage,
) -> tuple[CampaignStorage, str, str]:
    if not session_id:
        if campaign_id:
            campaign_storage = storage.for_campaign(campaign_id)
            if not campaign_storage.has_bundle():
                raise ValueError(f'Campaign {campaign_id!r} does not exist.')
            return campaign_storage, campaign_storage.current_campaign_id, 'root'
        return storage, 'root', 'root'
    active_storage = storage.resolve_session_storage(session_id, campaign_id)
    summary = active_storage.load_session_summary()
    return active_storage, summary.campaign_id, summary.session_id


def _group_entries_by_section(history: list[PlayTranscriptEntry], turns_per_section: int) -> list[list[PlayTranscriptEntry]]:
    if not history:
        return []
    turns = sorted({entry.turn for entry in history})
    sections: list[list[PlayTranscriptEntry]] = []
    for index in range(0, len(turns), turns_per_section):
        turn_slice = set(turns[index : index + turns_per_section])
        section_entries = [entry for entry in history if entry.turn in turn_slice]
        if section_entries:
            sections.append(section_entries)
    return sections


def _entries_to_text(entries: list[PlayTranscriptEntry]) -> str:
    return '\n'.join(f'Turn {entry.turn} {entry.role}: {entry.content}' for entry in entries).strip()


def _extract_keywords(text: str, limit: int = 12) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z'-]{2,}", text.lower())
    counts = Counter(word for word in words if word not in STOPWORDS and not word.isdigit())
    return [word for word, _count in counts.most_common(limit)]


def _extract_named_entities(text: str, limit: int = 8) -> list[str]:
    names = re.findall(r'\*\*([^:*\n]{2,40})\*\*:', text)
    names.extend(re.findall(r'\b[A-Z][a-z]{2,}\b', text))
    seen: list[str] = []
    for name in names:
        cleaned = name.strip()
        if cleaned and cleaned not in seen and cleaned.lower() not in STOPWORDS:
            seen.append(cleaned)
        if len(seen) >= limit:
            break
    return seen


def _extract_tags(text: str, patterns: dict[str, list[str]]) -> list[str]:
    lower = text.lower()
    tags: list[str] = []
    for tag, needles in patterns.items():
        if any(needle in lower for needle in needles):
            tags.append(tag)
    return tags


def _build_excerpt(text: str, limit: int = 320) -> str:
    collapsed = re.sub(r'\s+', ' ', text).strip()
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 3].rstrip() + '...'


def _build_summary(text: str, keywords: list[str], relationship_tags: list[str], scene_tags: list[str]) -> str:
    excerpt = _build_excerpt(text, limit=180)
    tags = relationship_tags[:2] + [tag for tag in scene_tags if tag not in relationship_tags][:2]
    if tags:
        return f'{excerpt} [tags: {", ".join(tags)}]'
    if keywords:
        return f'{excerpt} [keywords: {", ".join(keywords[:4])}]'
    return excerpt


def _build_notable_moments(text: str, relationship_tags: list[str], scene_tags: list[str]) -> list[str]:
    moments: list[str] = []
    if 'romantic_tension' in relationship_tags:
        moments.append('Possible romance or relationship shift signaled by an emotionally charged eye-contact moment.')
    if 'physical_contact' in relationship_tags:
        moments.append('Physical proximity or contact changes the beat of the scene and may deepen the relationship dynamic.')
    if 'revelation' in relationship_tags:
        moments.append('A character realization or confession alters the scene context.')
    if 'location_shift' in scene_tags:
        moments.append('The scene may involve movement or a location change worth checking against world state.')
    if not moments and text:
        moments.append(_build_excerpt(text, limit=120))
    return moments[:3]


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
        raise RuntimeError('Transcript memory enrichment returned no JSON object.')
    return json.loads(stripped[start : end + 1])


def _enrich_section_with_model(
    section: TranscriptMemorySection,
    model: str,
    client: Any | None,
    *,
    provider: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
) -> TranscriptMemorySection:
    instructions = (
        'You are annotating a transcript section for future search and recall. '
        'Return ONLY valid JSON with fields summary, keywords, named_entities, relationship_tags, scene_tags, notable_moments. '
        'Be concise but capture implicit emotional or relationship beats when they are strongly supported by the text.'
    )
    user_content = (
        'Section summary:\n'
        + section.summary
        + '\n\nSection excerpt:\n'
        + section.excerpt
        + '\n\nUse search-friendly wording for relationship or scene shifts when justified.'
    )
    if client is not None:
        response = client.post(
            '/responses',
            json={
                'model': model,
                'instructions': instructions,
                'input': [
                    {
                        'role': 'user',
                        'content': user_content,
                    }
                ],
            },
        )
        if getattr(response, 'status_code', 200) >= 400:
            raise RuntimeError(_extract_error_message(response.json()))
        output_text = _extract_output_text(response.json())
    else:
        try:
            output_text = generate_model_text(
                ModelRequest(
                    provider=provider,
                    model=model,
                    api_key=api_key,
                    base_url=base_url,
                    instructions=instructions,
                    messages=[ModelMessage(role='user', content=user_content)],
                )
            ).text
        except ModelProviderError as exc:
            raise RuntimeError(str(exc)) from exc
    if not output_text:
        return section
    payload = _extract_json_object(output_text)
    section.summary = str(payload.get('summary') or section.summary).strip() or section.summary
    for field in ('keywords', 'named_entities', 'relationship_tags', 'scene_tags', 'notable_moments'):
        value = payload.get(field)
        if isinstance(value, list):
            setattr(section, field, [str(item).strip() for item in value if str(item).strip()])
    return section


def build_transcript_memory_index(
    request: TranscriptMemoryBuildRequest,
    storage: CampaignStorage,
    client: Any | None = None,
) -> TranscriptMemoryIndexResponse:
    active_storage, campaign_id, session_id = _resolve_storage(request.session_id, request.campaign_id, storage)
    if active_storage.transcript_memory_path.exists() and not request.refresh:
        existing = active_storage.load_transcript_memory()
        return TranscriptMemoryIndexResponse(
            campaign_id=campaign_id,
            session_id=session_id,
            sections_indexed=len(existing),
            transcript_entries_indexed=sum(section.transcript_entries for section in existing),
            storage_path=str(active_storage.transcript_memory_path),
            used_model_metadata=request.use_model_metadata,
        )

    history = active_storage.load_play_history()
    groups = _group_entries_by_section(history, request.turns_per_section)
    sections: list[TranscriptMemorySection] = []
    resolved_client = client if request.use_model_metadata else None
    model = request.model or settings.default_model

    for index, entries in enumerate(groups, start=1):
        text = _entries_to_text(entries)
        keywords = _extract_keywords(text)
        named_entities = _extract_named_entities(text)
        relationship_tags = _extract_tags(text, RELATIONSHIP_PATTERNS)
        scene_tags = _extract_tags(text, SCENE_PATTERNS)
        section = TranscriptMemorySection(
            campaign_id=campaign_id,
            session_id=session_id,
            section_id=f'{campaign_id}-{session_id}-section-{index:03d}',
            start_turn=min(entry.turn for entry in entries),
            end_turn=max(entry.turn for entry in entries),
            summary=_build_summary(text, keywords, relationship_tags, scene_tags),
            keywords=keywords,
            named_entities=named_entities,
            relationship_tags=relationship_tags,
            scene_tags=scene_tags,
            notable_moments=_build_notable_moments(text, relationship_tags, scene_tags),
            excerpt=_build_excerpt(text),
            transcript_entries=len(entries),
        )
        if request.use_model_metadata:
            section = _enrich_section_with_model(
                section,
                model=model,
                client=resolved_client,
                provider=request.provider,
                api_key=request.provider_api_key,
                base_url=request.provider_base_url,
            )
        sections.append(section)

    path = active_storage.save_transcript_memory(sections)
    return TranscriptMemoryIndexResponse(
        campaign_id=campaign_id,
        session_id=session_id,
        sections_indexed=len(sections),
        transcript_entries_indexed=len(history),
        storage_path=str(path),
        used_model_metadata=request.use_model_metadata,
    )


def _score_section(section: TranscriptMemorySection, query_terms: list[str]) -> tuple[float, list[str]]:
    score = 0.0
    matched_terms: list[str] = []
    summary_text = section.summary.lower()
    excerpt_text = section.excerpt.lower()
    metadata_terms = [
        *[item.lower() for item in section.keywords],
        *[item.lower() for item in section.named_entities],
        *[item.lower() for item in section.relationship_tags],
        *[item.lower() for item in section.scene_tags],
        *[item.lower() for item in section.notable_moments],
    ]
    for term in query_terms:
        term_score = 0.0
        if any(term in item for item in metadata_terms):
            term_score += 5.0
        if term in summary_text:
            term_score += 3.0
        if term in excerpt_text:
            term_score += 1.5
        if term_score > 0:
            matched_terms.append(term)
            score += term_score
    return score, matched_terms


def _session_storages_for_search(request: TranscriptMemorySearchRequest, storage: CampaignStorage) -> list[tuple[str, str, CampaignStorage]]:
    if request.session_id:
        active_storage, campaign_id, session_id = _resolve_storage(request.session_id, request.campaign_id, storage)
        return [(campaign_id, session_id, active_storage)]

    targets: list[tuple[str, str, CampaignStorage]] = []
    if request.include_root and not request.campaign_id:
        targets.append(('root', 'root', storage))
    if request.campaign_id:
        campaign_storage = storage.for_campaign(request.campaign_id)
        if not campaign_storage.has_bundle():
            raise ValueError(f'Campaign {request.campaign_id!r} does not exist.')
        targets.append((campaign_storage.current_campaign_id, 'root', campaign_storage))
        if request.include_sessions:
            for summary in storage.list_sessions(campaign_id=request.campaign_id):
                targets.append((summary.campaign_id, summary.session_id, storage.for_campaign(summary.campaign_id).for_session(summary.session_id)))
        return targets
    if request.include_sessions:
        for summary in storage.list_sessions():
            if summary.campaign_id == 'root':
                targets.append(('root', summary.session_id, storage.for_session(summary.session_id)))
            else:
                targets.append((summary.campaign_id, summary.session_id, storage.for_campaign(summary.campaign_id).for_session(summary.session_id)))
    return targets


def search_transcript_memory(
    request: TranscriptMemorySearchRequest,
    storage: CampaignStorage,
) -> TranscriptMemorySearchResponse:
    query_terms = [term for term in re.findall(r"[A-Za-z][A-Za-z'-]{1,}", request.query.lower()) if term not in STOPWORDS]
    targets = _session_storages_for_search(request, storage)
    hits: list[TranscriptMemorySearchHit] = []
    sessions_considered: list[str] = []

    for campaign_id, session_id, active_storage in targets:
        sessions_considered.append(f'{campaign_id}:{session_id}')
        sections = active_storage.load_transcript_memory()
        if not sections and active_storage.play_history_path.exists():
            build_transcript_memory_index(
                TranscriptMemoryBuildRequest(campaign_id=campaign_id if campaign_id != 'root' else None, session_id=None if session_id == 'root' else session_id, refresh=True),
                storage,
            )
            sections = active_storage.load_transcript_memory()
        for section in sections:
            score, matched_terms = _score_section(section, query_terms)
            if score <= 0:
                continue
            hits.append(
                TranscriptMemorySearchHit(
                    campaign_id=section.campaign_id,
                    session_id=section.session_id,
                    section_id=section.section_id,
                    score=score,
                    start_turn=section.start_turn,
                    end_turn=section.end_turn,
                    summary=section.summary,
                    keywords=section.keywords,
                    relationship_tags=section.relationship_tags,
                    scene_tags=section.scene_tags,
                    notable_moments=section.notable_moments,
                    excerpt=section.excerpt,
                    matched_terms=matched_terms,
                )
            )

    hits.sort(key=lambda hit: (-hit.score, hit.campaign_id, hit.session_id, hit.start_turn))
    return TranscriptMemorySearchResponse(
        query=request.query,
        sessions_considered=sessions_considered,
        hits=hits[: request.max_results],
    )
