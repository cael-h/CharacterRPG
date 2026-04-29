from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.models.bootstrap import CampaignBootstrapRequest, PlayerCharacterInput
from backend.app.models.play import LocalPlayRequest
from backend.app.services.campaign_bootstrap import build_campaign_bundle
from backend.app.services.campaign_storage import CampaignStorage
from backend.app.services.local_play import generate_local_play_response


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


def test_provider_listing_includes_mock_and_ollama() -> None:
    response = client.get("/providers")
    payload = response.json()

    assert response.status_code == 200
    providers = {item["provider"] for item in payload["providers"]}
    assert "mock" in providers
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
