# Gemini UI Design Review Prompt

Please review the UI/UX design of this React app.

Context:
- This is CharacterRPG, a local web UI for creating and playing AI-driven RPG campaigns.
- Left sidebar: campaigns and sessions.
- Main center area: active campaign scene, transcript, player composer.
- Right inspector: backend settings, model/provider controls, story threads, setup assistant, draft fields, review output.
- Target use: repeated long-form play sessions, campaign setup, switching branches/sessions, inspecting story continuity.
- Design goal: pragmatic, readable, immersive enough for RPG play, but still operational and efficient.

Please review for:
1. Visual hierarchy
2. Information density
3. Layout ergonomics
4. Mobile/responsive behavior
5. Whether the right inspector is overloaded
6. Whether the setup flow is understandable
7. Whether the story threads panel is placed well
8. Color, spacing, typography, and interaction polish
9. Concrete changes you would recommend before user testing

Important:
- Do not focus on backend architecture.
- Focus on design and frontend UX.
- Prefer concrete, prioritized recommendations over general praise.

## web/src/App.tsx

```tsx
import {
  Activity,
  BookOpen,
  Boxes,
  CheckCircle2,
  GitBranch,
  ListChecks,
  MessageSquareText,
  RefreshCw,
  Send,
  Server,
  Settings2,
  Wand2,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type ProviderDescriptor = {
  provider: string;
  default_model: string;
  configured: boolean;
  notes: string;
};

type ProvidersResponse = {
  default_provider: string;
  default_model: string;
  providers: ProviderDescriptor[];
};

type CampaignSummary = {
  campaign_id: string;
  title?: string | null;
  session_count: number;
  updated_at: string;
};

type SessionSummary = {
  campaign_id: string;
  session_id: string;
  title?: string | null;
  turn: number;
  transcript_entries: number;
  updated_at: string;
};

type TranscriptEntry = {
  role: 'user' | 'assistant';
  content: string;
  turn: number;
  recorded_at: string;
};

type CampaignBundle = {
  world_state: {
    turn: number;
    current_scene: string;
    location: string;
    world_pressure: number;
    pressure_clock: number;
    notes: string[];
  };
  scenario: {
    title: string;
    premise: string;
    opening_hook: string;
    genre_vibe: string;
    tone: string;
  };
  event_queue: string[];
  story_threads: StoryThread[];
  timeline: string[];
  recap: string;
};

type StoryThread = {
  thread_id: string;
  type: string;
  title: string;
  status: string;
  tension: number;
  summary: string;
  current_beat: string;
  next_beat: string;
  unresolved_question?: string | null;
  last_advanced_turn: number;
};

type SetupChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type PlayerCharacterDraft = {
  name?: string | null;
  concept?: string | null;
  goals: string[];
  edges: string[];
  complications: string[];
};

type CampaignDraft = {
  story_name?: string | null;
  preset_name?: string | null;
  setting?: string | null;
  genre_vibe?: string | null;
  tone?: string | null;
  themes: string[];
  context_summary?: string | null;
  play_preferences: string[];
  lore_text?: string | null;
  lore_paths: string[];
  allow_inference: boolean;
  player_character: PlayerCharacterDraft;
};

type CampaignSetupResponse = {
  assistant_reply: string;
  draft: CampaignDraft;
  ready_to_bootstrap: boolean;
  missing_fields: string[];
  lore_sources: string[];
};

type SetupReviewFinding = {
  severity: 'info' | 'warning' | 'critical';
  field: string;
  message: string;
};

type SetupReviewResponse = {
  ready_to_bootstrap: boolean;
  missing_fields: string[];
  campaign_id?: string | null;
  summary?: {
    title: string;
    premise: string;
    opening_hook: string;
    starter_quests: string[];
    inferred_fields: string[];
    lore_sources: string[];
  } | null;
  findings: SetupReviewFinding[];
  lore_sources: string[];
};

type RuntimeSettings = {
  provider?: string | null;
  model?: string | null;
  include_choices: boolean;
  mature_content_enabled: boolean;
  notes?: string | null;
};

type Toast = { tone: 'info' | 'error' | 'success'; message: string } | null;

const API_BASE = 'http://127.0.0.1:4100';

const maturePreference =
  'Mature/NSFW material is allowed when it naturally follows from an adult story, but do not force it or make it the point of play.';

const initialSetupDraft: CampaignDraft = {
  story_name: 'Red Lantern Ledger',
  setting: 'Sable Harbor, a rain-soaked occult port city where contracts can bind memories, debts, and desire.',
  genre_vibe: 'Adult noir fantasy investigation',
  tone: 'Lush, tense, grounded, player-led, not coy about mature implications but never gratuitous.',
  themes: ['debt', 'consent', 'betrayal', 'hidden magic'],
  context_summary: '',
  play_preferences: [
    maturePreference,
    'Keep player agency intact; do not decide the player character feelings or actions.',
    'No sexual content involving minors and no sexual violence.',
  ],
  lore_text: '',
  lore_paths: [],
  allow_inference: true,
  player_character: {
    name: 'Liora Vance',
    concept: 'An adult disgraced oath-broker who can hear lies as a second voice.',
    goals: ['Find the missing courier Cassian Vey', 'Recover the stolen Red Lantern ledger'],
    edges: ['Reads contractual magic', 'Knows criminal etiquette'],
    complications: ['The Harbor Court still owns one year of her future'],
  },
};

const initialSetupPrompt =
  'Shape this into a campaign draft. I want a tense occult noir investigation with adult stakes, strong continuity, and a first scene that gives me a meaningful lead.';

const listToText = (items: string[] | undefined) => (items || []).join('\n');

const textToList = (value: string) =>
  value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeDraft = (draft: Partial<CampaignDraft> | undefined): CampaignDraft => ({
  ...initialSetupDraft,
  ...(draft || {}),
  themes: draft?.themes || [],
  play_preferences: draft?.play_preferences || [],
  lore_paths: draft?.lore_paths || [],
  allow_inference: draft?.allow_inference ?? true,
  player_character: {
    ...initialSetupDraft.player_character,
    ...(draft?.player_character || {}),
    goals: draft?.player_character?.goals || [],
    edges: draft?.player_character?.edges || [],
    complications: draft?.player_character?.complications || [],
  },
});

function App() {
  const [apiBase, setApiBase] = useState(API_BASE);
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<string>('');
  const [selectedSession, setSelectedSession] = useState<string>('main');
  const [bundle, setBundle] = useState<CampaignBundle | null>(null);
  const [history, setHistory] = useState<TranscriptEntry[]>([]);
  const [turnText, setTurnText] = useState('');
  const [sessionTitle, setSessionTitle] = useState('Main');
  const [setupDraft, setSetupDraft] = useState<CampaignDraft>(initialSetupDraft);
  const [setupInput, setSetupInput] = useState(initialSetupPrompt);
  const [setupConversation, setSetupConversation] = useState<SetupChatMessage[]>([]);
  const [setupReview, setSetupReview] = useState<SetupReviewResponse | null>(null);
  const [includeChoices, setIncludeChoices] = useState(false);
  const [matureContentEnabled, setMatureContentEnabled] = useState(true);
  const [runtimeNotes, setRuntimeNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  const selectedProviderInfo = useMemo(
    () => providers.find((provider) => provider.provider === selectedProvider),
    [providers, selectedProvider],
  );

  const selectedSessionInfo = useMemo(
    () =>
      sessions.find(
        (session) => session.campaign_id === selectedCampaign && session.session_id === selectedSession,
      ),
    [selectedCampaign, selectedSession, sessions],
  );

  const api = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || payload?.error || `Request failed ${response.status}`);
      }
      return response.json() as Promise<T>;
    },
    [apiBase],
  );

  const refreshCatalog = useCallback(async () => {
    const [providerPayload, campaignPayload, sessionPayload] = await Promise.all([
      api<ProvidersResponse>('/providers'),
      api<CampaignSummary[]>('/play/campaigns'),
      api<SessionSummary[]>('/play/sessions'),
    ]);
    setProviders(providerPayload.providers);
    const defaultProvider = providerPayload.default_provider;
    const providerDefaultModel =
      providerPayload.providers.find((provider) => provider.provider === defaultProvider)?.default_model ||
      providerPayload.default_model;
    setSelectedProvider((current) => current || defaultProvider);
    setSelectedModel((current) => current || providerDefaultModel);
    setCampaigns(campaignPayload);
    setSessions(sessionPayload);
    if (!selectedCampaign && campaignPayload[0]?.campaign_id) {
      setSelectedCampaign(campaignPayload[0].campaign_id);
    }
  }, [api, selectedCampaign]);

  const refreshActive = useCallback(async () => {
    if (!selectedCampaign) return;
    const query = new URLSearchParams({ campaign_id: selectedCampaign });
    const campaignQuery = query.toString();
    if (selectedSession) query.set('session_id', selectedSession);
    const sessionQuery = query.toString();
    let bundlePayload: CampaignBundle;
    let historyPayload: TranscriptEntry[] = [];
    try {
      [bundlePayload, historyPayload] = await Promise.all([
        api<CampaignBundle>(`/campaign/bundle?${sessionQuery}`),
        api<TranscriptEntry[]>(`/play/history?limit=40&${sessionQuery}`),
      ]);
    } catch {
      bundlePayload = await api<CampaignBundle>(`/campaign/bundle?${campaignQuery}`);
    }
    setBundle(bundlePayload);
    setHistory(historyPayload);
  }, [api, selectedCampaign, selectedSession]);

  useEffect(() => {
    refreshCatalog().catch((error: Error) => setToast({ tone: 'error', message: error.message }));
  }, [refreshCatalog]);

  useEffect(() => {
    refreshActive().catch(() => {
      setBundle(null);
      setHistory([]);
    });
  }, [refreshActive]);

  useEffect(() => {
    if (!selectedCampaign) return;
    const query = new URLSearchParams({ campaign_id: selectedCampaign });
    if (selectedSessionInfo) query.set('session_id', selectedSessionInfo.session_id);
    api<RuntimeSettings>(`/play/runtime-settings?${query.toString()}`)
      .then((runtimeSettings) => {
        if (runtimeSettings.provider) setSelectedProvider(runtimeSettings.provider);
        if (runtimeSettings.model) setSelectedModel(runtimeSettings.model);
        setIncludeChoices(runtimeSettings.include_choices);
        setMatureContentEnabled(runtimeSettings.mature_content_enabled);
        setRuntimeNotes(runtimeSettings.notes || '');
      })
      .catch(() => {
        setIncludeChoices(false);
        setMatureContentEnabled(true);
        setRuntimeNotes('');
      });
  }, [api, selectedCampaign, selectedSessionInfo]);

  const updateSetupDraft = (patch: Partial<CampaignDraft>) => {
    setSetupReview(null);
    setSetupDraft((current) => normalizeDraft({ ...current, ...patch }));
  };

  const updatePlayerDraft = (patch: Partial<PlayerCharacterDraft>) => {
    setSetupReview(null);
    setSetupDraft((current) =>
      normalizeDraft({
        ...current,
        player_character: {
          ...current.player_character,
          ...patch,
        },
      }),
    );
  };

  const askSetupAssistant = async (event: FormEvent) => {
    event.preventDefault();
    const content = setupInput.trim();
    if (!content) return;
    setBusy(true);
    setToast(null);
    try {
      const nextConversation: SetupChatMessage[] = [...setupConversation, { role: 'user', content }];
      const payload = await api<CampaignSetupResponse>('/setup/respond', {
        method: 'POST',
        body: JSON.stringify({
          user_message: content,
          conversation: setupConversation,
          draft: setupDraft,
          provider: selectedProvider || undefined,
          model: selectedModel || undefined,
        }),
      });
      setSetupConversation([...nextConversation, { role: 'assistant', content: payload.assistant_reply }]);
      setSetupDraft(normalizeDraft(payload.draft));
      setSetupInput('');
      setSetupReview(null);
      setToast({
        tone: payload.ready_to_bootstrap ? 'success' : 'info',
        message: payload.ready_to_bootstrap
          ? 'Draft is ready for review.'
          : `Draft updated. Missing: ${payload.missing_fields.join(', ') || 'review details'}`,
      });
    } catch (error) {
      setToast({ tone: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const reviewSetupDraft = useCallback(async () => {
    const payload = await api<SetupReviewResponse>('/setup/review', {
      method: 'POST',
      body: JSON.stringify({ draft: setupDraft }),
    });
    setSetupReview(payload);
    return payload;
  }, [api, setupDraft]);

  const reviewDraft = async () => {
    setBusy(true);
    setToast(null);
    try {
      const payload = await reviewSetupDraft();
      setToast({
        tone: payload.ready_to_bootstrap ? 'success' : 'error',
        message: payload.ready_to_bootstrap
          ? `Review ready: ${payload.campaign_id}`
          : `Review needs: ${payload.missing_fields.join(', ')}`,
      });
    } catch (error) {
      setToast({ tone: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const bootstrapCampaign = async () => {
    setBusy(true);
    setToast(null);
    try {
      const review = setupReview?.ready_to_bootstrap ? setupReview : await reviewSetupDraft();
      if (!review.ready_to_bootstrap) {
        throw new Error(`Review needs: ${review.missing_fields.join(', ') || 'draft updates'}`);
      }
      const payload = await api<{ campaign_id: string }>('/campaign/bootstrap', {
        method: 'POST',
        body: JSON.stringify(setupDraft),
      });
      setSelectedCampaign(payload.campaign_id);
      setSelectedSession('main');
      await api<RuntimeSettings>('/play/runtime-settings', {
        method: 'POST',
        body: JSON.stringify({
          campaign_id: payload.campaign_id,
          provider: selectedProvider || undefined,
          model: selectedModel || undefined,
          include_choices: includeChoices,
          mature_content_enabled: matureContentEnabled,
          notes: runtimeNotes || undefined,
        }),
      });
      setToast({ tone: 'success', message: `Bootstrapped ${payload.campaign_id}` });
      await refreshCatalog();
    } catch (error) {
      setToast({ tone: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const saveRuntimeSettings = async () => {
    if (!selectedCampaign) {
      setToast({ tone: 'error', message: 'Select or bootstrap a campaign before saving runtime settings.' });
      return;
    }
    setBusy(true);
    setToast(null);
    try {
      const targetSessionId = selectedSessionInfo?.session_id;
      await api<RuntimeSettings>('/play/runtime-settings', {
        method: 'POST',
        body: JSON.stringify({
          campaign_id: selectedCampaign,
          session_id: targetSessionId,
          provider: selectedProvider || undefined,
          model: selectedModel || undefined,
          include_choices: includeChoices,
          mature_content_enabled: matureContentEnabled,
          notes: runtimeNotes || undefined,
        }),
      });
      setToast({
        tone: 'success',
        message: targetSessionId ? `Saved runtime settings for ${targetSessionId}` : 'Saved campaign runtime settings',
      });
    } catch (error) {
      setToast({ tone: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const testProvider = async () => {
    setBusy(true);
    setToast(null);
    try {
      const payload = await api<{ provider: string; model: string; reply: string }>('/providers/test', {
        method: 'POST',
        body: JSON.stringify({
          provider: selectedProvider || undefined,
          model: selectedModel || undefined,
          prompt: 'Reply with one short sentence confirming this model is ready for CharacterRPG.',
        }),
      });
      setToast({
        tone: 'success',
        message: `${payload.provider} ${payload.model}: ${payload.reply.slice(0, 120)}`,
      });
    } catch (error) {
      setToast({ tone: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const sendTurn = async (event: FormEvent) => {
    event.preventDefault();
    const content = turnText.trim();
    if (!content) return;
    setBusy(true);
    setToast(null);
    setHistory((current) => [
      ...current,
      {
        role: 'user',
        content,
        turn: (bundle?.world_state.turn || 0) + 1,
        recorded_at: new Date().toISOString(),
      },
    ]);
    setTurnText('');
    try {
      const payload = await api<{ reply: string; turn: number; provider: string; model: string }>(
        '/play/respond',
        {
          method: 'POST',
          body: JSON.stringify({
            user_message: content,
            campaign_id: selectedCampaign || undefined,
            session_id: selectedSession || undefined,
            session_title: sessionTitle,
            provider: selectedProvider || undefined,
            model: selectedModel || undefined,
            include_choices: includeChoices,
            create_session_if_missing: true,
          }),
        },
      );
      setHistory((current) => [
        ...current,
        {
          role: 'assistant',
          content: payload.reply,
          turn: payload.turn,
          recorded_at: new Date().toISOString(),
        },
      ]);
      setToast({ tone: 'success', message: `${payload.provider} responded with ${payload.model}` });
      await Promise.all([refreshCatalog(), refreshActive()]);
    } catch (error) {
      setToast({ tone: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Campaign navigation">
        <div className="brand">
          <Boxes size={24} strokeWidth={1.8} />
          <div>
            <strong>CharacterRPG</strong>
            <span>Campaign runtime</span>
          </div>
        </div>

        <section className="nav-section">
          <div className="section-title">
            <BookOpen size={16} />
            <span>Campaigns</span>
          </div>
          <div className="stack">
            {campaigns.length === 0 ? (
              <p className="empty">No campaigns yet.</p>
            ) : (
              campaigns.map((campaign) => (
                <button
                  className={`list-row ${selectedCampaign === campaign.campaign_id ? 'selected' : ''}`}
                  key={campaign.campaign_id}
                  onClick={() => setSelectedCampaign(campaign.campaign_id)}
                  type="button"
                >
                  <span>{campaign.title || campaign.campaign_id}</span>
                  <small>{campaign.session_count} sessions</small>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="nav-section">
          <div className="section-title">
            <GitBranch size={16} />
            <span>Sessions</span>
          </div>
          <div className="stack">
            <label className="field compact">
              <span>Session ID</span>
              <input value={selectedSession} onChange={(event) => setSelectedSession(event.target.value)} />
            </label>
            <label className="field compact">
              <span>Title</span>
              <input value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} />
            </label>
            {sessions
              .filter((session) => !selectedCampaign || session.campaign_id === selectedCampaign)
              .slice(0, 8)
              .map((session) => (
                <button
                  className={`list-row ${selectedSession === session.session_id ? 'selected' : ''}`}
                  key={`${session.campaign_id}:${session.session_id}`}
                  onClick={() => {
                    setSelectedCampaign(session.campaign_id);
                    setSelectedSession(session.session_id);
                  }}
                  type="button"
                >
                  <span>{session.title || session.session_id}</span>
                  <small>turn {session.turn}</small>
                </button>
              ))}
          </div>
        </section>
      </aside>

      <section className="play-surface" aria-label="Play session">
        <header className="topbar">
          <div>
            <h1>{bundle?.scenario.title || setupReview?.summary?.title || 'Prepare a campaign'}</h1>
            <p>
              {bundle?.scenario.genre_vibe ||
                setupReview?.summary?.premise ||
                'Draft, review, and approve a campaign before play starts.'}
            </p>
          </div>
          <button className="icon-button" onClick={() => refreshActive()} type="button" aria-label="Refresh">
            <RefreshCw size={18} />
          </button>
        </header>

        <section className="scene-band">
          <div>
            <span className="metric-label">Location</span>
            <strong>{bundle?.world_state.location || setupDraft.setting || 'Not set'}</strong>
          </div>
          <div>
            <span className="metric-label">Turn</span>
            <strong>{bundle?.world_state.turn ?? 0}</strong>
          </div>
          <div>
            <span className="metric-label">Pressure</span>
            <strong>{bundle?.world_state.world_pressure ?? 0}</strong>
          </div>
          <div>
            <span className="metric-label">Clock</span>
            <strong>{bundle?.world_state.pressure_clock ?? 0}/6</strong>
          </div>
        </section>

        <div className="transcript" aria-live="polite">
          {history.length === 0 ? (
            <div className="empty-state">
              <MessageSquareText size={28} />
              <p>
                {bundle?.scenario.opening_hook ||
                  setupReview?.summary?.opening_hook ||
                  'Use the setup assistant, review the draft, then approve it for play.'}
              </p>
            </div>
          ) : (
            history.map((entry, index) => (
              <article className={`bubble ${entry.role}`} key={`${entry.turn}:${entry.role}:${index}`}>
                <span>{entry.role === 'user' ? 'Player' : 'GM'}</span>
                <p>{entry.content}</p>
              </article>
            ))
          )}
        </div>

        <form className="composer" onSubmit={sendTurn}>
          <textarea
            value={turnText}
            onChange={(event) => setTurnText(event.target.value)}
            placeholder="Type your turn or OOC note"
            rows={3}
          />
          <button disabled={busy || !turnText.trim() || !selectedCampaign} type="submit">
            <Send size={17} />
            <span>Send</span>
          </button>
        </form>
      </section>

      <aside className="inspector" aria-label="Runtime inspector">
        <section className="panel">
          <div className="section-title">
            <GitBranch size={16} />
            <span>Story Threads</span>
          </div>
          <div className="thread-list">
            {bundle?.story_threads?.length ? (
              bundle.story_threads.slice(0, 5).map((thread) => (
                <article className="thread-card" key={thread.thread_id}>
                  <div>
                    <strong>{thread.title}</strong>
                    <span>{thread.type} / {thread.status} / {thread.tension}/10</span>
                  </div>
                  <p>{thread.next_beat}</p>
                </article>
              ))
            ) : (
              <p className="empty">No story threads yet.</p>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="section-title">
            <Server size={16} />
            <span>Backend</span>
          </div>
          <label className="field">
            <span>API Base</span>
            <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} />
          </label>
          <button className="secondary-button" onClick={() => refreshCatalog()} type="button">
            <RefreshCw size={16} />
            <span>Refresh</span>
          </button>
        </section>

        <section className="panel">
          <div className="section-title">
            <Settings2 size={16} />
            <span>Provider</span>
          </div>
          <label className="field">
            <span>Provider</span>
            <select
              value={selectedProvider}
              onChange={(event) => {
                const provider = event.target.value;
                setSelectedProvider(provider);
                const next = providers.find((item) => item.provider === provider);
                setSelectedModel(next?.default_model || '');
              }}
            >
              {providers.map((provider) => (
                <option key={provider.provider} value={provider.provider}>
                  {provider.provider}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Model</span>
            <input value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} />
          </label>
          <div className={selectedProviderInfo?.configured ? 'status ok' : 'status warn'}>
            <Activity size={15} />
            <span>{selectedProviderInfo?.configured ? 'Configured' : 'Needs configuration'}</span>
          </div>
          <label className="field checkbox-field">
            <input
              checked={includeChoices}
              onChange={(event) => setIncludeChoices(event.target.checked)}
              type="checkbox"
            />
            <span>Choice prompts</span>
          </label>
          <label className="field checkbox-field">
            <input
              checked={matureContentEnabled}
              onChange={(event) => setMatureContentEnabled(event.target.checked)}
              type="checkbox"
            />
            <span>Mature content enabled</span>
          </label>
          <label className="field">
            <span>Runtime Notes</span>
            <textarea
              value={runtimeNotes}
              onChange={(event) => setRuntimeNotes(event.target.value)}
              rows={2}
            />
          </label>
          <div className="button-row">
            <button className="secondary-button" disabled={busy} onClick={testProvider} type="button">
              <Activity size={16} />
              <span>Test</span>
            </button>
            <button disabled={busy || !selectedCampaign} onClick={saveRuntimeSettings} type="button">
              <CheckCircle2 size={17} />
              <span>Save</span>
            </button>
          </div>
        </section>

        <section className="panel setup-panel">
          <div className="section-title">
            <Wand2 size={16} />
            <span>Setup</span>
          </div>
          <div className="setup-chat" aria-live="polite">
            {setupConversation.length === 0 ? (
              <p className="empty">No setup turns yet.</p>
            ) : (
              setupConversation.slice(-6).map((message, index) => (
                <article className={`setup-message ${message.role}`} key={`${message.role}:${index}`}>
                  <span>{message.role === 'user' ? 'You' : 'Guide'}</span>
                  <p>{message.content}</p>
                </article>
              ))
            )}
          </div>
          <form className="setup-compose" onSubmit={askSetupAssistant}>
            <textarea
              value={setupInput}
              onChange={(event) => setSetupInput(event.target.value)}
              rows={4}
              placeholder="Describe the campaign you want"
            />
            <button disabled={busy || !setupInput.trim()} type="submit">
              <Wand2 size={17} />
              <span>Draft</span>
            </button>
          </form>
          <div className="button-row">
            <button className="secondary-button" disabled={busy} onClick={reviewDraft} type="button">
              <ListChecks size={16} />
              <span>Review</span>
            </button>
            <button disabled={busy} onClick={bootstrapCampaign} type="button">
              <CheckCircle2 size={17} />
              <span>Approve</span>
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="section-title">
            <ListChecks size={16} />
            <span>Draft</span>
          </div>
          <label className="field">
            <span>Story</span>
            <input
              value={setupDraft.story_name || ''}
              onChange={(event) => updateSetupDraft({ story_name: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Setting</span>
            <textarea
              value={setupDraft.setting || ''}
              onChange={(event) => updateSetupDraft({ setting: event.target.value })}
              rows={3}
            />
          </label>
          <label className="field">
            <span>Genre</span>
            <input
              value={setupDraft.genre_vibe || ''}
              onChange={(event) => updateSetupDraft({ genre_vibe: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Tone</span>
            <input value={setupDraft.tone || ''} onChange={(event) => updateSetupDraft({ tone: event.target.value })} />
          </label>
          <label className="field">
            <span>Themes</span>
            <textarea
              value={listToText(setupDraft.themes)}
              onChange={(event) => updateSetupDraft({ themes: textToList(event.target.value) })}
              rows={3}
            />
          </label>
          <label className="field">
            <span>Context</span>
            <textarea
              value={setupDraft.context_summary || ''}
              onChange={(event) => updateSetupDraft({ context_summary: event.target.value })}
              rows={3}
            />
          </label>
          <label className="field">
            <span>Lore</span>
            <textarea
              value={setupDraft.lore_text || ''}
              onChange={(event) => updateSetupDraft({ lore_text: event.target.value })}
              rows={4}
            />
          </label>
          <label className="field">
            <span>Preferences</span>
            <textarea
              value={listToText(setupDraft.play_preferences)}
              onChange={(event) => updateSetupDraft({ play_preferences: textToList(event.target.value) })}
              rows={4}
            />
          </label>
          <label className="field checkbox-field">
            <input
              checked={setupDraft.allow_inference}
              onChange={(event) => updateSetupDraft({ allow_inference: event.target.checked })}
              type="checkbox"
            />
            <span>Allow inference</span>
          </label>
          <label className="field">
            <span>PC Name</span>
            <input
              value={setupDraft.player_character.name || ''}
              onChange={(event) => updatePlayerDraft({ name: event.target.value })}
            />
          </label>
          <label className="field">
            <span>PC Concept</span>
            <textarea
              value={setupDraft.player_character.concept || ''}
              onChange={(event) => updatePlayerDraft({ concept: event.target.value })}
              rows={3}
            />
          </label>
          <label className="field">
            <span>PC Goals</span>
            <textarea
              value={listToText(setupDraft.player_character.goals)}
              onChange={(event) => updatePlayerDraft({ goals: textToList(event.target.value) })}
              rows={3}
            />
          </label>
          <label className="field">
            <span>PC Edges</span>
            <textarea
              value={listToText(setupDraft.player_character.edges)}
              onChange={(event) => updatePlayerDraft({ edges: textToList(event.target.value) })}
              rows={3}
            />
          </label>
          <label className="field">
            <span>PC Complications</span>
            <textarea
              value={listToText(setupDraft.player_character.complications)}
              onChange={(event) => updatePlayerDraft({ complications: textToList(event.target.value) })}
              rows={3}
            />
          </label>
        </section>

        {setupReview && (
          <section className="panel">
            <div className="section-title">
              <CheckCircle2 size={16} />
              <span>Review</span>
            </div>
            <div className={setupReview.ready_to_bootstrap ? 'status ok' : 'status warn'}>
              <Activity size={15} />
              <span>{setupReview.ready_to_bootstrap ? 'Ready' : 'Needs edits'}</span>
            </div>
            {setupReview.summary && (
              <div className="review-card">
                <strong>{setupReview.summary.title}</strong>
                <p>{setupReview.summary.premise}</p>
                <p>{setupReview.summary.opening_hook}</p>
              </div>
            )}
            {setupReview.findings.length > 0 && (
              <div className="finding-list">
                {setupReview.findings.map((finding, index) => (
                  <div className={`finding ${finding.severity}`} key={`${finding.field}:${index}`}>
                    <span>{finding.field}</span>
                    <p>{finding.message}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="panel">
          <div className="section-title">
            <MessageSquareText size={16} />
            <span>Memory</span>
          </div>
          <p className="recap">{bundle?.recap || 'No recap loaded.'}</p>
        </section>

        {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}
      </aside>
    </main>
  );
}

export default App;
```

## web/src/styles.css

```css
:root {
  color-scheme: light;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #eef1ed;
  color: #17211f;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  --surface: #fbfcf8;
  --surface-strong: #f2f5ef;
  --surface-muted: #e4e9e3;
  --ink: #17211f;
  --muted: #66716d;
  --line: #d1d9d2;
  --teal: #126c61;
  --teal-dark: #0b4c45;
  --amber: #9d6b1c;
  --red: #9a3b32;
  --blue: #2d5d86;
  --shadow: 0 14px 34px rgba(32, 45, 41, 0.1);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  border: 0;
}

.app-shell {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 360px;
  min-height: 100vh;
  background:
    linear-gradient(90deg, rgba(251, 252, 248, 0.72), transparent 28%),
    #eef1ed;
}

.sidebar,
.inspector {
  background: rgba(251, 252, 248, 0.92);
  border-color: var(--line);
  border-style: solid;
  overflow-y: auto;
}

.sidebar {
  border-width: 0 1px 0 0;
  padding: 20px 16px;
}

.inspector {
  border-width: 0 0 0 1px;
  padding: 18px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--line);
}

.brand svg {
  color: var(--teal);
}

.brand strong,
.brand span {
  display: block;
}

.brand strong {
  font-size: 17px;
  line-height: 1.2;
}

.brand span,
.metric-label,
.list-row small,
.field span,
.topbar p,
.recap,
.empty {
  color: var(--muted);
}

.brand span,
.list-row small,
.metric-label,
.field span {
  font-size: 12px;
  line-height: 1.4;
}

.nav-section,
.panel {
  padding-top: 18px;
}

.panel {
  padding: 16px 0 18px;
  border-bottom: 1px solid var(--line);
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: #24312e;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
  text-transform: uppercase;
  letter-spacing: 0;
}

.section-title svg {
  color: var(--teal);
}

.stack {
  display: grid;
  gap: 8px;
}

.list-row {
  display: grid;
  width: 100%;
  gap: 2px;
  min-height: 50px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}

.list-row span {
  overflow: hidden;
  font-size: 14px;
  font-weight: 650;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-row:hover,
.list-row.selected {
  border-color: #bfd1ca;
  background: #eef5f1;
}

.play-surface {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  min-width: 0;
  padding: 18px 20px;
}

.topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  min-height: 68px;
  padding-bottom: 14px;
}

.topbar h1 {
  margin: 0;
  font-size: clamp(24px, 3vw, 38px);
  font-weight: 760;
  line-height: 1.08;
  letter-spacing: 0;
}

.topbar p {
  max-width: 780px;
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 1.5;
}

.icon-button,
.secondary-button,
button[type="submit"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 38px;
  border-radius: 8px;
  cursor: pointer;
}

.icon-button {
  width: 40px;
  background: var(--surface);
  color: var(--ink);
  border: 1px solid var(--line);
}

.secondary-button {
  width: 100%;
  background: var(--surface-strong);
  color: var(--ink);
  border: 1px solid var(--line);
  font-size: 13px;
  font-weight: 700;
}

button[type="submit"] {
  padding: 0 14px;
  background: var(--teal);
  color: #fff;
  font-size: 14px;
  font-weight: 760;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.scene-band {
  display: grid;
  grid-template-columns: 1.4fr repeat(3, minmax(88px, 0.28fr));
  gap: 10px;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.scene-band div {
  min-width: 0;
  padding: 8px 10px;
  border-left: 3px solid #c4d4ce;
  background: #f6f8f3;
}

.scene-band strong {
  display: block;
  overflow: hidden;
  margin-top: 3px;
  font-size: 15px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transcript {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  padding: 4px 2px 14px;
  overflow-y: auto;
}

.bubble {
  max-width: min(760px, 86%);
  padding: 11px 13px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: 0 8px 22px rgba(32, 45, 41, 0.08);
}

.bubble.user {
  align-self: flex-end;
  border-color: #c6d7e2;
  background: #f4f8fb;
}

.bubble.assistant {
  align-self: flex-start;
  border-color: #cad8ce;
}

.bubble span {
  display: block;
  margin-bottom: 5px;
  color: var(--teal-dark);
  font-size: 12px;
  font-weight: 760;
  line-height: 1.2;
}

.bubble p,
.empty-state p,
.recap {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.empty-state {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 12px;
  min-height: 360px;
  border: 1px dashed #bac7c0;
  border-radius: 8px;
  background: rgba(251, 252, 248, 0.55);
  color: var(--muted);
  text-align: center;
}

.empty-state p {
  max-width: 560px;
}

.composer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.composer textarea,
.setup-compose textarea {
  min-height: 74px;
  resize: vertical;
}

.field {
  display: grid;
  gap: 6px;
  margin-bottom: 10px;
}

.field.compact {
  margin-bottom: 0;
}

.field input,
.field select,
.field textarea,
.composer textarea,
.setup-compose textarea {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  color: var(--ink);
  font-size: 14px;
  line-height: 1.4;
  outline: none;
  padding: 9px 10px;
}

.field input:focus,
.field select:focus,
.field textarea:focus,
.composer textarea:focus,
.setup-compose textarea:focus {
  border-color: var(--teal);
  box-shadow: 0 0 0 3px rgba(18, 108, 97, 0.13);
}

.setup-panel {
  display: grid;
  gap: 12px;
}

.setup-chat {
  display: grid;
  gap: 8px;
  max-height: 260px;
  overflow-y: auto;
}

.setup-message {
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}

.setup-message.user {
  border-color: #c6d7e2;
  background: #f4f8fb;
}

.setup-message.assistant {
  border-color: #cad8ce;
  background: #f7faf5;
}

.setup-message span,
.finding span {
  display: block;
  margin-bottom: 4px;
  color: var(--teal-dark);
  font-size: 12px;
  font-weight: 760;
  line-height: 1.2;
}

.setup-message p,
.review-card p,
.finding p {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.setup-compose {
  display: grid;
  gap: 8px;
}

.button-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.button-row > button:not(.secondary-button) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 8px;
  background: var(--teal);
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  font-weight: 760;
}

.checkbox-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.checkbox-field input {
  width: 16px;
  height: 16px;
}

.review-card,
.finding {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}

.thread-list {
  display: grid;
  gap: 8px;
}

.thread-card {
  display: grid;
  gap: 7px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}

.thread-card strong,
.thread-card span {
  display: block;
}

.thread-card strong {
  font-size: 14px;
  line-height: 1.25;
}

.thread-card span {
  margin-top: 3px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.35;
}

.thread-card p {
  margin: 0;
  color: #2b3835;
  font-size: 13px;
  line-height: 1.45;
}

.review-card strong {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  line-height: 1.25;
}

.finding-list {
  display: grid;
  gap: 8px;
}

.finding.info {
  border-color: #c7d9e6;
  background: #f4f8fb;
}

.finding.warning {
  border-color: #e5d0a8;
  background: #fff9eb;
}

.finding.critical {
  border-color: #e2b7b0;
  background: #fff3f1;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 6px 9px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
}

.status.ok {
  color: var(--teal-dark);
  background: #e8f3ef;
}

.status.warn {
  color: var(--amber);
  background: #fff3de;
}

.toast {
  margin-top: 16px;
  padding: 11px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
}

.toast.info {
  color: var(--blue);
  background: #e8f1f7;
}

.toast.success {
  color: var(--teal-dark);
  background: #e4f4ee;
}

.toast.error {
  color: var(--red);
  background: #f9e9e6;
}

@media (max-width: 1180px) {
  .app-shell {
    grid-template-columns: 240px minmax(0, 1fr);
  }

  .inspector {
    grid-column: 1 / -1;
    border-width: 1px 0 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 22px;
  }
}

@media (max-width: 780px) {
  .app-shell {
    display: block;
  }

  .sidebar,
  .inspector {
    border-width: 0 0 1px;
  }

  .play-surface {
    min-height: 680px;
    padding: 16px;
  }

  .scene-band,
  .inspector {
    grid-template-columns: 1fr;
  }

  .composer {
    grid-template-columns: 1fr;
  }

  .bubble {
    max-width: 100%;
  }
}
```
