from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.models.play import PlaySessionSummary, PlayTranscriptEntry
from backend.app.models.story import StoryThread
from backend.app.models.transcript_memory import TranscriptMemoryBuildRequest
from backend.app.services.campaign_storage import CampaignStorage
from backend.app.services.transcript_memory import build_transcript_memory_index


DEFAULT_SOURCE = REPO_ROOT / "docs" / "Conversations_with_GPT" / "extended_transcript.md"
DEFAULT_STORAGE = REPO_ROOT / "storage" / "CharacterRPG_Generated_Files"
DEFAULT_CAMPAIGN_ID = "ashes-through-beacon-glass"
DEFAULT_SESSION_ID = "main"
DEFAULT_TITLE = "Ash in Remnant"
DEFAULT_RECORDED_AT = "2026-05-03T01:20:00-04:00"


@dataclass(frozen=True)
class ParsedEvent:
    role: str
    content: str


def _collapse_wrapped_lines(paragraph: str) -> str:
    lines = [line.strip() for line in paragraph.splitlines() if line.strip()]
    return " ".join(lines).strip()


def _iter_paragraphs(markdown: str) -> list[str]:
    paragraphs: list[str] = []
    current: list[str] = []
    for line in markdown.splitlines():
        stripped = line.strip()
        if not stripped:
            if current:
                paragraphs.append("\n".join(current))
                current = []
            continue
        if set(stripped) == {"-"} and len(stripped) >= 8:
            if current:
                paragraphs.append("\n".join(current))
                current = []
            continue
        if stripped.startswith("#") or stripped == "2026-05-03 01:20":
            continue
        current.append(stripped)
    if current:
        paragraphs.append("\n".join(current))
    return paragraphs


def parse_reconstructed_transcript(markdown: str) -> list[ParsedEvent]:
    events: list[ParsedEvent] = []
    speaker_pattern = re.compile(r"^\*\*(?P<speaker>[^:*]+(?:\([^)]*\))?):\*\*\s*(?P<text>.*)$")
    for paragraph in _iter_paragraphs(markdown):
        collapsed = _collapse_wrapped_lines(paragraph)
        if not collapsed or collapsed == "*End*":
            continue
        match = speaker_pattern.match(collapsed)
        if not match:
            role = "assistant"
            content = collapsed
        else:
            speaker = match.group("speaker").strip()
            text = match.group("text").strip()
            if speaker.lower().startswith("ash"):
                role = "user"
                content = f"{speaker}: {text}"
            else:
                role = "assistant"
                content = f"{speaker}: {text}"

        if events and events[-1].role == role == "assistant":
            previous = events[-1]
            events[-1] = ParsedEvent(role=previous.role, content=f"{previous.content}\n\n{content}")
        else:
            events.append(ParsedEvent(role=role, content=content))
    return events


def events_to_history(events: list[ParsedEvent], recorded_at: str) -> list[PlayTranscriptEntry]:
    history: list[PlayTranscriptEntry] = []
    turn = 1
    saw_user = False
    for event in events:
        if event.role == "user":
            if saw_user:
                turn += 1
            saw_user = True
        try:
            history.append(
                PlayTranscriptEntry(
                    role=event.role,  # type: ignore[arg-type]
                    content=event.content,
                    turn=turn,
                    recorded_at=recorded_at,
                )
            )
        except ValidationError as exc:
            raise ValueError(f"Invalid parsed transcript event at turn {turn}: {event!r}") from exc
    return history


def _excerpt(text: str, limit: int = 500) -> str:
    collapsed = " ".join(text.split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 3].rstrip() + "..."


def _current_scene(history: list[PlayTranscriptEntry]) -> str:
    tail = history[-5:]
    return _excerpt(
        "Ash and Pyrrha have reached a quiet, committed emotional beat after a week of "
        "stargazing, combat training, water-semblance experimentation, beach time, Ozpin's "
        "warnings, and speculation about the Grimm. Recent transcript: "
        + " ".join(f"{entry.role}: {entry.content}" for entry in tail),
        700,
    )


def _recap(history: list[PlayTranscriptEntry]) -> str:
    return (
        "Imported reconstructed Ash transcript. Ash and Pyrrha's relationship deepened through "
        "stargazing, conversations about light and failure, sparring, and repeated moments of trust. "
        "Ash stopped trying to force victory in training and began learning through rhythm and control. "
        "He identified a water-based semblance, learned to shape water cooperatively, and discovered "
        "temperature manipulation that can move heat, form ice, and create dangerous flashes of flame. "
        "Ash and Pyrrha shared a beach scene and increasingly intimate emotional contact. Ash also met "
        "Ozpin, questioned the shattered moon and the unnatural behavior of the Grimm, and drew the "
        "dangerous hypothesis that the Grimm may have purpose, perhaps even functioning like an immune "
        "system. The last beat is intimate and unresolved: Ash and Pyrrha affirm that they are with each "
        f"other. Imported entries: {len(history)}."
    )


def _update_threads(existing: list[StoryThread], last_turn: int) -> list[StoryThread]:
    by_id = {thread.thread_id: thread for thread in existing}

    def upsert(thread: StoryThread) -> None:
        by_id[thread.thread_id] = thread

    upsert(
        StoryThread(
            thread_id="ashes-through-beacon-glass-pyrrha-bond",
            type="relationship",
            title="Pyrrha and Ash's Bond",
            status="active",
            tension=5,
            summary="Ash and Pyrrha have moved from immediate rapport into explicit mutual commitment and physical/emotional intimacy.",
            current_beat="They have just affirmed that they are with each other after a week of closeness, training, and trust.",
            next_beat="Let the next scene test what that commitment means in practical Beacon life, with agency and pacing intact.",
            unresolved_question="What changes now that they have both said yes to the bond?",
            created_turn=0,
            last_advanced_turn=last_turn,
        )
    )
    upsert(
        StoryThread(
            thread_id="ashes-through-beacon-glass-water-semblance",
            type="personal_arc",
            title="Water Semblance Mastery",
            status="active",
            tension=4,
            summary="Ash can interact with water cooperatively, shape it, and manipulate heat well enough to form ice or dangerous flashes.",
            current_beat="The power is promising but emotionally and physically risky if Ash moves faster than control allows.",
            next_beat="Give Ash a controlled test, an unexpected edge case, or a reason Pyrrha must set a boundary around training.",
            unresolved_question="Can Ash learn restraint before curiosity makes the semblance dangerous?",
            created_turn=1,
            last_advanced_turn=last_turn,
        )
    )
    upsert(
        StoryThread(
            thread_id="ashes-through-beacon-glass-remnant-mysteries",
            type="mystery",
            title="Remnant's Larger Mysteries",
            status="active",
            tension=4,
            summary="Ash has questioned the moon, the Grimm, and whether the Grimm may be purposeful magical constructs or an immune system.",
            current_beat="Ozpin has warned that these questions are dangerous, but Ash and Pyrrha have already started asking them together.",
            next_beat="Seed one specific consequence of asking the wrong question near the wrong person.",
            unresolved_question="If the Grimm are protecting something, what are they protecting it from?",
            created_turn=0,
            last_advanced_turn=last_turn,
        )
    )
    return list(by_id.values())


def import_transcript(
    source: Path,
    storage_dir: Path,
    campaign_id: str,
    session_id: str,
    title: str,
    *,
    replace: bool,
) -> tuple[Path, int, int, int]:
    markdown = source.read_text(encoding="utf-8")
    events = parse_reconstructed_transcript(markdown)
    history = events_to_history(events, DEFAULT_RECORDED_AT)
    if not history:
        raise ValueError(f"No transcript events parsed from {source}.")

    storage = CampaignStorage(storage_dir)
    campaign_storage = storage.for_campaign(campaign_id)
    if not campaign_storage.has_bundle():
        raise ValueError(f"Campaign {campaign_id!r} does not exist at {campaign_storage.base_dir}.")

    normalized_session_id = CampaignStorage.normalize_session_id(session_id)
    session_storage = campaign_storage.for_session(normalized_session_id)
    if session_storage.base_dir.exists():
        if not replace:
            raise FileExistsError(
                f"Session {normalized_session_id!r} already exists. Re-run with --replace to back it up and replace it."
            )
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        backup = campaign_storage.base_dir / "_session_import_backups" / f"{stamp}-{normalized_session_id}"
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(session_storage.base_dir, backup)
        shutil.rmtree(session_storage.base_dir)

    session_storage.base_dir.mkdir(parents=True, exist_ok=True)
    bundle = campaign_storage.load_bundle()
    last_turn = max(entry.turn for entry in history)
    bundle.world_state.turn = last_turn
    bundle.world_state.current_scene = _current_scene(history)
    bundle.world_state.location = "Beacon Academy"
    bundle.world_state.time_of_day = "unknown"
    bundle.world_state.world_pressure = max(bundle.world_state.world_pressure, 2)
    bundle.world_state.pressure_clock = max(bundle.world_state.pressure_clock, 1)
    import_notes = [
        f"Imported reconstructed Ash transcript from {source}.",
        "Transcript is reconstructed from ChatGPT context, not guaranteed verbatim.",
        "Ash transcript is authoritative for broad continuity beats; preserve player agency going forward.",
    ]
    for note in import_notes:
        if note not in bundle.world_state.notes:
            bundle.world_state.notes.append(note)
    bundle.timeline = [
        *bundle.timeline,
        f'Imported reconstructed Ash transcript "{source.name}" into session {normalized_session_id}.',
        "Established later Ash/Pyrrha beats: stargazing, scientific philosophy, combat training, water-semblance discovery, beach closeness, Ozpin warnings, and Grimm-origin speculation.",
    ]
    bundle.recap = _recap(history)
    bundle.story_threads = _update_threads(bundle.story_threads, last_turn)

    session_storage.save_bundle(bundle)
    session_storage.save_play_history(history)
    (session_storage.base_dir / "import_metadata.json").write_text(
        json.dumps(
            {
                "source_path": str(source.resolve()),
                "format": "reconstructed_markdown",
                "imported_at": datetime.now(UTC).isoformat(),
                "parser": Path(__file__).name,
                "transcript_entries": len(history),
                "turns": last_turn,
                "notes": [
                    "Ash speaker blocks were imported as user/player entries.",
                    "Narration plus Pyrrha/Ozpin blocks were imported as assistant/GM entries.",
                ],
            },
            ensure_ascii=True,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    now = datetime.now(UTC).isoformat()
    session_storage.save_session_summary(
        PlaySessionSummary(
            campaign_id=CampaignStorage.normalize_campaign_id(campaign_id),
            session_id=normalized_session_id,
            title=title,
            parent_session_id=None,
            fork_from_turn=None,
            storage_dir=str(session_storage.base_dir),
            turn=last_turn,
            transcript_entries=len(history),
            created_at=now,
            updated_at=now,
        )
    )
    campaign_storage.touch_campaign_summary(title=campaign_storage.load_bundle().scenario.title)
    memory_index = build_transcript_memory_index(
        TranscriptMemoryBuildRequest(
            campaign_id=campaign_id,
            session_id=normalized_session_id,
            turns_per_section=4,
            refresh=True,
        ),
        storage,
    )
    return session_storage.base_dir, len(history), last_turn, memory_index.sections_indexed


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Ash reconstructed markdown transcript into CharacterRPG.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--storage-dir", type=Path, default=DEFAULT_STORAGE)
    parser.add_argument("--campaign-id", default=DEFAULT_CAMPAIGN_ID)
    parser.add_argument("--session-id", default=DEFAULT_SESSION_ID)
    parser.add_argument("--title", default=DEFAULT_TITLE)
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()

    session_dir, entries, turns, sections = import_transcript(
        args.source,
        args.storage_dir,
        args.campaign_id,
        args.session_id,
        args.title,
        replace=args.replace,
    )
    print(f"Imported Ash transcript session: {session_dir}")
    print(f"Transcript entries: {entries}")
    print(f"Turns: {turns}")
    print(f"Transcript memory sections: {sections}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
