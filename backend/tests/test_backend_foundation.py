import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import config
from backend.app.main import app
from backend.app.models.bootstrap import CampaignBootstrapRequest, PlayerCharacterInput
from backend.app.models.play import LocalPlayRequest, RuntimeSettings
from backend.app.models.setup import CampaignSetupRequest
from backend.app.services.campaign_bootstrap import build_campaign_bundle
from backend.app.services.campaign_storage import CampaignStorage
from backend.app.services.model_providers import ModelResponse
from backend.app.services.local_play import (
    _build_runtime_instructions,
    _build_story_director_brief,
    _clean_player_facing_reply,
    _looks_like_hidden_planning,
    _resolve_runtime_settings,
    generate_local_play_response,
)
from backend.app.services.setup_assistant import generate_setup_response


client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import backend.app.api.campaign as campaign_api
    import backend.app.api.play as play_api

    generated_dir = tmp_path / "generated"
    storage = CampaignStorage(generated_dir)
    monkeypatch.setattr(campaign_api, "storage", storage)
    monkeypatch.setattr(play_api, "storage", storage)


def test_health_endpoint_reports_ok() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_provider_listing_includes_configured_adapters() -> None:
    response = client.get("/providers")
    payload = response.json()

    assert response.status_code == 200
    providers = {item["provider"] for item in payload["providers"]}
    assert "mock" in providers
    assert "venice" in providers
    assert "ollama" in providers


def test_provider_test_uses_mock_without_external_keys() -> None:
    response = client.post(
        "/providers/test",
        json={
            "provider": "mock",
            "prompt": "Can you respond locally?",
        },
    )
    payload = response.json()

    assert response.status_code == 200
    assert payload["provider"] == "mock"
    assert payload["model"] == "mock-rpg-model"
    assert "Can you respond locally?" in payload["reply"]


def test_setup_review_previews_ready_draft_without_writing_campaign() -> None:
    response = client.post(
        "/setup/review",
        json={
            "draft": {
                "story_name": "Red Lantern Ledger",
                "setting": "Sable Harbor, an occult port city",
                "genre_vibe": "Adult noir fantasy",
                "player_character": {
                    "name": "Liora Vance",
                    "concept": "A disgraced oath-broker tracking a missing courier.",
                },
            }
        },
    )
    payload = response.json()

    assert response.status_code == 200
    assert payload["ready_to_bootstrap"] is True
    assert payload["campaign_id"] == "red-lantern-ledger"
    assert payload["summary"]["title"] == "Red Lantern Ledger"

    campaigns_response = client.get("/play/campaigns")
    assert campaigns_response.status_code == 200
    assert campaigns_response.json() == []


def test_setup_review_reports_missing_required_draft_fields() -> None:
    response = client.post("/setup/review", json={"draft": {}})
    payload = response.json()

    assert response.status_code == 200
    assert payload["ready_to_bootstrap"] is False
    assert "setting_or_lore" in payload["missing_fields"]
    assert "genre_vibe" in payload["missing_fields"]
    assert "player_character.concept" in payload["missing_fields"]


def test_setup_response_preserves_existing_preferences_when_model_omits_them() -> None:
    class FakeResponse:
        status_code = 200

        def json(self) -> dict[str, object]:
            return {
                "output_text": (
                    "{"
                    '"assistant_reply":"Draft tightened.",'
                    '"draft":{"story_name":"Red Lantern","setting":"Sable Harbor","genre_vibe":"Noir","player_character":{"concept":"Oath-broker"}},'
                    '"ready_to_bootstrap":true,'
                    '"missing_fields":[]'
                    "}"
                )
            }

    class FakeClient:
        def post(self, *_args: object, **_kwargs: object) -> FakeResponse:
            return FakeResponse()

    response = generate_setup_response(
        CampaignSetupRequest(
            user_message="Tighten this.",
            draft=CampaignBootstrapRequest(
                story_name="Red Lantern",
                setting="Sable Harbor",
                genre_vibe="Noir",
                themes=["debt"],
                play_preferences=["Mature content can be included when natural."],
                player_character=PlayerCharacterInput(
                    name="Liora",
                    concept="Oath-broker",
                    goals=["Find Cassian"],
                ),
            ),
        ),
        client=FakeClient(),
    )

    assert response.ready_to_bootstrap is True
    assert response.draft.play_preferences == ["Mature content can be included when natural."]
    assert response.draft.themes == ["debt"]
    assert response.draft.player_character.name == "Liora"
    assert response.draft.player_character.goals == ["Find Cassian"]


def test_setup_response_reports_invalid_model_json() -> None:
    class FakeResponse:
        status_code = 200

        def json(self) -> dict[str, str]:
            return {"output_text": "This is not JSON."}

    class FakeClient:
        def post(self, *_args: object, **_kwargs: object) -> FakeResponse:
            return FakeResponse()

    with pytest.raises(RuntimeError, match="invalid JSON"):
        generate_setup_response(
            CampaignSetupRequest(user_message="Draft this."),
            client=FakeClient(),
        )


def test_env_loader_strips_quotes_filters_keys_and_preserves_process_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "VENICE_KEY='file-secret'\n"
        'export OPENAI_KEY="file-openai"\n'
        "IGNORED_SECRET=do-not-load\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("VENICE_KEY", raising=False)
    monkeypatch.setenv("OPENAI_KEY", "process-openai")
    monkeypatch.delenv("IGNORED_SECRET", raising=False)

    config._load_env_file(env_file, allowed_keys={"VENICE_KEY", "OPENAI_KEY"})

    assert os.environ["VENICE_KEY"] == "file-secret"
    assert os.environ["OPENAI_KEY"] == "process-openai"
    assert "IGNORED_SECRET" not in os.environ


def test_campaign_bootstrap_writes_campaign_bundle() -> None:
    response = client.post(
        "/campaign/bootstrap",
        json={
            "story_name": "Ash Market Signals",
            "setting": "A trade district built inside a retired fortress",
            "genre_vibe": "Urban fantasy intrigue",
            "player_character": {
                "name": "Nera Vale",
                "concept": "A courier with a dangerous memory for routes.",
            },
        },
    )
    payload = response.json()

    assert response.status_code == 200
    assert payload["campaign_id"] == "ash-market-signals"
    assert len(payload["files_written"]) == 10

    bundle_response = client.get("/campaign/bundle", params={"campaign_id": "ash-market-signals"})
    bundle = bundle_response.json()
    assert bundle_response.status_code == 200
    assert bundle["scenario"]["title"] == "Ash Market Signals"
    assert bundle["world_state"]["campaign_id"] == "ash-market-signals"
    assert bundle["factions"] == []
    assert len(bundle["story_threads"]) >= 3
    assert bundle["story_threads"][0]["type"] in {"mystery", "personal_arc"}


def test_campaign_bootstrap_keeps_factions_when_story_asks_for_them() -> None:
    response = client.post(
        "/campaign/bootstrap",
        json={
            "story_name": "Court Signals",
            "setting": "A fortress city",
            "genre_vibe": "Political court intrigue with rival factions",
            "player_character": {
                "name": "Nera Vale",
                "concept": "A courier with a dangerous memory for routes.",
            },
        },
    )
    bundle = client.get("/campaign/bundle", params={"campaign_id": response.json()["campaign_id"]}).json()

    assert response.status_code == 200
    assert len(bundle["factions"]) == 2
    assert any(thread["type"] == "faction" for thread in bundle["story_threads"])


def test_runtime_settings_endpoint_round_trips_campaign_settings() -> None:
    bootstrap = client.post(
        "/campaign/bootstrap",
        json={
            "story_name": "Runtime Endpoint Campaign",
            "setting": "A flooded archive district",
            "genre_vibe": "Urban fantasy intrigue",
            "player_character": {
                "name": "Nera Vale",
                "concept": "A courier with a dangerous memory for routes.",
            },
        },
    )
    campaign_id = bootstrap.json()["campaign_id"]

    saved = client.post(
        "/play/runtime-settings",
        json={
            "campaign_id": campaign_id,
            "provider": "venice",
            "model": "aion-labs-aion-2-0",
            "include_choices": True,
            "mature_content_enabled": True,
            "notes": "Keep consequences intimate.",
        },
    )
    loaded = client.get(f"/play/runtime-settings?campaign_id={campaign_id}")

    assert saved.status_code == 200
    assert loaded.status_code == 200
    assert loaded.json() == {
        "provider": "venice",
        "model": "aion-labs-aion-2-0",
        "include_choices": True,
        "mature_content_enabled": True,
        "notes": "Keep consequences intimate.",
    }


def test_local_play_mock_provider_persists_history(tmp_path: Path) -> None:
    storage = CampaignStorage(tmp_path / "play-storage")
    bundle = build_campaign_bundle(
        CampaignBootstrapRequest(
            story_name="Local Test Campaign",
            setting="A flooded archive district",
            genre_vibe="Urban fantasy intrigue",
            player_character=PlayerCharacterInput(
                name="Nera Vale",
                concept="A courier with a dangerous memory for routes.",
            ),
        )
    )
    storage.save_bundle(bundle)

    response = generate_local_play_response(
        LocalPlayRequest(
            user_message="I follow the runner.",
            provider="mock",
        ),
        storage,
    )

    assert response.provider == "mock"
    assert response.model == "mock-rpg-model"
    assert response.turn == 1
    assert response.transcript_entries_appended == 2
    saved = storage.load_bundle()
    assert saved.world_state.turn == 1
    assert saved.story_threads[0].last_advanced_turn == 1
    assert len(storage.load_play_history()) == 2


def test_local_play_uses_saved_runtime_settings(tmp_path: Path) -> None:
    storage = CampaignStorage(tmp_path / "runtime-settings-storage")
    bundle = build_campaign_bundle(
        CampaignBootstrapRequest(
            story_name="Runtime Settings Campaign",
            setting="A flooded archive district",
            genre_vibe="Urban fantasy intrigue",
            player_character=PlayerCharacterInput(
                name="Nera Vale",
                concept="A courier with a dangerous memory for routes.",
            ),
        )
    )
    storage.save_bundle(bundle)
    storage.save_runtime_settings(RuntimeSettings(provider="mock", model="saved-mock-model"))

    response = generate_local_play_response(
        LocalPlayRequest(user_message="I check the route ledger."),
        storage,
    )

    assert response.provider == "mock"
    assert response.model == "saved-mock-model"


def test_runtime_settings_are_added_to_runtime_instructions() -> None:
    bundle = build_campaign_bundle(
        CampaignBootstrapRequest(
            story_name="Runtime Prompt Campaign",
            setting="A flooded archive district",
            genre_vibe="Urban fantasy intrigue",
            player_character=PlayerCharacterInput(
                name="Nera Vale",
                concept="A courier with a dangerous memory for routes.",
            ),
        )
    )

    instructions = _build_runtime_instructions(
        bundle,
        runtime_settings=RuntimeSettings(
            mature_content_enabled=True,
            notes="Keep consequences intimate and avoid mechanics notes.",
        ),
    )

    assert "Mature/NSFW material is enabled" in instructions
    assert "OPERATOR RUNTIME NOTES" in instructions
    assert "Keep consequences intimate and avoid mechanics notes." in instructions
    assert "STORY DIRECTOR BRIEF" in instructions
    assert "Story momentum does not require factions" in instructions


def test_story_director_rotates_to_quiet_threads() -> None:
    bundle = build_campaign_bundle(
        CampaignBootstrapRequest(
            story_name="Director Prompt Campaign",
            setting="A flooded archive district",
            genre_vibe="Urban fantasy mystery",
            player_character=PlayerCharacterInput(
                name="Nera Vale",
                concept="A courier with a dangerous memory for routes.",
            ),
        )
    )
    bundle.world_state.turn = 4
    bundle.story_threads[0].last_advanced_turn = 3
    bundle.story_threads[1].last_advanced_turn = 0

    brief = _build_story_director_brief(bundle)

    assert bundle.story_threads[1].title in brief
    assert "bring it onstage now" in brief


def test_session_runtime_settings_can_disable_campaign_boolean_defaults(tmp_path: Path) -> None:
    storage = CampaignStorage(tmp_path / "runtime-fallback-storage")
    bundle = build_campaign_bundle(
        CampaignBootstrapRequest(
            story_name="Runtime Fallback Campaign",
            setting="A flooded archive district",
            genre_vibe="Urban fantasy intrigue",
            player_character=PlayerCharacterInput(
                name="Nera Vale",
                concept="A courier with a dangerous memory for routes.",
            ),
        )
    )
    campaign_storage = storage.for_campaign(bundle.world_state.campaign_id)
    campaign_storage.save_bundle(bundle)
    campaign_storage.save_runtime_settings(RuntimeSettings(mature_content_enabled=True))
    session_storage = storage.initialize_session(
        "low-key",
        campaign_id=bundle.world_state.campaign_id,
        source_storage=campaign_storage,
    )
    session_storage.save_runtime_settings(RuntimeSettings(mature_content_enabled=False))
    session_summary = session_storage.load_session_summary()

    runtime_settings = _resolve_runtime_settings(session_storage, storage, session_summary)

    assert runtime_settings.mature_content_enabled is False


def test_structured_play_response_updates_saved_bundle(tmp_path: Path) -> None:
    class FakeResponse:
        status_code = 200

        def json(self) -> dict[str, str]:
            return {
                "output_text": (
                    "{"
                    '"reply":"_Mira points to the rainlit quay._\\n\\n[OOC: World pressure increases.]",'
                    '"state_updates":{"current_scene":"Mira reveals the quay lead.","location":"Red Veil","time_of_day":"night","world_pressure":3,"pressure_clock":2,"notes_append":["Mira trusts the PC with the quay lead."]},'
                    '"timeline_entries":["Mira revealed the quay lead."],'
                    '"recap_delta":"The investigation now points toward the quay.",'
                    '"quest_updates":[{"title":"Find the quay witness","status":"open","summary":"Locate the person Mira saw near the quay.","source_faction":"Mira"}],'
                    '"story_thread_updates":[{"title":"Central Pressure","status":"active","tension":4,"summary":"The quay lead is now the active line of pressure.","current_beat":"Mira gave the quay lead.","next_beat":"Show what makes the quay dangerous.","unresolved_question":"Who else knows about the witness?"}],'
                    '"event_queue_updates":{"add":["A watcher crosses the quay."],"remove":[]},'
                    '"npc_memory_notes":["Mira risked herself to give the lead."]'
                    "}"
                )
            }

    class FakeClient:
        def post(self, *_args: object, **_kwargs: object) -> FakeResponse:
            return FakeResponse()

    storage = CampaignStorage(tmp_path / "structured-play-storage")
    bundle = build_campaign_bundle(
        CampaignBootstrapRequest(
            story_name="Structured Play Campaign",
            setting="A rainlit dock district",
            genre_vibe="Noir fantasy",
            player_character=PlayerCharacterInput(
                name="Liora Vale",
                concept="An oath-broker tracking a missing courier.",
            ),
        )
    )
    storage.save_bundle(bundle)

    response = generate_local_play_response(
        LocalPlayRequest(user_message="I ask Mira for the truth."),
        storage,
        client=FakeClient(),
    )
    saved = storage.load_bundle()

    assert response.reply == "_Mira points to the rainlit quay._"
    assert saved.world_state.current_scene == "Mira reveals the quay lead."
    assert saved.world_state.location == "Red Veil"
    assert saved.world_state.world_pressure == 3
    assert "Turn 1: Mira revealed the quay lead." in saved.timeline
    assert "Turn 1: The investigation now points toward the quay." in saved.recap
    assert "A watcher crosses the quay." in saved.event_queue
    assert any(quest.title == "Find the quay witness" for quest in saved.quests)
    assert saved.story_threads[0].tension == 4
    assert saved.story_threads[0].last_advanced_turn == 1
    assert saved.story_threads[0].next_beat == "Show what makes the quay dangerous."
    assert any("Mira trusts the PC" in note for note in saved.world_state.notes)


def test_plain_model_response_gets_structured_repair(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0

    def fake_generate_model_text(_request: object) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse(
                text="_Mira points toward the rainlit quay._",
                provider="venice",
                model="aion-labs-aion-2-0",
            )
        return ModelResponse(
            text=(
                "{"
                '"reply":"_Mira points toward the rainlit quay._",'
                '"state_updates":{"current_scene":"Mira names the quay as the next lead.","location":null,"time_of_day":null,"world_pressure":null,"pressure_clock":null,"notes_append":[]},'
                '"timeline_entries":["Mira named the quay as the next lead."],'
                '"recap_delta":null,'
                '"quest_updates":[],'
                '"event_queue_updates":{"add":[],"remove":[]},'
                '"npc_memory_notes":[]'
                "}"
            ),
            provider="venice",
            model="aion-labs-aion-2-0",
        )

    import backend.app.services.local_play as local_play

    monkeypatch.setattr(local_play, "generate_model_text", fake_generate_model_text)
    storage = CampaignStorage(tmp_path / "structured-repair-storage")
    bundle = build_campaign_bundle(
        CampaignBootstrapRequest(
            story_name="Structured Repair Campaign",
            setting="A rainlit dock district",
            genre_vibe="Noir fantasy",
            player_character=PlayerCharacterInput(
                name="Liora Vale",
                concept="An oath-broker tracking a missing courier.",
            ),
        )
    )
    storage.save_bundle(bundle)

    response = generate_local_play_response(
        LocalPlayRequest(user_message="I ask Mira for the truth.", provider="venice"),
        storage,
    )
    saved = storage.load_bundle()

    assert calls == 2
    assert response.reply == "_Mira points toward the rainlit quay._"
    assert saved.world_state.current_scene == "Mira names the quay as the next lead."
    assert "Turn 1: Mira named the quay as the next lead." in saved.timeline


def test_new_campaign_session_starts_from_campaign_bundle(tmp_path: Path) -> None:
    storage = CampaignStorage(tmp_path / "campaign-session-storage")
    bundle = build_campaign_bundle(
        CampaignBootstrapRequest(
            story_name="Campaign Session Source",
            setting="A silver canal city",
            genre_vibe="Noir fantasy",
            player_character=PlayerCharacterInput(
                name="Liora Vale",
                concept="An oath-broker tracking a missing courier.",
            ),
        )
    )
    campaign_storage = storage.for_campaign(bundle.world_state.campaign_id)
    campaign_storage.save_bundle(bundle)

    response = generate_local_play_response(
        LocalPlayRequest(
            campaign_id=bundle.world_state.campaign_id,
            session_id="main",
            user_message="I start at the canal bridge.",
            provider="mock",
        ),
        storage,
    )
    session_bundle = storage.resolve_session_storage("main", bundle.world_state.campaign_id).load_bundle()

    assert response.campaign_id == bundle.world_state.campaign_id
    assert session_bundle.scenario.title == "Campaign Session Source"
    assert session_bundle.world_state.location == "A silver canal city"


def test_ooc_play_turn_uses_local_ack_without_model_call(tmp_path: Path) -> None:
    storage = CampaignStorage(tmp_path / "ooc-storage")
    bundle = build_campaign_bundle(
        CampaignBootstrapRequest(
            story_name="OOC Test Campaign",
            setting="A rainlit archive district",
            genre_vibe="Urban fantasy intrigue",
            player_character=PlayerCharacterInput(
                name="Nera Vale",
                concept="A courier with a dangerous memory for routes.",
            ),
        )
    )
    storage.save_bundle(bundle)

    response = generate_local_play_response(
        LocalPlayRequest(
            user_message="OOC: Mature content can be enabled when natural to the story.",
            provider="venice",
        ),
        storage,
    )

    assert response.provider == "local"
    assert response.model == "ooc-ack"
    assert response.turn == 1
    assert "saved campaign facts unchanged" in response.reply
    assert storage.load_world_state().turn == 1
    assert len(storage.load_play_history()) == 2


def test_hidden_planning_detector_flags_model_meta_text() -> None:
    assert _looks_like_hidden_planning(
        "Okay, I'm going to write a response to the user's prompt and end with a choice."
    )
    assert _looks_like_hidden_planning("I will write the response prose here.")
    assert not _looks_like_hidden_planning(
        '_Mira lowers her voice._ **Mira:** "The Court has been watching the room."'
    )


def test_player_facing_reply_strips_ooc_mechanics_notes() -> None:
    assert (
        _clean_player_facing_reply("_Mira points to the rainlit quay._\n\n[OOC: World pressure increases.]")
        == "_Mira points to the rainlit quay._"
    )
