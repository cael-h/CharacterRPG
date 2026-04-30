import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import config
from backend.app.main import app
from backend.app.models.bootstrap import CampaignBootstrapRequest, PlayerCharacterInput
from backend.app.models.play import LocalPlayRequest
from backend.app.models.setup import CampaignSetupRequest
from backend.app.services.campaign_bootstrap import build_campaign_bundle
from backend.app.services.campaign_storage import CampaignStorage
from backend.app.services.local_play import _looks_like_hidden_planning, generate_local_play_response
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
    assert len(payload["files_written"]) == 9

    bundle_response = client.get("/campaign/bundle", params={"campaign_id": "ash-market-signals"})
    bundle = bundle_response.json()
    assert bundle_response.status_code == 200
    assert bundle["scenario"]["title"] == "Ash Market Signals"
    assert bundle["world_state"]["campaign_id"] == "ash-market-signals"


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
    assert storage.load_world_state().turn == 1
    assert len(storage.load_play_history()) == 2


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
    assert not _looks_like_hidden_planning(
        '_Mira lowers her voice._ **Mira:** "The Court has been watching the room."'
    )
