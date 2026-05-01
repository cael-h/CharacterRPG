from __future__ import annotations

import argparse
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROLEPLAY_STORAGE = (
    Path.home()
    / "projects"
    / "RolePlayGPT"
    / "storage"
    / "RolePlayGPT_Generated_Files"
)
DEFAULT_CHARACTER_STORAGE = REPO_ROOT / "storage" / "CharacterRPG_Generated_Files"


def read_yaml(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return yaml.safe_load(path.read_text(encoding="utf-8")) or default


def write_yaml(path: Path, payload: Any) -> None:
    path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def copy_campaign_tree(source: Path, target: Path, *, replace: bool) -> Path | None:
    backup_path = None
    if target.exists():
        if not replace:
            raise FileExistsError(f"{target} already exists. Re-run with --replace to back it up and replace it.")
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        backup_path = target.parent.parent / "_import_backups" / f"{stamp}-{target.name}"
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(target, backup_path)
        shutil.rmtree(target)
    shutil.copytree(source, target)
    return backup_path


def play_history_count(path: Path) -> int:
    history = path / "play_history.jsonl"
    if not history.exists():
        return 0
    return len([line for line in history.read_text(encoding="utf-8").splitlines() if line.strip()])


def story_thread(
    campaign_id: str,
    suffix: str,
    thread_type: str,
    title: str,
    tension: int,
    summary: str,
    current_beat: str,
    next_beat: str,
    unresolved_question: str | None = None,
    *,
    last_advanced_turn: int = 0,
) -> dict[str, Any]:
    return {
        "thread_id": f"{campaign_id}-{suffix}",
        "type": thread_type,
        "title": title,
        "status": "active",
        "tension": tension,
        "summary": summary,
        "current_beat": current_beat,
        "next_beat": next_beat,
        "unresolved_question": unresolved_question,
        "created_turn": 0,
        "last_advanced_turn": last_advanced_turn,
    }


def tessera_threads(campaign_id: str, turn: int) -> list[dict[str, Any]]:
    return [
        story_thread(
            campaign_id,
            "relationship-present",
            "relationship",
            "Olive, Diana, and Present Trust",
            2,
            "The imported Tessera transcript currently centers on a quiet, emotionally intense moment with Olive and Diana.",
            "Turn 116 ended with Diana and Olive settled close on the couch after an honest, affectionate exchange.",
            "Let the next beat deepen presence, consent, vulnerability, or the emotional afterglow without rushing away.",
            "What does this closeness make possible or difficult next?",
            last_advanced_turn=turn,
        ),
        story_thread(
            campaign_id,
            "continuity-review",
            "continuity",
            "Imported Continuity Review",
            1,
            "The transcript is authoritative, but structured artifacts were reconstructed and should be treated cautiously.",
            "Campaign state came from an imported ChatGPT share transcript.",
            "Use the transcript, recap, and current scene as authority; avoid inventing hard continuity until the player confirms it.",
            "Which imported details need confirmation before a long continuation?",
        ),
        story_thread(
            campaign_id,
            "personal-arc",
            "personal_arc",
            "Emotional Honesty",
            2,
            "The player character is navigating intense affection, adrenaline, and connection.",
            "The current beat is high-emotion but safe and consensual.",
            "Offer a grounded next choice: rest in the moment, say something vulnerable, or let another character act.",
            "What does the character admit now that the pressure has softened?",
            last_advanced_turn=turn,
        ),
    ]


def ash_threads(campaign_id: str, *, archive_turn: int = 0) -> list[dict[str, Any]]:
    return [
        story_thread(
            campaign_id,
            "beacon-tower",
            "scene",
            "Beacon Tower and Ozpin",
            2,
            "Ash and Pyrrha are riding the Beacon Tower elevator toward Ozpin's office while Ash is displaced and uninformed.",
            "The elevator is about to open onto Ozpin's office.",
            "Let Ozpin, Pyrrha, or the room itself force a concrete question about Ash's origin, safety, or cover story.",
            "How much truth can Ash safely reveal to Ozpin?",
        ),
        story_thread(
            campaign_id,
            "pyrrha-bond",
            "relationship",
            "Pyrrha and Ash's Bond",
            3,
            "Ash and Pyrrha have immediate rapport and mutual attraction, but the situation is strange and unstable.",
            "They are newly aware of mutual attraction while walking into authority and uncertainty.",
            "Give Pyrrha an active emotional choice: protect Ash, challenge him, steady him, or reveal her own uncertainty.",
            "How does attraction change when real danger and secrecy enter the room?",
        ),
        story_thread(
            campaign_id,
            "displaced-scientist",
            "personal_arc",
            "Displaced Scientist in Remnant",
            3,
            "Ash is a physicist from Earth trying to understand Aura, Dust, Grimm, and Remnant through scientific reasoning.",
            "Ash has no shelter, money, local identity, or cultural footing.",
            "Make Ash's analysis useful, but attach a social, emotional, or practical cost.",
            "What does Ash misunderstand because Remnant is not Earth?",
        ),
        story_thread(
            campaign_id,
            "remnant-mysteries",
            "mystery",
            "Remnant's Larger Mysteries",
            2,
            "Merged context says Ash later investigates the shattered moon, Grimm origins, magic, and his water-based semblance.",
            "Those mysteries exist as future pressure, not the immediate elevator beat.",
            "Seed one small clue or warning without pulling focus from the current Ozpin scene.",
            "Which mystery first notices Ash noticing it?",
            last_advanced_turn=archive_turn,
        ),
    ]


def update_campaign_metadata(campaign_dir: Path, campaign_id: str, title: str) -> None:
    sessions_dir = campaign_dir / "sessions"
    session_count = len([path for path in sessions_dir.iterdir() if path.is_dir()]) if sessions_dir.exists() else 0
    payload = read_json(campaign_dir / "campaign.json", {})
    now = datetime.now(UTC).isoformat()
    payload.update(
        {
            "campaign_id": campaign_id,
            "title": title,
            "storage_dir": str(campaign_dir),
            "session_count": session_count,
            "updated_at": now,
        }
    )
    payload.setdefault("created_at", now)
    write_json(campaign_dir / "campaign.json", payload)


def update_world_campaign_id(path: Path, campaign_id: str) -> dict[str, Any]:
    world = read_yaml(path / "world_state.yaml", {})
    world["campaign_id"] = campaign_id
    write_yaml(path / "world_state.yaml", world)
    return world


def update_session_metadata(session_dir: Path, campaign_id: str, title: str) -> None:
    world = read_yaml(session_dir / "world_state.yaml", {})
    turn = int(world.get("turn") or 0)
    payload = read_json(session_dir / "session.json", {})
    now = datetime.now(UTC).isoformat()
    payload.update(
        {
            "campaign_id": campaign_id,
            "session_id": session_dir.name,
            "title": payload.get("title") or title,
            "storage_dir": str(session_dir),
            "turn": turn,
            "transcript_entries": play_history_count(session_dir),
            "updated_at": now,
        }
    )
    payload.setdefault("parent_session_id", None)
    payload.setdefault("fork_from_turn", None)
    payload.setdefault("created_at", now)
    write_json(session_dir / "session.json", payload)


def append_unique_notes(world: dict[str, Any], notes: list[str]) -> None:
    existing = list(world.get("notes") or [])
    for note in notes:
        if note and note not in existing:
            existing.append(note)
    world["notes"] = existing


def write_tessera(target_campaign: Path) -> None:
    scenario = read_yaml(target_campaign / "scenario.yaml", {})
    world = update_world_campaign_id(target_campaign, "tessera")
    turn = int(world.get("turn") or 0)
    write_yaml(target_campaign / "story_threads.yaml", tessera_threads("tessera", turn))
    update_campaign_metadata(target_campaign, "tessera", scenario.get("title") or "Tessera")

    sessions_dir = target_campaign / "sessions"
    if sessions_dir.exists():
        for session_dir in sorted(path for path in sessions_dir.iterdir() if path.is_dir()):
            session_world = update_world_campaign_id(session_dir, "tessera")
            write_yaml(
                session_dir / "story_threads.yaml",
                tessera_threads("tessera", int(session_world.get("turn") or turn)),
            )
            update_session_metadata(session_dir, "tessera", session_dir.name)


def dedupe_named_items(items: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for item in items:
        value = str(item.get(key) or "").strip().lower()
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(item)
    return result


def write_ash(target_campaign: Path, archive_source: Path) -> None:
    campaign_id = "ashes-through-beacon-glass"
    scenario = read_yaml(target_campaign / "scenario.yaml", {})
    scenario.update(
        {
            "title": "Ashes Through Beacon Glass",
            "premise": (
                'Professor Ashley "Ash" Faist, a physicist from Earth displaced into Remnant, '
                "is entering Beacon Tower with Pyrrha Nikos to meet Ozpin. The story centers on "
                "trust, belonging, Pyrrha and Ash's bond, scientific curiosity, and the larger mysteries of Remnant."
            ),
            "opening_hook": (
                "Pyrrha and Ash are riding the circular elevator up Beacon Tower toward Ozpin's office, "
                "both newly aware of their mutual attraction while Ash is still displaced, homeless, and uninformed about Remnant."
            ),
        }
    )
    write_yaml(target_campaign / "scenario.yaml", scenario)

    world = update_world_campaign_id(target_campaign, campaign_id)
    world["current_scene"] = scenario["opening_hook"]
    world["pending_events"] = [
        "Beacon Tower elevator doors open toward Ozpin's office.",
        "Pyrrha waits to see whether Ash trusts Ozpin with the truth.",
        "Ash needs shelter, a cover story, and a first understanding of Remnant's rules.",
    ]
    append_unique_notes(
        world,
        [
            "Merged RolePlayGPT source campaign: ash-in-remnant.",
            "Skipped RolePlayGPT ash-market-signals because it is an unrelated scaffold with an accidental Ash scene.",
            "Keep continuity stable. Never speak for Ash.",
        ],
    )
    write_yaml(target_campaign / "world_state.yaml", world)

    archive_world = read_yaml(archive_source / "world_state.yaml", {})
    archive_turn = int(archive_world.get("turn") or 0)
    archive_recap = (archive_source / "recap.md").read_text(encoding="utf-8").strip()

    write_yaml(
        target_campaign / "event_queue.yaml",
        {"event_queue": world["pending_events"]},
    )
    write_yaml(
        target_campaign / "factions.yaml",
        {
            "factions": [
                {
                    "name": "Beacon Academy",
                    "goal": "Protect students and understand Ash's impossible arrival.",
                    "tension": 1,
                    "next_action": "Ozpin asks careful questions while watching Pyrrha's reaction.",
                    "last_outcome": None,
                },
                {
                    "name": "Grimm",
                    "goal": "Draw danger toward fear, negativity, and hidden supernatural pressure.",
                    "tension": 2,
                    "next_action": "Remain a distant but real pressure outside the Beacon Tower scene.",
                    "last_outcome": None,
                },
            ]
        },
    )
    write_yaml(
        target_campaign / "quests.yaml",
        [
            {
                "quest_id": "meet-ozpin",
                "title": "Meet Headmaster Ozpin",
                "status": "open",
                "summary": "Ash and Pyrrha must decide how much truth to reveal about Ash's origin.",
                "source_faction": "Beacon Academy",
                "created_turn": 0,
            },
            {
                "quest_id": "understand-remnant",
                "title": "Understand Remnant",
                "status": "open",
                "summary": "Ash needs shelter, social footing, and a working model of Aura, Dust, Grimm, and kingdoms.",
                "source_faction": "Self",
                "created_turn": 0,
            },
            {
                "quest_id": "protect-pyrrha-bond",
                "title": "Honor the Bond With Pyrrha",
                "status": "open",
                "summary": "Let the mutual attraction matter without speaking for Ash or flattening Pyrrha's agency.",
                "source_faction": "Pyrrha",
                "created_turn": 0,
            },
            {
                "quest_id": "semblance-training",
                "title": "Master Water Semblance",
                "status": "open",
                "summary": "Merged branch context: Ash may later develop cooperative water control, thermal manipulation, and ice.",
                "source_faction": "Self",
                "created_turn": archive_turn,
            },
            {
                "quest_id": "grimm-investigation",
                "title": "Investigate Grimm Origins",
                "status": "open",
                "summary": "Merged branch context: Ash and Pyrrha may cautiously investigate the nature and purpose of Grimm.",
                "source_faction": "Self",
                "created_turn": archive_turn,
            },
        ],
    )
    target_chars = read_yaml(target_campaign / "rpg_characters.yaml", {}).get("characters", [])
    archive_chars = read_yaml(archive_source / "rpg_characters.yaml", {}).get("characters", [])
    write_yaml(
        target_campaign / "rpg_characters.yaml",
        {
            "characters": dedupe_named_items(
                [
                    *target_chars,
                    {
                        "name": "Pyrrha Nikos",
                        "role": "Primary NPC",
                        "public_summary": "Beacon student who found Ash, chose to help him, and shares immediate rapport and attraction with him.",
                        "goals": ["Protect Ash", "Understand what his arrival means", "Keep her own agency and judgment"],
                        "traits": ["kind", "disciplined", "curious", "emotionally brave"],
                    },
                    {
                        "name": "Ozpin",
                        "role": "Headmaster",
                        "public_summary": "Beacon's headmaster, a careful authority figure about to meet a displaced physicist from another world.",
                        "goals": ["Assess Ash's danger and needs", "Protect Beacon", "Keep larger secrets contained"],
                        "traits": ["observant", "measured", "cryptic"],
                    },
                    *archive_chars,
                ],
                "name",
            )
        },
    )

    recap_path = target_campaign / "recap.md"
    recap = recap_path.read_text(encoding="utf-8").strip() if recap_path.exists() else ""
    recap_path.write_text(
        (
            f"{recap}\n\n"
            "Merged branch context from RolePlayGPT campaign `ash-in-remnant`:\n"
            f"{archive_recap}\n"
        ).strip()
        + "\n",
        encoding="utf-8",
    )
    timeline_path = target_campaign / "timeline.md"
    timeline = timeline_path.read_text(encoding="utf-8") if timeline_path.exists() else ""
    if timeline and not timeline.endswith("\n"):
        timeline += "\n"
    timeline += "- Merged RolePlayGPT campaign ash-in-remnant as session ash-in-remnant-archive.\n"
    timeline += "- Skipped ash-market-signals as an unrelated scaffold.\n"
    timeline_path.write_text(timeline, encoding="utf-8")

    write_yaml(target_campaign / "story_threads.yaml", ash_threads(campaign_id, archive_turn=archive_turn))
    update_campaign_metadata(target_campaign, campaign_id, "Ashes Through Beacon Glass")

    archive_session = target_campaign / "sessions" / "ash-in-remnant-archive"
    if archive_session.exists():
        shutil.rmtree(archive_session)
    archive_session.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(archive_source, archive_session)
    session_world = update_world_campaign_id(archive_session, campaign_id)
    write_yaml(
        archive_session / "story_threads.yaml",
        ash_threads(campaign_id, archive_turn=int(session_world.get("turn") or archive_turn)),
    )
    update_session_metadata(archive_session, campaign_id, "Ash in Remnant Archive")
    update_campaign_metadata(target_campaign, campaign_id, "Ashes Through Beacon Glass")


def import_requested(roleplay_storage: Path, character_storage: Path, *, replace: bool) -> list[str]:
    source_campaigns = roleplay_storage / "campaigns"
    target_campaigns = character_storage / "campaigns"
    target_campaigns.mkdir(parents=True, exist_ok=True)
    results: list[str] = []

    tessera_source = source_campaigns / "tessera"
    tessera_target = target_campaigns / "tessera"
    backup = copy_campaign_tree(tessera_source, tessera_target, replace=replace)
    write_tessera(tessera_target)
    results.append(f"copied tessera -> {tessera_target}" + (f" (backup: {backup})" if backup else ""))

    ash_source = source_campaigns / "ashes-through-beacon-glass"
    ash_target = target_campaigns / "ashes-through-beacon-glass"
    backup = copy_campaign_tree(ash_source, ash_target, replace=replace)
    write_ash(ash_target, source_campaigns / "ash-in-remnant")
    results.append(
        f"copied/merged ashes-through-beacon-glass + ash-in-remnant -> {ash_target}"
        + (f" (backup: {backup})" if backup else "")
    )
    results.append("skipped ash-market-signals, default-campaign, and ledgerfall")
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Copy selected RolePlayGPT campaigns into CharacterRPG.")
    parser.add_argument("--roleplay-storage", type=Path, default=DEFAULT_ROLEPLAY_STORAGE)
    parser.add_argument("--character-storage", type=Path, default=DEFAULT_CHARACTER_STORAGE)
    parser.add_argument("--replace", action="store_true", help="Back up and replace existing CharacterRPG imports.")
    args = parser.parse_args()

    for result in import_requested(args.roleplay_storage, args.character_storage, replace=args.replace):
        print(result)


if __name__ == "__main__":
    main()
