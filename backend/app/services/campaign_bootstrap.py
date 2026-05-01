from __future__ import annotations

import re
from pathlib import Path

from backend.app.config import PROJECT_ROOT
from backend.app.models.bootstrap import (
    CampaignBootstrapRequest,
    CampaignBootstrapResponse,
    CampaignBootstrapSummary,
    CampaignBundle,
)
from backend.app.models.character import CharacterProfile
from backend.app.models.faction import FactionState
from backend.app.models.quest import QuestState
from backend.app.models.scenario import ScenarioState
from backend.app.models.story import StoryThread
from backend.app.models.world_state import WorldState
from backend.app.services.campaign_storage import CampaignStorage
from backend.app.services.preset_library import get_named_preset, get_preset_defaults

SUPPORTED_LORE_SUFFIXES = {".json", ".markdown", ".md", ".txt", ".yaml", ".yml"}
MAX_LORE_FILES = 24
MAX_LORE_CHARS_PER_FILE = 8000
MAX_LORE_TOTAL_CHARS = 32000


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "campaign"


def _resolve_text(
    explicit_value: str | None,
    preset_value: str | None,
    fallback: str,
    field_name: str,
    inferred_fields: list[str],
    missing_fields: list[str],
    allow_inference: bool,
) -> str:
    if explicit_value and explicit_value.strip():
        return explicit_value.strip()
    if preset_value and preset_value.strip():
        return preset_value.strip()
    if not allow_inference:
        missing_fields.append(field_name)
        return ""
    inferred_fields.append(field_name)
    return fallback


def _resolve_list(
    explicit_values: list[str],
    preset_values: list[str] | None,
    fallback: list[str],
    field_name: str,
    inferred_fields: list[str],
    allow_inference: bool,
) -> list[str]:
    cleaned_explicit = [value.strip() for value in explicit_values if value and value.strip()]
    if cleaned_explicit:
        return cleaned_explicit

    cleaned_preset = [value.strip() for value in (preset_values or []) if value and value.strip()]
    if cleaned_preset:
        return cleaned_preset

    if not allow_inference:
        return []

    inferred_fields.append(field_name)
    return list(fallback)


def _project_relative_display(path: Path) -> str:
    try:
        return str(path.relative_to(PROJECT_ROOT))
    except ValueError:
        return str(path)


def _resolve_lore_path(raw_path: str) -> Path:
    cleaned = raw_path.strip()
    if not cleaned:
        raise ValueError("Lore paths must not be empty.")

    path = Path(cleaned).expanduser()
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


def _collect_lore_files(path: Path) -> list[Path]:
    if not path.exists():
        raise ValueError(f"Lore path does not exist: {path}")

    if path.is_file():
        if path.suffix.lower() not in SUPPORTED_LORE_SUFFIXES:
            suffixes = ", ".join(sorted(SUPPORTED_LORE_SUFFIXES))
            raise ValueError(f"Unsupported lore file type for {path}. Use: {suffixes}.")
        return [path]

    files = [
        child
        for child in sorted(path.rglob("*"))
        if child.is_file()
        and child.suffix.lower() in SUPPORTED_LORE_SUFFIXES
        and not any(part.startswith(".") for part in child.parts)
    ]
    if not files:
        raise ValueError(
            f"No supported lore files were found under {path}. Use text, markdown, yaml, or json files."
        )
    return files[:MAX_LORE_FILES]


def _clean_lore_text(text: str) -> str:
    return text.replace("\x00", "").strip()


def _load_lore_context(request: CampaignBootstrapRequest) -> tuple[str | None, list[str]]:
    sections: list[str] = []
    lore_sources: list[str] = []
    remaining_chars = MAX_LORE_TOTAL_CHARS

    if request.context_summary and request.context_summary.strip():
        sections.append(f"Operator summary:\n{request.context_summary.strip()}")

    if request.lore_text and request.lore_text.strip() and remaining_chars > 0:
        lore_text = _clean_lore_text(request.lore_text)
        lore_excerpt = lore_text[:remaining_chars].strip()
        if lore_excerpt:
            sections.append(f"Direct lore notes:\n{lore_excerpt}")
            remaining_chars -= len(lore_excerpt)
            lore_sources.append("inline:lore_text")

    if remaining_chars <= 0:
        return "\n\n".join(sections).strip() or None, lore_sources

    loaded_files: list[Path] = []
    for raw_path in request.lore_paths:
        resolved_path = _resolve_lore_path(raw_path)
        loaded_files.extend(_collect_lore_files(resolved_path))

    seen_paths: set[Path] = set()
    for source_path in loaded_files:
        if source_path in seen_paths or remaining_chars <= 0:
            continue
        seen_paths.add(source_path)

        body = _clean_lore_text(source_path.read_text(encoding="utf-8", errors="ignore"))
        if not body:
            continue

        per_file_limit = min(MAX_LORE_CHARS_PER_FILE, remaining_chars)
        excerpt = body[:per_file_limit].strip()
        if not excerpt:
            continue
        if len(body) > per_file_limit:
            excerpt = excerpt.rstrip() + "\n[truncated]"

        display_path = _project_relative_display(source_path)
        sections.append(f"Source: {display_path}\n{excerpt}")
        lore_sources.append(display_path)
        remaining_chars -= len(excerpt)

    combined = "\n\n".join(section for section in sections if section.strip()).strip()
    return combined or None, lore_sources


def _lore_anchor(context_summary: str | None) -> str | None:
    if not context_summary:
        return None
    flattened = " ".join(context_summary.split())
    if not flattened:
        return None
    if len(flattened) <= 220:
        return flattened
    return flattened[:217].rstrip() + "..."


def _prefers_faction_frame(
    genre_vibe: str,
    context_summary: str | None,
    play_preferences: list[str],
) -> bool:
    combined = " ".join([genre_vibe, context_summary or "", *play_preferences]).lower()
    faction_opt_out = (
        "no faction",
        "without faction",
        "not faction",
        "solo",
        "intimate",
        "relationship",
        "slice of life",
        "personal drama",
    )
    if any(marker in combined for marker in faction_opt_out):
        return False
    faction_markers = (
        "faction",
        "politic",
        "court",
        "guild",
        "gang",
        "syndicate",
        "empire",
        "kingdom",
        "rebellion",
        "war",
        "spy",
        "conspiracy",
        "corporate",
        "cyberpunk",
        "space opera",
    )
    return any(marker in combined for marker in faction_markers)


def _story_thread_slug(campaign_id: str, suffix: str) -> str:
    return f"{campaign_id}-{_slugify(suffix)}"


def _primary_thread_type(genre_vibe: str, context_summary: str | None) -> str:
    lowered = f"{genre_vibe} {context_summary or ''}".lower()
    if any(marker in lowered for marker in ("mystery", "noir", "detective", "investigation")):
        return "mystery"
    if any(marker in lowered for marker in ("romance", "relationship", "intimacy")):
        return "relationship"
    if any(marker in lowered for marker in ("horror", "haunt", "monster", "dread")):
        return "threat"
    if any(marker in lowered for marker in ("survival", "isolation", "stranded", "disaster")):
        return "threat"
    return "personal_arc"


def _thread_next_beat(thread_type: str, setting: str, pc_name: str) -> str:
    if thread_type == "mystery":
        return "Reveal one concrete clue, but make the answer raise a sharper question."
    if thread_type == "relationship":
        return "Give an NPC a clear emotional reaction that tests trust, desire, loyalty, or boundaries."
    if thread_type == "threat":
        return "Show the pressure getting closer through a specific sensory sign or immediate cost."
    if thread_type == "environment":
        return f"Let {setting} change the situation before anyone can settle into safety."
    return f"Force {pc_name} to choose what they are willing to risk, hide, admit, or protect."


def _initial_story_beat(thread_type: str, setting: str, pc_name: str) -> str:
    if thread_type == "mystery":
        return "a witness, clue, or contradiction is close enough to act on, but revealing it will put someone at risk."
    if thread_type == "relationship":
        return "an NPC's emotional reaction makes the next choice impossible to treat as neutral."
    if thread_type == "threat":
        return "a specific sign shows the danger has already entered the scene."
    if thread_type == "environment":
        return f"{setting} changes the situation before anyone can settle into safety."
    return f"{pc_name} is pushed toward a choice that exposes what matters most."


def _build_story_threads(
    campaign_id: str,
    *,
    setting: str,
    genre_vibe: str,
    pc_name: str,
    pc_concept: str,
    lore_anchor: str | None,
    factions: list[FactionState],
) -> list[StoryThread]:
    primary_type = _primary_thread_type(genre_vibe, lore_anchor)
    central_summary = (
        f"Lore pressure: {lore_anchor}"
        if lore_anchor
        else f"The central pressure of this {genre_vibe} story is active in {setting}."
    )
    threads = [
        StoryThread(
            thread_id=_story_thread_slug(campaign_id, "central-pressure"),
            type=primary_type,
            title="Central Pressure",
            tension=2,
            summary=central_summary,
            current_beat=_initial_story_beat(primary_type, setting, pc_name),
            next_beat=_thread_next_beat(primary_type, setting, pc_name),
            unresolved_question="What truth, cost, or emotional turn will make the situation harder to ignore?",
        ),
        StoryThread(
            thread_id=_story_thread_slug(campaign_id, "personal-arc"),
            type="personal_arc",
            title=f"{pc_name}'s Personal Arc",
            tension=1,
            summary=f"{pc_name} is {pc_concept}",
            current_beat=f"{pc_name} has entered the story with unfinished business and a point of vulnerability.",
            next_beat=_thread_next_beat("personal_arc", setting, pc_name),
            unresolved_question=f"What does {pc_name} want badly enough to complicate the easy answer?",
        ),
        StoryThread(
            thread_id=_story_thread_slug(campaign_id, "place-pressure"),
            type="environment",
            title="The Place Pushes Back",
            tension=1,
            summary=f"{setting} should act like a living pressure on the scene, not just a backdrop.",
            current_beat="The location frames the opening situation.",
            next_beat=_thread_next_beat("environment", setting, pc_name),
            unresolved_question="How does the place make the next choice more immediate?",
        ),
    ]
    if factions:
        threads.append(
            StoryThread(
                thread_id=_story_thread_slug(campaign_id, "faction-pressure"),
                type="faction",
                title="Faction Pressure",
                tension=2,
                summary=(
                    f"{factions[0].name} and {factions[1].name} both have interests that can move "
                    "even when the player hesitates."
                ),
                current_beat="The factions are watching for leverage.",
                next_beat=f"Let {factions[0].name} or {factions[1].name} make a small, concrete move.",
                unresolved_question="Who benefits if the PC delays?",
            )
        )
    return threads


def _build_factions(genre_vibe: str) -> list[FactionState]:
    lowered = genre_vibe.lower()
    if "cyber" in lowered or "punk" in lowered:
        return [
            FactionState(
                name="Glasswire Collective",
                goal="Expose the city's buried control systems.",
                tension=1,
                next_action="Recruit deniable operators for a data heist.",
            ),
            FactionState(
                name="Civic Continuity Bureau",
                goal="Keep public order by controlling information.",
                tension=1,
                next_action="Audit unusual network traffic around key districts.",
            ),
        ]
    if "space" in lowered or "sci" in lowered:
        return [
            FactionState(
                name="Harbor Ring Syndicate",
                goal="Monopolize access to the outer trade lanes.",
                tension=1,
                next_action="Lean on independent crews for leverage.",
            ),
            FactionState(
                name="Transit Authority of Nine",
                goal="Stabilize the station before unrest spreads.",
                tension=1,
                next_action="Deploy inspectors and sealed orders.",
            ),
        ]
    if "mystery" in lowered or "cozy" in lowered:
        return [
            FactionState(
                name="Town Council Archive",
                goal="Keep local history from turning into scandal.",
                tension=1,
                next_action="Quietly retrieve records before someone else does.",
            ),
            FactionState(
                name="Lantern Society",
                goal="Bring hidden truths to light on their own terms.",
                tension=1,
                next_action="Test the PC with a carefully chosen lead.",
            ),
        ]
    return [
        FactionState(
            name="Cinder Court",
            goal="Expand influence through covert pacts.",
            tension=1,
            next_action="Place trusted envoys near the region's pressure points.",
        ),
        FactionState(
            name="Verdant Compact",
            goal="Keep older obligations and border territories intact.",
            tension=1,
            next_action="Interfere with any deal that shifts the balance too quickly.",
        ),
    ]


def _genre_npc_names(genre_vibe: str) -> list[str]:
    lowered = genre_vibe.lower()
    if "cyber" in lowered or "tech" in lowered:
        return ["Talia Sorn", "Jex Mercer", "Lin Quill"]
    if "space" in lowered or "sci" in lowered:
        return ["Rhea Tal", "Orin Vale", "Kes Marr"]
    if "mystery" in lowered or "gothic" in lowered:
        return ["Elara Wren", "Silas Mere", "Juniper Vale"]
    return ["Mara Voss", "Iven Hale", "Sera Flint"]


def build_campaign_bundle(request: CampaignBootstrapRequest) -> CampaignBundle:
    preset_defaults = get_preset_defaults()
    preset = get_named_preset(request.preset_name)
    combined_context_summary, lore_sources = _load_lore_context(request)

    if not any(
        [
            request.setting,
            preset.get("setting"),
            request.genre_vibe,
            preset.get("genre_vibe"),
            request.player_character.concept,
            combined_context_summary,
            preset.get("premise_hook"),
        ]
    ):
        raise ValueError(
            "Bootstrap requires at least one of setting, genre_vibe, player_character.concept, context_summary, lore_text, lore_paths, or a valid preset_name."
        )

    allow_inference = request.allow_inference
    inferred_fields: list[str] = []
    missing_fields: list[str] = []

    setting = _resolve_text(
        request.setting,
        preset.get("setting"),
        "Frontier crossroads under rising pressure",
        "setting",
        inferred_fields,
        missing_fields,
        allow_inference,
    )
    genre_vibe = _resolve_text(
        request.genre_vibe,
        preset.get("genre_vibe"),
        "Character-driven adventure",
        "genre_vibe",
        inferred_fields,
        missing_fields,
        allow_inference,
    )
    tone = _resolve_text(
        request.tone,
        preset.get("tone"),
        "Cinematic",
        "tone",
        inferred_fields,
        missing_fields,
        allow_inference,
    )
    pc_name = _resolve_text(
        request.player_character.name,
        None,
        "The Protagonist",
        "player_character.name",
        inferred_fields,
        missing_fields,
        allow_inference,
    )
    pc_concept = _resolve_text(
        request.player_character.concept,
        None,
        "A capable outsider with unfinished business in the region.",
        "player_character.concept",
        inferred_fields,
        missing_fields,
        allow_inference,
    )

    if request.story_name and request.story_name.strip():
        story_title = request.story_name.strip()
    elif request.preset_name and request.preset_name.strip():
        story_title = request.preset_name.strip()
    elif not allow_inference:
        missing_fields.append("story_name")
        story_title = ""
    else:
        inferred_fields.append("story_name")
        story_title = f"{pc_name} and the Unsteady Horizon"

    if missing_fields:
        missing_fields = sorted(set(missing_fields))
        missing_display = ", ".join(missing_fields)
        raise ValueError(
            f"Bootstrap requires explicit values for: {missing_display} when allow_inference is false."
        )

    themes = _resolve_list(
        request.themes,
        preset.get("themes"),
        ["identity", "trust", "consequences"],
        "themes",
        inferred_fields,
        allow_inference,
    )
    play_preferences = _resolve_list(
        request.play_preferences,
        None,
        [],
        "play_preferences",
        inferred_fields,
        allow_inference=False,
    )
    lore_anchor = _lore_anchor(combined_context_summary)

    use_factions = _prefers_faction_frame(genre_vibe, combined_context_summary, play_preferences)
    factions = _build_factions(genre_vibe) if use_factions else []
    campaign_id = _slugify(story_title)
    story_threads = _build_story_threads(
        campaign_id,
        setting=setting,
        genre_vibe=genre_vibe,
        pc_name=pc_name,
        pc_concept=pc_concept,
        lore_anchor=lore_anchor,
        factions=factions,
    )
    primary_thread = story_threads[0]
    premise_hook = str(preset.get("premise_hook") or "").strip()
    if premise_hook:
        premise = f"{premise_hook} In {setting}, {pc_name} is pulled into {primary_thread.summary}"
    elif factions:
        premise = (
            f"In {setting}, {pc_name} is pulled into a fragile conflict where "
            f"{factions[0].name} and {factions[1].name} both need something only the PC can influence."
        )
    else:
        premise = (
            f"In {setting}, {pc_name} is pulled into a story shaped by "
            f"{primary_thread.title.lower()}: {primary_thread.summary}"
        )
    if lore_anchor:
        premise = f"{premise} Lore context: {lore_anchor}"

    opening_pressures = [
        str(entry).strip()
        for entry in (preset.get("opening_pressures") or [])
        if str(entry).strip()
    ]
    if opening_pressures:
        opening_hook = f"As the story opens in {setting}, {opening_pressures[0]}"
    elif factions:
        opening_hook = (
            f"As the story opens in {setting}, a messenger arrives with an offer that could "
            f"shift the balance between {factions[0].name} and {factions[1].name} before nightfall."
        )
    else:
        opening_hook = (
            f"As the story opens in {setting}, {primary_thread.current_beat}"
        )

    quests = [
        QuestState(
            quest_id=f"{campaign_id}-quest-001",
            title=primary_thread.title,
            summary=primary_thread.summary,
            source_faction=factions[0].name if factions else primary_thread.type,
            created_turn=0,
        ),
        QuestState(
            quest_id=f"{campaign_id}-quest-002",
            title=story_threads[1].title,
            summary=story_threads[1].summary,
            source_faction=factions[1].name if len(factions) > 1 else story_threads[1].type,
            created_turn=0,
        ),
    ]

    world_state = WorldState(
        campaign_id=campaign_id,
        turn=0,
        current_scene=opening_hook,
        location=setting,
        time_of_day="day",
        world_pressure=1,
        pressure_clock=0,
        factions=factions,
        active_quests=quests,
        pending_events=opening_pressures[:3]
        or (
            [
                f"{factions[0].name} is preparing an opening move.",
                f"{factions[1].name} is watching for signs that the PC has chosen a side.",
            ]
            if factions
            else [
                thread.next_beat
                for thread in story_threads[:3]
                if thread.status == "active" and thread.next_beat
            ]
        )
        or ["A story thread needs an immediate beat before the scene can settle."],
        notes=[
            f"PC concept: {pc_concept}",
            f"Tone: {tone}",
        ]
        + [f"Play preference: {entry}" for entry in play_preferences]
        + [f"Lore source: {source}" for source in lore_sources]
        + [f"Lore anchor: {lore_anchor}" for _ in [1] if lore_anchor]
        + [f"Pacing: {preset_defaults.get('pacing')}" for _ in [1] if preset_defaults.get("pacing")]
        + [
            f"Campaign focus: {preset_defaults.get('focus')}"
            for _ in [1]
            if preset_defaults.get("focus")
        ]
        + [
            f"Complication: {entry}"
            for entry in preset.get("complications", [])
            if isinstance(entry, str) and entry.strip()
        ],
    )

    scenario = ScenarioState(
        title=story_title,
        premise=premise,
        setting=setting,
        genre_vibe=genre_vibe,
        tone=tone,
        themes=themes,
        play_preferences=play_preferences,
        preset_name=request.preset_name,
        context_summary=combined_context_summary,
        inferred_fields=inferred_fields,
        opening_hook=opening_hook,
    )

    if factions:
        relationship_graph = {
            "PC": {
                factions[0].name: "watched with cautious interest",
                factions[1].name: "treated as a possible swing factor",
            }
        }
    else:
        relationship_graph = {
            "PC": {
                primary_thread.title: "personally entangled",
                "The Setting": "under immediate pressure",
            }
        }

    rpg_characters = [
        CharacterProfile(
            name=pc_name,
            role="Player Character",
            public_summary=pc_concept,
            goals=request.player_character.goals,
            traits=request.player_character.edges + request.player_character.complications,
        )
    ]

    starter_npcs = [
        str(entry).strip()
        for entry in (preset.get("starter_npcs") or [])
        if str(entry).strip()
    ]
    if starter_npcs:
        for index, descriptor in enumerate(starter_npcs[:3]):
            npc_names = _genre_npc_names(genre_vibe)
            rpg_characters.append(
                CharacterProfile(
                    name=npc_names[index],
                    role="Starter NPC",
                    public_summary=descriptor[0].upper() + descriptor[1:],
                    goals=[f"Survive the fallout in {setting}."],
                    traits=themes[:2],
                )
            )
    else:
        if factions:
            rpg_characters.extend(
                [
                    CharacterProfile(
                        name="Mara Voss",
                        role="Faction Envoy",
                        public_summary=f"A poised operator speaking for {factions[0].name}.",
                        goals=[factions[0].goal],
                        traits=["calm under pressure", "measured", "observant"],
                    ),
                    CharacterProfile(
                        name="Iven Hale",
                        role="Local Intermediary",
                        public_summary=f"A careful broker trying to avoid open conflict with {factions[1].name}.",
                        goals=[factions[1].goal],
                        traits=["guarded", "pragmatic", "politically aware"],
                    ),
                ]
            )
        else:
            npc_names = _genre_npc_names(genre_vibe)
            rpg_characters.extend(
                [
                    CharacterProfile(
                        name=npc_names[0],
                        role="Story Catalyst",
                        public_summary=f"An NPC tied to {primary_thread.title.lower()}.",
                        goals=[primary_thread.next_beat],
                        traits=["specific", "active", "emotionally readable"],
                    ),
                    CharacterProfile(
                        name=npc_names[1],
                        role="Pressure Point",
                        public_summary=f"Someone whose choices complicate {pc_name}'s path.",
                        goals=[story_threads[1].next_beat],
                        traits=["guarded", "motivated", "consequential"],
                    ),
                ]
            )

    timeline = [f"Campaign initialized: {story_title} in {setting}."]
    if factions:
        recap = (
            f"{pc_name} enters {setting} as tensions build between {factions[0].name} and "
            f"{factions[1].name}. The first decision will determine who gains the initiative."
        )
    else:
        recap = (
            f"{pc_name} enters {setting} with {primary_thread.title.lower()} already in motion. "
            f"The first decision should reveal, complicate, or deepen one active story thread."
        )

    return CampaignBundle(
        world_state=world_state,
        scenario=scenario,
        factions=factions,
        event_queue=list(world_state.pending_events),
        relationship_graph=relationship_graph,
        rpg_characters=rpg_characters,
        quests=quests,
        story_threads=story_threads,
        timeline=timeline,
        recap=recap,
    )


def create_campaign_bootstrap(
    request: CampaignBootstrapRequest,
    storage: CampaignStorage,
) -> CampaignBootstrapResponse:
    bundle = build_campaign_bundle(request)
    campaign_storage = storage.for_campaign(bundle.world_state.campaign_id)
    files_written = campaign_storage.save_bundle(bundle)
    campaign_storage.touch_campaign_summary(title=bundle.scenario.title)
    summary = CampaignBootstrapSummary(
        title=bundle.scenario.title,
        premise=bundle.scenario.premise,
        opening_hook=bundle.scenario.opening_hook,
        starter_quests=[quest.title for quest in bundle.quests],
        inferred_fields=bundle.scenario.inferred_fields,
        lore_sources=[
            note.removeprefix("Lore source: ").strip()
            for note in bundle.world_state.notes
            if note.startswith("Lore source: ")
        ],
    )
    return CampaignBootstrapResponse(
        campaign_id=bundle.world_state.campaign_id,
        summary=summary,
        files_written=files_written,
    )
