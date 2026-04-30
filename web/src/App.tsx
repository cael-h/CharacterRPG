import {
  Activity,
  BookOpen,
  Boxes,
  GitBranch,
  ListChecks,
  MessageSquareText,
  Play,
  RefreshCw,
  Send,
  Server,
  Settings2,
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

type Toast = { tone: 'info' | 'error' | 'success'; message: string } | null;

const API_BASE = 'http://127.0.0.1:4100';

const initialBootstrap = {
  storyName: 'Ash Market Signals',
  setting: 'A trade district built inside a retired fortress',
  genre: 'Urban fantasy intrigue',
  pcName: 'Nera Vale',
  pcConcept: 'A courier with a dangerous memory for routes.',
};

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
  const [bootstrap, setBootstrap] = useState(initialBootstrap);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  const selectedProviderInfo = useMemo(
    () => providers.find((provider) => provider.provider === selectedProvider),
    [providers, selectedProvider],
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

  const bootstrapCampaign = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setToast(null);
    try {
      const payload = await api<{ campaign_id: string }>('/campaign/bootstrap', {
        method: 'POST',
        body: JSON.stringify({
          story_name: bootstrap.storyName,
          setting: bootstrap.setting,
          genre_vibe: bootstrap.genre,
          player_character: {
            name: bootstrap.pcName,
            concept: bootstrap.pcConcept,
          },
        }),
      });
      setSelectedCampaign(payload.campaign_id);
      setSelectedSession('main');
      setToast({ tone: 'success', message: `Bootstrapped ${payload.campaign_id}` });
      await refreshCatalog();
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
            <h1>{bundle?.scenario.title || 'Bootstrap a campaign'}</h1>
            <p>{bundle?.scenario.genre_vibe || 'Create a campaign bundle, then start play.'}</p>
          </div>
          <button className="icon-button" onClick={() => refreshActive()} type="button" aria-label="Refresh">
            <RefreshCw size={18} />
          </button>
        </header>

        <section className="scene-band">
          <div>
            <span className="metric-label">Location</span>
            <strong>{bundle?.world_state.location || 'Not set'}</strong>
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
              <p>{bundle?.scenario.opening_hook || 'Bootstrap a campaign or select a saved session.'}</p>
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
          <button disabled={busy || !turnText.trim()} type="submit">
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
        </section>

        <form className="panel" onSubmit={bootstrapCampaign}>
          <div className="section-title">
            <Play size={16} />
            <span>Bootstrap</span>
          </div>
          <label className="field">
            <span>Story</span>
            <input
              value={bootstrap.storyName}
              onChange={(event) => setBootstrap({ ...bootstrap, storyName: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Setting</span>
            <input
              value={bootstrap.setting}
              onChange={(event) => setBootstrap({ ...bootstrap, setting: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Genre</span>
            <input
              value={bootstrap.genre}
              onChange={(event) => setBootstrap({ ...bootstrap, genre: event.target.value })}
            />
          </label>
          <label className="field">
            <span>PC Name</span>
            <input
              value={bootstrap.pcName}
              onChange={(event) => setBootstrap({ ...bootstrap, pcName: event.target.value })}
            />
          </label>
          <label className="field">
            <span>PC Concept</span>
            <textarea
              value={bootstrap.pcConcept}
              onChange={(event) => setBootstrap({ ...bootstrap, pcConcept: event.target.value })}
              rows={3}
            />
          </label>
          <button disabled={busy} type="submit">
            <ListChecks size={17} />
            <span>Bootstrap</span>
          </button>
        </form>

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
