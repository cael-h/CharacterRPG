from __future__ import annotations

import json
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path

import yaml

from backend.app.model_utils import model_dump, model_validate
from backend.app.models.bootstrap import CampaignBundle
from backend.app.models.character import CharacterProfile
from backend.app.models.faction import FactionState
from backend.app.models.play import (
    PlayCampaignSummary,
    PlaySessionSummary,
    PlayTranscriptEntry,
    RuntimeSettings,
)
from backend.app.models.quest import QuestState
from backend.app.models.scenario import ScenarioState
from backend.app.models.story import StoryThread
from backend.app.models.transcript_memory import TranscriptMemorySection
from backend.app.models.world_state import WorldState


class CampaignStorage:
    CAMPAIGN_METADATA_FILENAME = 'campaign.json'
    SESSION_METADATA_FILENAME = 'session.json'

    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def normalize_session_id(session_id: str) -> str:
        normalized = re.sub(r'[^a-z0-9_-]+', '-', session_id.strip().lower())
        normalized = normalized.strip('-_')
        if not normalized:
            raise ValueError('session_id must contain at least one letter or number.')
        return normalized

    @classmethod
    def normalize_campaign_id(cls, campaign_id: str) -> str:
        normalized = cls.normalize_session_id(campaign_id)
        if normalized == 'root':
            return 'root'
        return normalized

    @property
    def campaigns_dir(self) -> Path:
        return self.base_dir / 'campaigns'

    @property
    def sessions_dir(self) -> Path:
        return self.base_dir / 'sessions'

    @property
    def campaign_metadata_path(self) -> Path:
        return self.base_dir / self.CAMPAIGN_METADATA_FILENAME

    @property
    def session_metadata_path(self) -> Path:
        return self.base_dir / self.SESSION_METADATA_FILENAME

    @property
    def world_state_path(self) -> Path:
        return self.base_dir / 'world_state.yaml'

    @property
    def timeline_path(self) -> Path:
        return self.base_dir / 'timeline.md'

    @property
    def recap_path(self) -> Path:
        return self.base_dir / 'recap.md'

    @property
    def quests_path(self) -> Path:
        return self.base_dir / 'quests.yaml'

    @property
    def story_threads_path(self) -> Path:
        return self.base_dir / 'story_threads.yaml'

    @property
    def scenario_path(self) -> Path:
        return self.base_dir / 'scenario.yaml'

    @property
    def factions_path(self) -> Path:
        return self.base_dir / 'factions.yaml'

    @property
    def event_queue_path(self) -> Path:
        return self.base_dir / 'event_queue.yaml'

    @property
    def relationship_graph_path(self) -> Path:
        return self.base_dir / 'relationship_graph.yaml'

    @property
    def characters_path(self) -> Path:
        return self.base_dir / 'rpg_characters.yaml'

    @property
    def play_history_path(self) -> Path:
        return self.base_dir / 'play_history.jsonl'

    @property
    def transcript_memory_path(self) -> Path:
        return self.base_dir / 'transcript_memory.json'

    @property
    def runtime_settings_path(self) -> Path:
        return self.base_dir / 'runtime_settings.json'

    @property
    def current_campaign_id(self) -> str:
        if self.base_dir.parent.name == 'campaigns':
            return self.base_dir.name
        if self.base_dir.parent.name == 'sessions' and self.base_dir.parent.parent.name == 'campaigns':
            return self.base_dir.parent.parent.name
        return 'root'

    def has_bundle(self) -> bool:
        return self.world_state_path.exists() or self.scenario_path.exists()

    def for_campaign(self, campaign_id: str) -> 'CampaignStorage':
        normalized = self.normalize_campaign_id(campaign_id)
        if normalized == 'root':
            return self
        return CampaignStorage(self.campaigns_dir / normalized)

    def for_session(self, session_id: str) -> 'CampaignStorage':
        normalized = self.normalize_session_id(session_id)
        return CampaignStorage(self.sessions_dir / normalized)

    def session_exists(self, session_id: str, campaign_id: str | None = None) -> bool:
        try:
            self.resolve_session_storage(session_id, campaign_id)
        except ValueError:
            return False
        return True

    def campaign_exists(self, campaign_id: str) -> bool:
        campaign_storage = self.for_campaign(campaign_id)
        return (
            campaign_storage.has_bundle()
            or campaign_storage.campaign_metadata_path.exists()
            or campaign_storage.sessions_dir.exists()
        )

    def _local_session_summaries(self) -> list[PlaySessionSummary]:
        sessions: list[PlaySessionSummary] = []
        if not self.sessions_dir.exists():
            return sessions
        for path in sorted(self.sessions_dir.iterdir()):
            if not path.is_dir():
                continue
            session_storage = CampaignStorage(path)
            if not session_storage.world_state_path.exists() and not session_storage.session_metadata_path.exists():
                continue
            sessions.append(session_storage.load_session_summary())
        sessions.sort(key=lambda session: session.updated_at, reverse=True)
        return sessions

    def save_world_state(self, world_state: WorldState) -> Path:
        self.world_state_path.write_text(
            yaml.safe_dump(model_dump(world_state), sort_keys=False),
            encoding='utf-8',
        )
        self.save_quests(world_state.active_quests)
        return self.world_state_path

    def load_world_state(self) -> WorldState:
        if not self.world_state_path.exists():
            return WorldState()
        raw_state = yaml.safe_load(self.world_state_path.read_text(encoding='utf-8')) or {}
        state = model_validate(WorldState, raw_state)
        if self.current_campaign_id != 'root':
            state.campaign_id = self.current_campaign_id
        return state

    def append_timeline(self, entry: str) -> Path:
        existing = ''
        if self.timeline_path.exists():
            existing = self.timeline_path.read_text(encoding='utf-8')
            if existing and not existing.endswith('\n'):
                existing += '\n'
        self.timeline_path.write_text(f'{existing}- {entry}\n', encoding='utf-8')
        return self.timeline_path

    def update_recap(self, recap: str) -> Path:
        self.recap_path.write_text(recap.strip() + '\n', encoding='utf-8')
        return self.recap_path

    def save_quests(self, quests: list[QuestState]) -> Path:
        payload = [model_dump(quest) for quest in quests]
        self.quests_path.write_text(
            yaml.safe_dump(payload, sort_keys=False),
            encoding='utf-8',
        )
        return self.quests_path

    def save_story_threads(self, story_threads: list[StoryThread]) -> Path:
        payload = [model_dump(thread) for thread in story_threads]
        self.story_threads_path.write_text(
            yaml.safe_dump(payload, sort_keys=False),
            encoding='utf-8',
        )
        return self.story_threads_path

    def save_scenario(self, scenario: ScenarioState) -> Path:
        self.scenario_path.write_text(
            yaml.safe_dump(model_dump(scenario), sort_keys=False),
            encoding='utf-8',
        )
        return self.scenario_path

    def save_factions(self, factions: list[FactionState]) -> Path:
        payload = {'factions': [model_dump(faction) for faction in factions]}
        self.factions_path.write_text(
            yaml.safe_dump(payload, sort_keys=False),
            encoding='utf-8',
        )
        return self.factions_path

    def save_event_queue(self, event_queue: list[str]) -> Path:
        payload = {'event_queue': event_queue}
        self.event_queue_path.write_text(
            yaml.safe_dump(payload, sort_keys=False),
            encoding='utf-8',
        )
        return self.event_queue_path

    def save_relationship_graph(self, relationship_graph: dict[str, dict[str, str]]) -> Path:
        payload = {'relationship_graph': relationship_graph}
        self.relationship_graph_path.write_text(
            yaml.safe_dump(payload, sort_keys=False),
            encoding='utf-8',
        )
        return self.relationship_graph_path

    def save_characters(self, characters: list[CharacterProfile]) -> Path:
        payload = {'characters': [model_dump(character) for character in characters]}
        self.characters_path.write_text(
            yaml.safe_dump(payload, sort_keys=False),
            encoding='utf-8',
        )
        return self.characters_path

    def save_play_history(self, entries: list[PlayTranscriptEntry]) -> Path:
        payload = '\n'.join(json.dumps(model_dump(entry), ensure_ascii=True) for entry in entries).strip()
        if payload:
            payload += '\n'
        self.play_history_path.write_text(payload, encoding='utf-8')
        return self.play_history_path

    def append_play_history(self, entries: list[PlayTranscriptEntry]) -> Path:
        existing_entries = self.load_play_history()
        return self.save_play_history(existing_entries + entries)

    def load_play_history(self, limit: int | None = None) -> list[PlayTranscriptEntry]:
        if not self.play_history_path.exists():
            return []
        entries = [
            model_validate(PlayTranscriptEntry, json.loads(line))
            for line in self.play_history_path.read_text(encoding='utf-8').splitlines()
            if line.strip()
        ]
        if limit is None or limit >= len(entries):
            return entries
        return entries[-limit:]

    def save_transcript_memory(self, sections: list[TranscriptMemorySection]) -> Path:
        payload = [model_dump(section) for section in sections]
        self.transcript_memory_path.write_text(
            json.dumps(payload, ensure_ascii=True, indent=2) + '\n',
            encoding='utf-8',
        )
        return self.transcript_memory_path

    def load_transcript_memory(self) -> list[TranscriptMemorySection]:
        if not self.transcript_memory_path.exists():
            return []
        payload = json.loads(self.transcript_memory_path.read_text(encoding='utf-8'))
        sections = [model_validate(TranscriptMemorySection, item) for item in payload]
        campaign_id = self.current_campaign_id
        for section in sections:
            if not section.campaign_id:
                section.campaign_id = campaign_id
        return sections

    def save_runtime_settings(self, runtime_settings: RuntimeSettings) -> Path:
        self.runtime_settings_path.write_text(
            json.dumps(model_dump(runtime_settings), ensure_ascii=True, indent=2) + '\n',
            encoding='utf-8',
        )
        return self.runtime_settings_path

    def load_runtime_settings(self) -> RuntimeSettings:
        if not self.runtime_settings_path.exists():
            return RuntimeSettings()
        payload = json.loads(self.runtime_settings_path.read_text(encoding='utf-8'))
        return model_validate(RuntimeSettings, payload)

    def load_bundle(self) -> CampaignBundle:
        world_state = self.load_world_state()
        scenario = ScenarioState(
            title='Uninitialized Campaign',
            premise='No scenario has been created yet.',
            setting=world_state.location,
            genre_vibe='Unspecified',
            tone='Neutral',
            opening_hook=world_state.current_scene,
        )
        if self.scenario_path.exists():
            raw_scenario = yaml.safe_load(self.scenario_path.read_text(encoding='utf-8')) or {}
            scenario = model_validate(ScenarioState, raw_scenario)

        factions = world_state.factions
        if self.factions_path.exists():
            raw_factions = yaml.safe_load(self.factions_path.read_text(encoding='utf-8')) or {}
            factions = [
                model_validate(FactionState, payload) for payload in raw_factions.get('factions', [])
            ]

        event_queue = list(world_state.pending_events)
        if self.event_queue_path.exists():
            raw_events = yaml.safe_load(self.event_queue_path.read_text(encoding='utf-8')) or {}
            event_queue = list(raw_events.get('event_queue', []))

        relationship_graph: dict[str, dict[str, str]] = {}
        if self.relationship_graph_path.exists():
            raw_graph = yaml.safe_load(self.relationship_graph_path.read_text(encoding='utf-8')) or {}
            relationship_graph = dict(raw_graph.get('relationship_graph', {}))

        rpg_characters: list[CharacterProfile] = []
        if self.characters_path.exists():
            raw_characters = yaml.safe_load(self.characters_path.read_text(encoding='utf-8')) or {}
            rpg_characters = [
                model_validate(CharacterProfile, payload)
                for payload in raw_characters.get('characters', [])
            ]

        timeline = []
        if self.timeline_path.exists():
            timeline = [
                line.removeprefix('- ').strip()
                for line in self.timeline_path.read_text(encoding='utf-8').splitlines()
                if line.strip()
            ]

        recap = ''
        if self.recap_path.exists():
            recap = self.recap_path.read_text(encoding='utf-8').strip()

        quests = list(world_state.active_quests)
        if self.quests_path.exists():
            raw_quests = yaml.safe_load(self.quests_path.read_text(encoding='utf-8')) or []
            quests = [model_validate(QuestState, payload) for payload in raw_quests]

        story_threads: list[StoryThread] = []
        if self.story_threads_path.exists():
            raw_story_threads = yaml.safe_load(self.story_threads_path.read_text(encoding='utf-8')) or []
            story_threads = [model_validate(StoryThread, payload) for payload in raw_story_threads]

        world_state.factions = factions
        world_state.active_quests = quests
        world_state.pending_events = event_queue
        return CampaignBundle(
            world_state=world_state,
            scenario=scenario,
            factions=factions,
            event_queue=event_queue,
            relationship_graph=relationship_graph,
            rpg_characters=rpg_characters,
            quests=quests,
            story_threads=story_threads,
            timeline=timeline,
            recap=recap,
        )

    def save_bundle(self, bundle: CampaignBundle) -> list[str]:
        bundle.world_state.factions = bundle.factions
        bundle.world_state.active_quests = bundle.quests
        bundle.world_state.pending_events = bundle.event_queue
        if self.current_campaign_id != 'root':
            bundle.world_state.campaign_id = self.current_campaign_id

        self.save_world_state(bundle.world_state)
        self.save_scenario(bundle.scenario)
        self.save_factions(bundle.factions)
        self.save_event_queue(bundle.event_queue)
        self.save_relationship_graph(bundle.relationship_graph)
        self.save_characters(bundle.rpg_characters)
        self.save_quests(bundle.quests)
        self.save_story_threads(bundle.story_threads)
        timeline_text = '\n'.join(f'- {entry}' for entry in bundle.timeline).strip()
        self.timeline_path.write_text(timeline_text + ('\n' if timeline_text else ''), encoding='utf-8')
        self.update_recap(bundle.recap)
        return [
            str(self.world_state_path),
            str(self.scenario_path),
            str(self.factions_path),
            str(self.event_queue_path),
            str(self.relationship_graph_path),
            str(self.characters_path),
            str(self.quests_path),
            str(self.story_threads_path),
            str(self.timeline_path),
            str(self.recap_path),
        ]

    def save_campaign_summary(self, summary: PlayCampaignSummary) -> Path:
        self.campaign_metadata_path.write_text(
            json.dumps(model_dump(summary), ensure_ascii=True, indent=2) + '\n',
            encoding='utf-8',
        )
        return self.campaign_metadata_path

    def load_campaign_summary(self) -> PlayCampaignSummary:
        if self.campaign_metadata_path.exists():
            payload = json.loads(self.campaign_metadata_path.read_text(encoding='utf-8'))
            summary = model_validate(PlayCampaignSummary, payload)
            summary.session_count = len(self._local_session_summaries())
            return summary

        campaign_id = self.current_campaign_id
        title = campaign_id
        if self.scenario_path.exists():
            title = self.load_bundle().scenario.title
        session_count = len(self._local_session_summaries())
        created_at = datetime.now(UTC).isoformat()
        updated_at = created_at
        candidate_paths = [path for path in [self.world_state_path, self.scenario_path, self.sessions_dir] if path.exists()]
        if candidate_paths:
            created_at = min(
                datetime.fromtimestamp(path.stat().st_ctime, UTC).isoformat() for path in candidate_paths
            )
            updated_at = max(
                datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat() for path in candidate_paths
            )
        return PlayCampaignSummary(
            campaign_id=campaign_id,
            title=title,
            storage_dir=str(self.base_dir),
            session_count=session_count,
            created_at=created_at,
            updated_at=updated_at,
        )

    def touch_campaign_summary(self, *, title: str | None = None) -> PlayCampaignSummary:
        summary = self.load_campaign_summary()
        summary.campaign_id = self.current_campaign_id
        summary.title = title or summary.title
        summary.storage_dir = str(self.base_dir)
        summary.session_count = len(self._local_session_summaries())
        now = datetime.now(UTC).isoformat()
        summary.updated_at = now
        if not self.campaign_metadata_path.exists():
            summary.created_at = now
        self.save_campaign_summary(summary)
        return summary

    def save_session_summary(self, summary: PlaySessionSummary) -> Path:
        self.session_metadata_path.write_text(
            json.dumps(model_dump(summary), ensure_ascii=True, indent=2) + '\n',
            encoding='utf-8',
        )
        return self.session_metadata_path

    def load_session_summary(self) -> PlaySessionSummary:
        if self.session_metadata_path.exists():
            payload = json.loads(self.session_metadata_path.read_text(encoding='utf-8'))
            summary = model_validate(PlaySessionSummary, payload)
            summary.campaign_id = summary.campaign_id or self.current_campaign_id
            return summary

        session_id = self.base_dir.name
        turn = self.load_world_state().turn if self.world_state_path.exists() else 0
        transcript_entries = len(self.load_play_history())
        created_at = datetime.now(UTC).isoformat()
        updated_at = created_at
        if self.world_state_path.exists():
            stat = self.world_state_path.stat()
            created_at = datetime.fromtimestamp(stat.st_ctime, UTC).isoformat()
            updated_at = datetime.fromtimestamp(stat.st_mtime, UTC).isoformat()
        return PlaySessionSummary(
            campaign_id=self.current_campaign_id,
            session_id=session_id,
            storage_dir=str(self.base_dir),
            turn=turn,
            transcript_entries=transcript_entries,
            created_at=created_at,
            updated_at=updated_at,
        )

    def list_campaigns(self) -> list[PlayCampaignSummary]:
        campaigns: list[PlayCampaignSummary] = []
        if not self.campaigns_dir.exists():
            return campaigns
        for path in sorted(self.campaigns_dir.iterdir()):
            if not path.is_dir():
                continue
            campaign_storage = CampaignStorage(path)
            if (
                not campaign_storage.has_bundle()
                and not campaign_storage.campaign_metadata_path.exists()
                and not campaign_storage.sessions_dir.exists()
            ):
                continue
            campaigns.append(campaign_storage.load_campaign_summary())
        campaigns.sort(key=lambda campaign: campaign.updated_at, reverse=True)
        return campaigns

    def list_sessions(self, campaign_id: str | None = None) -> list[PlaySessionSummary]:
        if campaign_id:
            return self.for_campaign(campaign_id)._local_session_summaries()

        sessions = self._local_session_summaries()
        for campaign in self.list_campaigns():
            sessions.extend(self.for_campaign(campaign.campaign_id)._local_session_summaries())
        sessions.sort(key=lambda session: session.updated_at, reverse=True)
        return sessions

    def resolve_session_storage(self, session_id: str, campaign_id: str | None = None) -> 'CampaignStorage':
        normalized_session_id = self.normalize_session_id(session_id)
        if campaign_id:
            normalized_campaign_id = self.normalize_campaign_id(campaign_id)
            candidate = self.for_campaign(normalized_campaign_id).for_session(normalized_session_id)
            if not candidate.world_state_path.exists() and not candidate.session_metadata_path.exists():
                raise ValueError(
                    f'Session {normalized_session_id!r} does not exist in campaign {normalized_campaign_id!r}.'
                )
            return candidate

        candidates: list[CampaignStorage] = []
        root_candidate = self.for_session(normalized_session_id)
        if root_candidate.world_state_path.exists() or root_candidate.session_metadata_path.exists():
            candidates.append(root_candidate)

        for campaign in self.list_campaigns():
            candidate = self.for_campaign(campaign.campaign_id).for_session(normalized_session_id)
            if candidate.world_state_path.exists() or candidate.session_metadata_path.exists():
                candidates.append(candidate)

        if not candidates:
            raise ValueError(f'Session {normalized_session_id!r} does not exist.')
        if len(candidates) > 1:
            campaign_ids = sorted({candidate.current_campaign_id for candidate in candidates})
            raise ValueError(
                f'Session {normalized_session_id!r} exists in multiple campaigns: {", ".join(campaign_ids)}. Provide campaign_id.'
            )
        return candidates[0]

    def initialize_campaign(
        self,
        campaign_id: str,
        *,
        title: str | None = None,
        source_storage: 'CampaignStorage | None' = None,
    ) -> 'CampaignStorage':
        normalized_campaign_id = self.normalize_campaign_id(campaign_id)
        campaign_storage = self.for_campaign(normalized_campaign_id)
        if campaign_storage.has_bundle():
            campaign_storage.touch_campaign_summary(title=title)
            return campaign_storage

        source = source_storage or self
        if source.has_bundle():
            bundle = source.load_bundle()
            bundle.world_state.campaign_id = normalized_campaign_id
            campaign_storage.save_bundle(bundle)
            campaign_storage.touch_campaign_summary(title=title or bundle.scenario.title)
        else:
            campaign_storage.touch_campaign_summary(title=title or campaign_storage.base_dir.name)
        return campaign_storage

    def initialize_session(
        self,
        session_id: str,
        *,
        campaign_id: str | None = None,
        title: str | None = None,
        source_storage: 'CampaignStorage | None' = None,
        parent_session_id: str | None = None,
        fork_from_turn: int | None = None,
    ) -> 'CampaignStorage':
        resolved_campaign_id = self.normalize_campaign_id(campaign_id) if campaign_id else None
        session_parent_storage = self.for_campaign(resolved_campaign_id) if resolved_campaign_id and resolved_campaign_id != 'root' else self
        session_storage = session_parent_storage.for_session(session_id)
        if session_storage.world_state_path.exists():
            return session_storage

        source = source_storage or session_parent_storage
        if resolved_campaign_id and resolved_campaign_id != 'root':
            self.initialize_campaign(resolved_campaign_id, title=title, source_storage=source)
            if source_storage is None:
                source = self.for_campaign(resolved_campaign_id)

        bundle = source.load_bundle()
        history = source.load_play_history()
        effective_fork_turn = fork_from_turn
        if resolved_campaign_id:
            bundle.world_state.campaign_id = resolved_campaign_id
        if effective_fork_turn is not None:
            history = [entry for entry in history if entry.turn <= effective_fork_turn]
            bundle.world_state.turn = min(bundle.world_state.turn, effective_fork_turn)
            branch_note = (
                f'Session fork created from {parent_session_id or source.base_dir.name} at turn {effective_fork_turn}.'
            )
            if branch_note not in bundle.world_state.notes:
                bundle.world_state.notes.append(branch_note)
            bundle.timeline.append(branch_note)

        session_storage.save_bundle(bundle)
        session_storage.save_play_history(history)

        now = datetime.now(UTC).isoformat()
        summary = PlaySessionSummary(
            campaign_id=resolved_campaign_id or source.current_campaign_id,
            session_id=session_storage.base_dir.name,
            title=title or bundle.scenario.title,
            parent_session_id=parent_session_id,
            fork_from_turn=effective_fork_turn,
            storage_dir=str(session_storage.base_dir),
            turn=bundle.world_state.turn,
            transcript_entries=len(history),
            created_at=now,
            updated_at=now,
        )
        session_storage.save_session_summary(summary)
        if resolved_campaign_id and resolved_campaign_id != 'root':
            self.for_campaign(resolved_campaign_id).touch_campaign_summary(title=title or bundle.scenario.title)
        return session_storage

    def touch_session_summary(
        self,
        *,
        campaign_id: str | None = None,
        title: str | None = None,
        parent_session_id: str | None = None,
        fork_from_turn: int | None = None,
    ) -> PlaySessionSummary:
        summary = self.load_session_summary()
        summary.campaign_id = campaign_id or summary.campaign_id or self.current_campaign_id
        summary.title = title or summary.title
        summary.parent_session_id = parent_session_id or summary.parent_session_id
        summary.fork_from_turn = fork_from_turn if fork_from_turn is not None else summary.fork_from_turn
        summary.turn = self.load_world_state().turn if self.world_state_path.exists() else summary.turn
        summary.transcript_entries = len(self.load_play_history())
        summary.storage_dir = str(self.base_dir)
        now = datetime.now(UTC).isoformat()
        summary.updated_at = now
        if not self.session_metadata_path.exists():
            summary.created_at = now
        self.save_session_summary(summary)
        if summary.campaign_id and summary.campaign_id != 'root' and self.base_dir.parent.parent.name == 'campaigns':
            CampaignStorage(self.base_dir.parent.parent.parent).for_campaign(summary.campaign_id).touch_campaign_summary()
        return summary

    def backup_root_state(self, label: str | None = None) -> Path:
        stamp = datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')
        target = self.base_dir / '_root_backups' / f'{stamp}-{label or "backup"}'
        target.mkdir(parents=True, exist_ok=True)
        backup_names = [
            'world_state.yaml',
            'scenario.yaml',
            'factions.yaml',
            'event_queue.yaml',
            'relationship_graph.yaml',
            'rpg_characters.yaml',
            'quests.yaml',
            'story_threads.yaml',
            'timeline.md',
            'recap.md',
            'play_history.jsonl',
            'transcript_memory.json',
            'runtime_settings.json',
            'campaign.json',
            'session.json',
        ]
        for name in backup_names:
            source = self.base_dir / name
            if source.exists():
                shutil.copy2(source, target / name)
        return target
