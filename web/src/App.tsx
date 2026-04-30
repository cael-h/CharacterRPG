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
  timeline: string[];
  recap: string;
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
