from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import unicodedata
import xml.etree.ElementTree as ET
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


DEFAULT_SOURCE = Path('/storage/emulated/0/projects/termux_share/RolePlayGPT-Pyrrha1.pdf')
DEFAULT_STORAGE = REPO_ROOT / 'storage' / 'CharacterRPG_Generated_Files'
DEFAULT_CAMPAIGN_ID = 'ashes-through-beacon-glass'
DEFAULT_SESSION_ID = 'main'
DEFAULT_TITLE = 'Ash in Remnant'
DEFAULT_RECORDED_AT = '2026-05-03T22:38:03-04:00'
USER_X_MIN = 205.0

ARTIFACT_LINES = {
    'Sources',
}

TRANSCRIPT_EXPORT_REQUEST_PREFIXES = (
    'can we port the transcript',
    'expand it into',
    'do the verbatim',
    'i just want everything except',
    'do the long one',
)

OVERWRITTEN_BLOCKS = {12, 13, 14, 15}


@dataclass(frozen=True)
class PdfLine:
    page: int
    y_min: float
    y_max: float
    x_min: float
    role: str
    text: str


@dataclass(frozen=True)
class ParsedBlock:
    role: str
    content: str
    source_block: int


def _local_name(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def _has_alnum(text: str) -> bool:
    return any(character.isalnum() for character in text)


def _normalized_line(text: str) -> str:
    normalized = unicodedata.normalize('NFKD', text).lower()
    return re.sub(r'[\W_]+', '', normalized)


def _collapse_whitespace(text: str) -> str:
    return re.sub(r'[ \t]+', ' ', text).strip()


def _extract_pdf_html(source: Path, html_path: Path) -> None:
    html_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ['pdftotext', '-bbox-layout', str(source), str(html_path)],
        check=True,
    )


def _iter_pdf_lines(html_path: Path) -> list[PdfLine]:
    root = ET.parse(html_path).getroot()
    lines: list[PdfLine] = []
    page_number = 0
    previous_role = 'assistant'
    for page in root.iter():
        if _local_name(page.tag) != 'page':
            continue
        page_number += 1
        for line in page.iter():
            if _local_name(line.tag) != 'line':
                continue
            text = ' '.join((word.text or '') for word in line if _local_name(word.tag) == 'word').strip()
            if not text:
                continue
            x_min = float(line.attrib['xMin'])
            role = 'user' if x_min >= USER_X_MIN else 'assistant'
            if not _has_alnum(text):
                role = previous_role
            lines.append(
                PdfLine(
                    page=page_number,
                    y_min=float(line.attrib['yMin']),
                    y_max=float(line.attrib['yMax']),
                    x_min=x_min,
                    role=role,
                    text=text,
                )
            )
            previous_role = role
    return lines


def _line_is_artifact(text: str) -> bool:
    return (
        text in ARTIFACT_LINES
        or text.startswith('Stopped talking')
        or text.startswith('Thought for')
        or text.startswith('Talked to')
    )


def _blocks_from_lines(lines: list[PdfLine]) -> list[tuple[str, list[PdfLine | None]]]:
    start_index = next((index for index, line in enumerate(lines) if 'Resume Play' in line.text), None)
    if start_index is None:
        raise ValueError('Could not find the "Resume Play" marker in the extracted PDF text.')

    blocks: list[tuple[str, list[PdfLine | None]]] = []
    role = 'assistant'
    current: list[PdfLine | None] = []
    previous: PdfLine | None = None

    for line in lines[start_index + 1 :]:
        if _line_is_artifact(line.text):
            continue
        if line.role != role and current:
            blocks.append((role, current))
            current = []
            previous = None
        role = line.role
        if previous and (line.page != previous.page or line.y_min - previous.y_max > 25):
            current.append(None)
        current.append(line)
        previous = line

    if current:
        blocks.append((role, current))
    return blocks


def _block_text(items: list[PdfLine | None]) -> str:
    paragraphs: list[str] = []
    current: list[str] = []
    last_normalized = ''
    for item in items:
        if item is None:
            if current:
                paragraphs.append(_collapse_whitespace(' '.join(current)))
                current = []
            continue

        text = _collapse_whitespace(item.text)
        normalized = _normalized_line(text)
        if normalized and normalized == last_normalized:
            continue
        if normalized and last_normalized and len(normalized) > 35 and normalized.startswith(last_normalized):
            if current:
                current[-1] = text
            elif paragraphs:
                paragraphs[-1] = text
            last_normalized = normalized
            continue
        if normalized and last_normalized and len(last_normalized) > 35 and last_normalized.startswith(normalized):
            continue
        current.append(text)
        last_normalized = normalized

    if current:
        paragraphs.append(_collapse_whitespace(' '.join(current)))
    return '\n\n'.join(paragraph for paragraph in paragraphs if paragraph)


def _trim_user_ooc(text: str, block_number: int) -> str | None:
    lower = text.lower().strip()
    if block_number == 16:
        return (
            'I mean no disrespect. You have been very kind, and apart from the commonality '
            'of your name and the land of Oz, I do not know anything about you, Glynda, or this place.'
        )

    embedded_ooc = re.search(r'\bOOC:', text, flags=re.IGNORECASE)
    if embedded_ooc and embedded_ooc.start() > 0:
        text = text[: embedded_ooc.start()].strip()
        lower = text.lower().strip()

    if not lower.startswith('ooc'):
        return text.strip() or None

    if 'back to the game:' in lower:
        start = lower.index('back to the game:') + len('back to the game:')
        return text[start:].strip() or None

    lines = text.splitlines()
    for index, line in enumerate(lines[1:], start=1):
        stripped = line.strip()
        if stripped.startswith(('*', '"', '\u201c')) or stripped.startswith(('I look', 'Looking at')):
            return '\n'.join(lines[index:]).strip() or None
    return None


def parse_pdf_transcript(source: Path, html_path: Path) -> list[ParsedBlock]:
    _extract_pdf_html(source, html_path)
    lines = _iter_pdf_lines(html_path)
    raw_blocks = _blocks_from_lines(lines)

    parsed: list[ParsedBlock] = []
    in_assistant_ooc = False
    for block_number, (role, items) in enumerate(raw_blocks, start=1):
        if block_number in OVERWRITTEN_BLOCKS:
            continue

        text = _block_text(items).strip()
        if not text:
            continue
        lower = text.lower()

        if role == 'user' and lower.startswith(TRANSCRIPT_EXPORT_REQUEST_PREFIXES):
            break

        if in_assistant_ooc:
            if ']' not in text:
                continue
            text = text.split(']', 1)[1].strip()
            in_assistant_ooc = False
            if not text:
                continue

        if role == 'assistant' and lower.startswith('[ooc:'):
            if ']' in text:
                text = text.split(']', 1)[1].strip()
                if not text:
                    continue
            else:
                in_assistant_ooc = True
                continue

        if role == 'user':
            text = _trim_user_ooc(text, block_number) or ''

        if not text.strip() or not _has_alnum(text):
            continue
        parsed.append(ParsedBlock(role=role, content=text.strip(), source_block=block_number))

    return parsed


def blocks_to_history(blocks: list[ParsedBlock], recorded_at: str) -> list[PlayTranscriptEntry]:
    history: list[PlayTranscriptEntry] = []
    turn = 1
    saw_user = False
    for block in blocks:
        if block.role == 'user':
            if saw_user:
                turn += 1
            saw_user = True
        try:
            history.append(
                PlayTranscriptEntry(
                    role=block.role,  # type: ignore[arg-type]
                    content=block.content,
                    turn=turn,
                    recorded_at=recorded_at,
                )
            )
        except ValidationError as exc:
            raise ValueError(f'Invalid parsed PDF transcript block {block.source_block}: {block!r}') from exc
    return history


def _excerpt(text: str, limit: int = 500) -> str:
    collapsed = ' '.join(text.split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 3].rstrip() + '...'


def _current_scene(history: list[PlayTranscriptEntry]) -> str:
    tail = history[-5:]
    return _excerpt(
        'Ash and Pyrrha are in the lab after an intense relationship beat and a turn back '
        'toward the larger mystery of why Ash arrived in Remnant. Pyrrha has named Glynda '
        'as the more direct path to answers and challenges. Recent transcript: '
        + ' '.join(f'{entry.role}: {entry.content}' for entry in tail),
        700,
    )


def _recap(history: list[PlayTranscriptEntry]) -> str:
    return (
        'Imported full Ash/Pyrrha PDF transcript from the ChatGPT printout, with OOC and '
        'transcript-export chatter filtered out and a superseded Ozpin technology beat removed. '
        'Ash arrived at Beacon as a displaced Earth physicist and met Pyrrha, who quickly became '
        'his anchor. Ozpin and Glynda tested him; Glynda awakened Aura and Ash manifested an '
        'unusually bright blue-green aura plus a deeper water-connected ability. Ash and Pyrrha '
        'built trust through training, stargazing, science explanations, music, phone/video '
        'demonstrations, beach time, and increasingly direct romantic intimacy. Ash discovered '
        'cooperative water control and thermal manipulation, including ice and dangerous heat. '
        'They explored Grimm, the shattered moon, and the possibility that Grimm may have purpose '
        'or act like an immune system. The current beat points toward investigating why Ash arrived, '
        'why the worlds share language and fiction, whether someone in Remnant brought him here, '
        'and whether Glynda or Ozpin can provide answers. Imported entries: '
        f'{len(history)}.'
    )


def _update_threads(existing: list[StoryThread], last_turn: int) -> list[StoryThread]:
    by_id = {thread.thread_id: thread for thread in existing}

    def upsert(thread: StoryThread) -> None:
        by_id[thread.thread_id] = thread

    upsert(
        StoryThread(
            thread_id='ashes-through-beacon-glass-pyrrha-bond',
            type='relationship',
            title="Pyrrha and Ash's Bond",
            status='active',
            tension=6,
            summary='Ash and Pyrrha have moved through immediate rapport, mutual trust, kisses, and explicit desire while negotiating pace and care.',
            current_beat='They have just grounded an intense moment and turned back toward the mystery together.',
            next_beat='Let the next scene test how their closeness holds up when they ask Glynda or Ozpin for harder answers.',
            unresolved_question='How fast can the bond grow without either of them losing agency or balance?',
            created_turn=0,
            last_advanced_turn=last_turn,
        )
    )
    upsert(
        StoryThread(
            thread_id='ashes-through-beacon-glass-water-semblance',
            type='personal_arc',
            title='Water Semblance Mastery',
            status='active',
            tension=5,
            summary='Ash can sense and shape water cooperatively, manipulate heat, create ice, and trigger dangerous heat or flame-like effects.',
            current_beat='The power feels deeper and more personal than Aura, and Ash is learning restraint through experiments with Pyrrha.',
            next_beat='Give Ash a controlled edge case where curiosity, safety, and trust all matter.',
            unresolved_question='What is Ash actually touching when the water seems to listen?',
            created_turn=1,
            last_advanced_turn=last_turn,
        )
    )
    upsert(
        StoryThread(
            thread_id='ashes-through-beacon-glass-world-bridge',
            type='mystery',
            title='Worlds Connected by Fiction',
            status='active',
            tension=6,
            summary='Ash and Pyrrha suspect his arrival, shared language, and fiction/canon overlap imply a real connection between Earth and Remnant.',
            current_beat='They are considering whether Ash appeared near Pyrrha by accident, design, or a two-way connection between worlds.',
            next_beat='Bring Glynda or Ozpin into the question without giving away more than they would plausibly reveal.',
            unresolved_question='Who or what brought Ash to Remnant, and can the connection be traced both ways?',
            created_turn=last_turn,
            last_advanced_turn=last_turn,
        )
    )
    upsert(
        StoryThread(
            thread_id='ashes-through-beacon-glass-remnant-mysteries',
            type='mystery',
            title="Remnant's Larger Mysteries",
            status='active',
            tension=5,
            summary='Ash has questioned the shattered moon, Grimm behavior, Aura, Dust, and whether Grimm may be purposeful constructs or an immune system.',
            current_beat='The mystery has expanded from Remnant physics to the reason Ash exists there at all.',
            next_beat='Seed a concrete reason that asking the right person may also alert the wrong person.',
            unresolved_question='If the Grimm are protecting something, what are they protecting it from?',
            created_turn=0,
            last_advanced_turn=last_turn,
        )
    )
    return list(by_id.values())


def _write_markdown(path: Path, history: list[PlayTranscriptEntry]) -> None:
    lines = ['# Ash in Remnant - PDF Transcript Import', '']
    for entry in history:
        speaker = 'Player' if entry.role == 'user' else 'GM'
        lines.append(f'## Turn {entry.turn} - {speaker}')
        lines.append('')
        lines.append(entry.content)
        lines.append('')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('\n'.join(lines).rstrip() + '\n', encoding='utf-8')


def import_transcript(
    source: Path,
    storage_dir: Path,
    campaign_id: str,
    session_id: str,
    title: str,
    *,
    replace: bool,
    markdown_out: Path | None,
) -> tuple[Path, int, int, int, Path]:
    if not source.exists():
        raise FileNotFoundError(source)
    html_path = REPO_ROOT / '.runtime' / 'pdf_extract' / f'{source.stem}.html'
    blocks = parse_pdf_transcript(source, html_path)
    history = blocks_to_history(blocks, DEFAULT_RECORDED_AT)
    if not history:
        raise ValueError(f'No transcript events parsed from {source}.')

    storage = CampaignStorage(storage_dir)
    campaign_storage = storage.for_campaign(campaign_id)
    if not campaign_storage.has_bundle():
        raise ValueError(f'Campaign {campaign_id!r} does not exist at {campaign_storage.base_dir}.')

    normalized_session_id = CampaignStorage.normalize_session_id(session_id)
    session_storage = campaign_storage.for_session(normalized_session_id)
    if session_storage.base_dir.exists():
        if not replace:
            raise FileExistsError(
                f'Session {normalized_session_id!r} already exists. Re-run with --replace to back it up and replace it.'
            )
        stamp = datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')
        backup = campaign_storage.base_dir / '_session_import_backups' / f'{stamp}-{normalized_session_id}'
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(session_storage.base_dir, backup)
        shutil.rmtree(session_storage.base_dir)

    session_storage.base_dir.mkdir(parents=True, exist_ok=True)
    bundle = campaign_storage.load_bundle()
    last_turn = max(entry.turn for entry in history)
    bundle.world_state.turn = last_turn
    bundle.world_state.current_scene = _current_scene(history)
    bundle.world_state.location = 'Beacon Academy - lab'
    bundle.world_state.time_of_day = 'unknown'
    bundle.world_state.world_pressure = max(bundle.world_state.world_pressure, 3)
    bundle.world_state.pressure_clock = max(bundle.world_state.pressure_clock, 2)
    import_notes = [
        f'Imported full Ash/Pyrrha PDF transcript from {source}.',
        'OOC and transcript-export chatter were filtered from the playable transcript.',
        'A superseded Ozpin technology exposition was replaced with the later corrected continuity.',
    ]
    for note in import_notes:
        if note not in bundle.world_state.notes:
            bundle.world_state.notes.append(note)
    bundle.timeline = [
        *bundle.timeline,
        f'Imported full PDF transcript "{source.name}" into session {normalized_session_id}.',
        'Current continuation beat: Ash and Pyrrha are deciding whether Glynda offers answers, a challenge, or both.',
    ]
    bundle.recap = _recap(history)
    bundle.story_threads = _update_threads(bundle.story_threads, last_turn)

    session_storage.save_bundle(bundle)
    session_storage.save_play_history(history)
    if markdown_out:
        _write_markdown(markdown_out, history)
    (session_storage.base_dir / 'import_metadata.json').write_text(
        json.dumps(
            {
                'source_path': str(source.resolve()),
                'format': 'chrome_print_pdf_bbox',
                'imported_at': datetime.now(UTC).isoformat(),
                'parser': Path(__file__).name,
                'transcript_entries': len(history),
                'turns': last_turn,
                'source_blocks': len(blocks),
                'html_extract_path': str(html_path),
                'filters': [
                    'Started at the Resume Play marker.',
                    'Classified player/GM text by PDF x-coordinate.',
                    'Filtered OOC/backend/transcript-export chatter.',
                    'Skipped superseded Ozpin technology correction blocks.',
                ],
            },
            ensure_ascii=True,
            indent=2,
        )
        + '\n',
        encoding='utf-8',
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
    return session_storage.base_dir, len(history), last_turn, memory_index.sections_indexed, html_path


def main() -> int:
    parser = argparse.ArgumentParser(description='Import Ash/Pyrrha ChatGPT print PDF into CharacterRPG.')
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE)
    parser.add_argument('--storage-dir', type=Path, default=DEFAULT_STORAGE)
    parser.add_argument('--campaign-id', default=DEFAULT_CAMPAIGN_ID)
    parser.add_argument('--session-id', default=DEFAULT_SESSION_ID)
    parser.add_argument('--title', default=DEFAULT_TITLE)
    parser.add_argument('--replace', action='store_true')
    parser.add_argument('--markdown-out', type=Path, default=None)
    args = parser.parse_args()

    session_dir, entries, turns, sections, html_path = import_transcript(
        args.source,
        args.storage_dir,
        args.campaign_id,
        args.session_id,
        args.title,
        replace=args.replace,
        markdown_out=args.markdown_out,
    )
    print(f'Imported Ash PDF transcript session: {session_dir}')
    print(f'Transcript entries: {entries}')
    print(f'Turns: {turns}')
    print(f'Transcript memory sections: {sections}')
    print(f'PDF text coordinates: {html_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
