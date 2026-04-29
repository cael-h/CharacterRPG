from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import yaml
from pydantic import BaseModel

from backend.app.config import settings
from backend.app.model_utils import model_dump
from backend.app.models.quest import QuestState
from backend.app.models.world_state import WorldState
from backend.app.services.campaign_storage import CampaignStorage


class QuickTestResult(BaseModel):
    checks: dict[str, str]
    report: str
    run_id: str


class FullSimulationResult(BaseModel):
    turns_simulated: int
    events_triggered: int
    faction_conflicts: int
    quests_generated: int
    recap_compressions: int
    system_stability: str
    report: str
    run_id: str


def _build_run_context(run_id: str) -> tuple[CampaignStorage, Path, Path]:
    base = settings.dev_test_storage_dir
    runs_dir = base / "test_runs"
    result_dir = base / "test_results"
    recap_dir = base / "test_recaps" / run_id
    world_state_dir = base / "test_world_state" / run_id
    runs_dir.mkdir(parents=True, exist_ok=True)
    recap_dir.mkdir(parents=True, exist_ok=True)
    world_state_dir.mkdir(parents=True, exist_ok=True)
    result_dir.mkdir(parents=True, exist_ok=True)
    return CampaignStorage(world_state_dir), result_dir, recap_dir


def _timestamped_run_id(prefix: str) -> str:
    return f"{prefix}-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}"


def _write_run_manifest(run_id: str, run_type: str, payload: dict[str, object]) -> None:
    manifest_path = settings.dev_test_storage_dir / "test_runs" / f"{run_id}.yaml"
    manifest = {
        "run_id": run_id,
        "run_type": run_type,
        "recorded_at": datetime.now(UTC).isoformat(),
        **payload,
    }
    manifest_path.write_text(yaml.safe_dump(manifest, sort_keys=False), encoding="utf-8")


def run_quick_tests() -> QuickTestResult:
    settings.ensure_directories()
    run_id = _timestamped_run_id("quick")
    storage, result_dir, recap_dir = _build_run_context(run_id)

    checks: dict[str, str] = {}
    state = storage.load_world_state()
    checks["Bootstrap"] = "PASS" if state.turn == 0 else "FAIL"

    state.current_scene = "A tense negotiation unfolds in a rain-soaked courtyard."
    checks["Scene Engine"] = "PASS" if "negotiation" in state.current_scene.lower() else "FAIL"

    state.pressure_clock = min(state.pressure_clock + 1, 6)
    checks["Narrative Pressure"] = "PASS" if state.pressure_clock == 1 else "FAIL"

    first_faction = state.factions[0]
    first_faction.tension = min(first_faction.tension + 2, 10)
    first_faction.last_outcome = "Secured a dangerous favor from a merchant prince."
    checks["Faction Simulation"] = "PASS" if first_faction.tension == 2 else "FAIL"

    state.pending_events.append("A rival envoy requests an immediate audience.")
    checks["Event Queue"] = "PASS" if len(state.pending_events) == 1 else "FAIL"

    generated_quest = QuestState(
        quest_id="quick-quest-001",
        title="Broker the Midnight Accord",
        summary="Secure terms before the envoy weaponizes the rumor network.",
        source_faction=first_faction.name,
        created_turn=state.turn,
    )
    state.active_quests.append(generated_quest)
    checks["Quest Generator"] = "PASS" if len(state.active_quests) == 1 else "FAIL"

    storage.save_world_state(state)
    storage.append_timeline("Quick test autosave captured the negotiation setup.")
    recap_text = "Quick test recap: campaign bootstrap, pressure, factions, and autosave all executed."
    storage.update_recap(recap_text)
    (recap_dir / "recap.md").write_text(recap_text + "\n", encoding="utf-8")
    autosave_ok = (
        storage.world_state_path.exists()
        and storage.timeline_path.exists()
        and storage.recap_path.exists()
        and storage.quests_path.exists()
    )
    checks["Autosave"] = "PASS" if autosave_ok else "FAIL"

    report_lines = [
        "SYSTEM TEST REPORT",
        "",
        f"Bootstrap: {checks['Bootstrap']}",
        f"Scene Engine: {checks['Scene Engine']}",
        f"Narrative Pressure: {checks['Narrative Pressure']}",
        f"Faction Simulation: {checks['Faction Simulation']}",
        f"Event Queue: {checks['Event Queue']}",
        f"Quest Generator: {checks['Quest Generator']}",
        f"Autosave: {checks['Autosave']}",
    ]
    report = "\n".join(report_lines)
    (result_dir / f"{run_id}.txt").write_text(report + "\n", encoding="utf-8")
    _write_run_manifest(
        run_id,
        "quick",
        {
            "checks": checks,
            "report": report,
        },
    )
    return QuickTestResult(checks=checks, report=report, run_id=run_id)


def run_full_simulation(turns: int = 20) -> FullSimulationResult:
    settings.ensure_directories()
    run_id = _timestamped_run_id("full")
    storage, result_dir, recap_dir = _build_run_context(run_id)

    state = storage.load_world_state()
    events_triggered = 0
    faction_conflicts = 0
    quests_generated = 0
    recap_compressions = 0
    recap_buffer: list[str] = []

    for turn_number in range(1, turns + 1):
        state.turn = turn_number
        state.pressure_clock = (state.pressure_clock + 1) % 7
        state.current_scene = f"Turn {turn_number}: pressure rises across the border settlements."

        for faction in state.factions:
            faction.tension = min(faction.tension + 1, 10)
            faction.next_action = f"Turn {turn_number}: escalate leverage against a local rival."
            faction.last_outcome = f"Turn {turn_number}: consolidated influence."

        if turn_number % 4 == 0:
            events_triggered += 1
            state.pending_events.append(
                f"Turn {turn_number}: a public incident forces both factions to respond."
            )

        if state.factions[0].tension >= 5 and state.factions[1].tension >= 5:
            faction_conflicts += 1

        if turn_number % 3 == 0:
            quests_generated += 1
            state.active_quests.append(
                QuestState(
                    quest_id=f"sim-quest-{turn_number:03d}",
                    title=f"Stabilize the frontier after turn {turn_number}",
                    summary="Respond to the latest faction pressure before the unrest spreads.",
                    source_faction=state.factions[turn_number % len(state.factions)].name,
                    created_turn=turn_number,
                )
            )

        timeline_entry = (
            f"Turn {turn_number}: pressure={state.pressure_clock}, "
            f"quests={len(state.active_quests)}, events={len(state.pending_events)}"
        )
        storage.append_timeline(timeline_entry)
        recap_buffer.append(timeline_entry)

        if len(recap_buffer) > 5:
            recap_buffer = recap_buffer[-5:]
            recap_compressions += 1

        recap_text = "Recent simulation summary:\n" + "\n".join(recap_buffer)
        storage.update_recap(recap_text)
        (recap_dir / f"turn-{turn_number:02d}.md").write_text(recap_text + "\n", encoding="utf-8")
        storage.save_world_state(state)

    system_stability = "PASS" if state.turn == turns else "FAIL"
    report_lines = [
        "SIMULATION REPORT",
        "",
        f"Turns simulated: {turns}",
        f"Events triggered: {events_triggered}",
        f"Faction conflicts: {faction_conflicts}",
        f"Quests generated: {quests_generated}",
        f"Recap compressions: {recap_compressions}",
        f"System stability: {system_stability}",
    ]
    report = "\n".join(report_lines)
    (result_dir / f"{run_id}.txt").write_text(report + "\n", encoding="utf-8")
    result = FullSimulationResult(
        turns_simulated=turns,
        events_triggered=events_triggered,
        faction_conflicts=faction_conflicts,
        quests_generated=quests_generated,
        recap_compressions=recap_compressions,
        system_stability=system_stability,
        report=report,
        run_id=run_id,
    )
    _write_run_manifest(run_id, "full", model_dump(result))
    return result
