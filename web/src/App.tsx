import {
  Activity,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileText,
  GitBranch,
  ListChecks,
  MapPinned,
  Menu,
  MessageSquareText,
  Network,
  PanelRight,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings2,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
    setting: string;
    opening_hook: string;
    genre_vibe: string;
    tone: string;
    themes?: string[];
  };
  event_queue: string[];
  relationship_graph: Record<string, Record<string, string>>;
  rpg_characters: CharacterProfile[];
  story_threads: StoryThread[];
  timeline: string[];
  recap: string;
};

type CharacterProfile = {
  name: string;
  role: string;
  public_summary: string;
  goals: string[];
  traits: string[];
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

type MainTab = 'transcript' | 'recap' | 'timeline' | 'relationships' | 'locations';

type TranscriptMatch = {
  index: number;
  turn: number;
  role: TranscriptEntry['role'];
};

type LocationTrailItem = {
  label: string;
  detail: string;
  tone: 'current' | 'scene' | 'timeline';
};

const API_BASE = 'http://127.0.0.1:4100';
const DEFAULT_TRANSCRIPT_JUMP_TURNS = 10;
const TRANSCRIPT_JUMP_STORAGE_KEY = 'characterRpgTranscriptJumpTurns';

const mainTabs: { id: MainTab; label: string; Icon: LucideIcon }[] = [
  { id: 'transcript', label: 'Transcript', Icon: MessageSquareText },
  { id: 'recap', label: 'Recap', Icon: FileText },
  { id: 'timeline', label: 'Timeline', Icon: Clock3 },
  { id: 'relationships', label: 'Relationships', Icon: Network },
  { id: 'locations', label: 'Locations', Icon: MapPinned },
];

const readStoredJumpTurns = () => {
  try {
    const stored = window.localStorage.getItem(TRANSCRIPT_JUMP_STORAGE_KEY);
    const parsed = Number(stored);
    return Number.isFinite(parsed) && parsed >= 1 ? Math.min(100, Math.round(parsed)) : DEFAULT_TRANSCRIPT_JUMP_TURNS;
  } catch {
    return DEFAULT_TRANSCRIPT_JUMP_TURNS;
  }
};

const clampJumpTurns = (value: number) => Math.max(1, Math.min(100, Math.round(value)));

const persistJumpTurns = (value: number) => {
  try {
    window.localStorage.setItem(TRANSCRIPT_JUMP_STORAGE_KEY, String(value));
  } catch {
    // Browser storage can be unavailable in private or embedded contexts.
  }
};

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
  const [uiMode, setUiMode] = useState<'setup' | 'play'>('play');
  const [showSidebar, setShowSidebar] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeMainTab, setActiveMainTab] = useState<MainTab>('transcript');
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [isTranscriptScrolledBack, setIsTranscriptScrolledBack] = useState(false);
  const [transcriptJumpTurns, setTranscriptJumpTurns] = useState(readStoredJumpTurns);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

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

  const loadedTurns = useMemo(() => {
    const turns = Array.from(new Set(history.map((entry) => entry.turn)));
    turns.sort((a, b) => a - b);
    return turns;
  }, [history]);

  const transcriptQuery = transcriptSearch.trim().toLowerCase();

  const transcriptMatches = useMemo<TranscriptMatch[]>(() => {
    if (!transcriptQuery) return [];
    return history.flatMap((entry, index) =>
      entry.content.toLowerCase().includes(transcriptQuery)
        ? [{ index, turn: entry.turn, role: entry.role }]
        : [],
    );
  }, [history, transcriptQuery]);

  const transcriptMatchIndexes = useMemo(
    () => new Set(transcriptMatches.map((match) => match.index)),
    [transcriptMatches],
  );

  const activeSearchEntryIndex = transcriptMatches[activeSearchIndex]?.index ?? -1;

  const relationshipEntries = useMemo(
    () =>
      Object.entries(bundle?.relationship_graph || {}).flatMap(([source, targets]) =>
        Object.entries(targets || {}).map(([target, description]) => ({ source, target, description })),
      ),
    [bundle],
  );

  const relationshipThreads = useMemo(
    () => (bundle?.story_threads || []).filter((thread) => thread.type === 'relationship'),
    [bundle],
  );

  const timelineEntries = useMemo(() => [...(bundle?.timeline || [])].reverse(), [bundle]);

  const locationTrail = useMemo<LocationTrailItem[]>(() => {
    if (!bundle) return [];
    const items: LocationTrailItem[] = [];
    const currentLocation = bundle.world_state.location?.trim();
    if (currentLocation) {
      items.push({
        label: currentLocation,
        detail: bundle.world_state.current_scene || bundle.scenario.setting || 'Current location',
        tone: 'current',
      });
    }
    if (bundle.scenario.setting && bundle.scenario.setting !== currentLocation) {
      items.push({
        label: bundle.scenario.setting,
        detail: bundle.scenario.premise,
        tone: 'scene',
      });
    }
    for (const entry of bundle.timeline.slice(-10).reverse()) {
      items.push({
        label: entry.replace(/^Turn\s+\d+:\s*/i, '').slice(0, 72),
        detail: entry,
        tone: 'timeline',
      });
    }
    return items;
  }, [bundle]);

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

  const scrollToEntryIndex = useCallback((entryIndex: number) => {
    const container = transcriptRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-entry-index="${entryIndex}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const scrollTranscriptToTop = useCallback(() => {
    transcriptRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const scrollTranscriptToBottom = useCallback(() => {
    const container = transcriptRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    setIsTranscriptScrolledBack(false);
  }, []);

  const scrollToTurn = useCallback((turn: number) => {
    const container = transcriptRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-turn="${turn}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const findVisibleTurn = useCallback(() => {
    const container = transcriptRef.current;
    if (!container) return loadedTurns[0] || 0;
    const containerTop = container.getBoundingClientRect().top + 12;
    const visibleEntry = Array.from(container.querySelectorAll<HTMLElement>('[data-turn]')).find(
      (entry) => entry.getBoundingClientRect().bottom >= containerTop,
    );
    return Number(visibleEntry?.dataset.turn) || loadedTurns[0] || 0;
  }, [loadedTurns]);

  const jumpTranscriptTurns = useCallback(
    (direction: -1 | 1) => {
      if (loadedTurns.length === 0) return;
      const firstTurn = loadedTurns[0];
      const lastTurn = loadedTurns[loadedTurns.length - 1];
      const currentTurn = findVisibleTurn();
      const boundedTurn = Math.max(firstTurn, Math.min(lastTurn, currentTurn + direction * transcriptJumpTurns));
      const targetTurn =
        direction > 0
          ? loadedTurns.find((turn) => turn >= boundedTurn) || lastTurn
          : [...loadedTurns].reverse().find((turn) => turn <= boundedTurn) || firstTurn;
      scrollToTurn(targetTurn);
    },
    [findVisibleTurn, loadedTurns, scrollToTurn, transcriptJumpTurns],
  );

  const handleTranscriptScroll = useCallback(() => {
    const container = transcriptRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nextScrolledBack = distanceFromBottom > 120;
    setIsTranscriptScrolledBack((current) => (current === nextScrolledBack ? current : nextScrolledBack));
  }, []);

  const goToSearchMatch = useCallback(
    (direction: -1 | 1) => {
      if (transcriptMatches.length === 0) return;
      const nextIndex = (activeSearchIndex + direction + transcriptMatches.length) % transcriptMatches.length;
      setActiveSearchIndex(nextIndex);
      scrollToEntryIndex(transcriptMatches[nextIndex].index);
    },
    [activeSearchIndex, scrollToEntryIndex, transcriptMatches],
  );

  const handleJumpTurnsChange = (value: string) => {
    const parsed = Number(value);
    const nextValue = clampJumpTurns(Number.isFinite(parsed) ? parsed : DEFAULT_TRANSCRIPT_JUMP_TURNS);
    setTranscriptJumpTurns(nextValue);
    persistJumpTurns(nextValue);
  };

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
    if (campaignPayload.length === 0) {
      setUiMode('setup');
      return;
    }
    if (uiMode === 'play' && !selectedCampaign && campaignPayload[0]?.campaign_id) {
      const campaignId = campaignPayload[0].campaign_id;
      const firstSession = sessionPayload.find((session) => session.campaign_id === campaignId);
      setSelectedCampaign(campaignId);
      setSelectedSession(firstSession?.session_id || 'main');
      setSessionTitle(firstSession?.title || 'Main');
    } else if (uiMode === 'play' && selectedCampaign && selectedSession === 'main') {
      const campaignSessions = sessionPayload.filter((session) => session.campaign_id === selectedCampaign);
      const hasMain = campaignSessions.some((session) => session.session_id === 'main');
      if (!hasMain && campaignSessions[0]) {
        setSelectedSession(campaignSessions[0].session_id);
        setSessionTitle(campaignSessions[0].title || campaignSessions[0].session_id);
      }
    }
  }, [api, selectedCampaign, selectedSession, uiMode]);

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
        api<TranscriptEntry[]>(`/play/history?limit=1000&${sessionQuery}`),
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
    setActiveSearchIndex(0);
  }, [selectedCampaign, selectedSession, transcriptQuery]);

  useEffect(() => {
    if (!transcriptQuery || transcriptMatches.length === 0) return;
    const clampedIndex = Math.min(activeSearchIndex, transcriptMatches.length - 1);
    if (clampedIndex !== activeSearchIndex) {
      setActiveSearchIndex(clampedIndex);
      return;
    }
    scrollToEntryIndex(transcriptMatches[clampedIndex].index);
  }, [activeSearchIndex, scrollToEntryIndex, transcriptMatches, transcriptQuery]);

  useEffect(() => {
    if (activeMainTab !== 'transcript' || isTranscriptScrolledBack) return;
    const container = transcriptRef.current;
    if (!container) return;
    window.requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight });
      setIsTranscriptScrolledBack(false);
    });
  }, [activeMainTab, history.length, isTranscriptScrolledBack]);

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
      setUiMode('play');
      setShowInspector(false);
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

  const saveRuntimeSettings = async (): Promise<boolean> => {
    if (!selectedCampaign) {
      setToast({ tone: 'error', message: 'Select or bootstrap a campaign before saving runtime settings.' });
      return false;
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
      return true;
    } catch (error) {
      setToast({ tone: 'error', message: error instanceof Error ? error.message : String(error) });
      return false;
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

  const isSetupMode = uiMode === 'setup' || !selectedCampaign;

  const handleRefresh = () => {
    const operation = isSetupMode
      ? refreshCatalog()
      : Promise.all([refreshCatalog(), refreshActive()]).then(() => undefined);
    operation.catch((error: unknown) =>
      setToast({ tone: 'error', message: error instanceof Error ? error.message : String(error) }),
    );
  };

  const handleNewCampaign = () => {
    if (!isSetupMode) {
      setSetupDraft(initialSetupDraft);
      setSetupInput(initialSetupPrompt);
      setSetupConversation([]);
      setSetupReview(null);
    }
    setSelectedCampaign('');
    setSelectedSession('main');
    setSessionTitle('Main');
    setBundle(null);
    setHistory([]);
    setUiMode('setup');
    setActiveMainTab('transcript');
    setShowSidebar(false);
  };

  const handleSelectCampaign = (campaignId: string) => {
    const firstSession = sessions.find((session) => session.campaign_id === campaignId);
    setSelectedCampaign(campaignId);
    setSelectedSession(firstSession?.session_id || 'main');
    setSessionTitle(firstSession?.title || 'Main');
    setUiMode('play');
    setActiveMainTab('transcript');
    setShowSidebar(false);
  };

  const handleSelectSession = (session: SessionSummary) => {
    setSelectedCampaign(session.campaign_id);
    setSelectedSession(session.session_id);
    setSessionTitle(session.title || session.session_id);
    setUiMode('play');
    setActiveMainTab('transcript');
    setShowSidebar(false);
  };

  const handleSaveSettingsAndClose = async () => {
    const saved = await saveRuntimeSettings();
    if (saved) setShowSettings(false);
  };

  return (
    <main className={`app-shell ${isSetupMode ? 'setup-mode' : 'play-mode'}`}>
      {(showSidebar || showInspector) && (
        <button
          aria-label="Close mobile panels"
          className="mobile-overlay"
          onClick={() => {
            setShowSidebar(false);
            setShowInspector(false);
          }}
          type="button"
        />
      )}

      <aside className={`sidebar ${showSidebar ? 'open' : ''}`} aria-label="Campaign navigation">
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
            <button
              className={`list-row new-campaign ${isSetupMode ? 'selected' : ''}`}
              onClick={handleNewCampaign}
              type="button"
            >
              <span>+ New Campaign</span>
              <small>Draft and approve a story</small>
            </button>
            {campaigns.map((campaign) => (
              <button
                className={`list-row ${!isSetupMode && selectedCampaign === campaign.campaign_id ? 'selected' : ''}`}
                key={campaign.campaign_id}
                onClick={() => handleSelectCampaign(campaign.campaign_id)}
                type="button"
              >
                <span>{campaign.title || campaign.campaign_id}</span>
                <small>{campaign.session_count} sessions</small>
              </button>
            ))}
          </div>
        </section>

        {!isSetupMode && (
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
                .filter((session) => session.campaign_id === selectedCampaign)
                .slice(0, 8)
                .map((session) => (
                  <button
                    className={`list-row ${selectedSession === session.session_id ? 'selected' : ''}`}
                    key={`${session.campaign_id}:${session.session_id}`}
                    onClick={() => handleSelectSession(session)}
                    type="button"
                  >
                    <span>{session.title || session.session_id}</span>
                    <small>turn {session.turn}</small>
                  </button>
                ))}
            </div>
          </section>
        )}
      </aside>

      <section className="play-surface" aria-label={isSetupMode ? 'Campaign setup' : 'Play session'}>
        <header className="topbar">
          <button
            aria-label="Open campaign navigation"
            className="icon-button mobile-only"
            onClick={() => setShowSidebar(true)}
            type="button"
          >
            <Menu size={20} />
          </button>

          <div className="header-titles">
            <h1>
              {isSetupMode ? 'Prepare a Campaign' : bundle?.scenario.title || setupReview?.summary?.title || 'Loading'}
            </h1>
            <p>
              {isSetupMode
                ? 'Draft, review, and approve a new story.'
                : bundle?.scenario.genre_vibe ||
                setupReview?.summary?.premise ||
                  'Choose a campaign or start a new one.'}
            </p>
          </div>

          <div className="header-actions">
            <button className="icon-button" onClick={handleRefresh} type="button" aria-label="Refresh">
              <RefreshCw size={18} />
            </button>
            <button className="icon-button" onClick={() => setShowSettings(true)} type="button" aria-label="Settings">
              <Settings2 size={18} />
            </button>
            <button
              aria-label="Open runtime inspector"
              className="icon-button mobile-only"
              onClick={() => setShowInspector(true)}
              type="button"
            >
              <PanelRight size={20} />
            </button>
          </div>
        </header>

        {isSetupMode ? (
          <div className="setup-center">
            <div className="setup-chat" aria-live="polite">
              {setupConversation.length === 0 ? (
                <div className="empty-state">
                  <Wand2 size={32} />
                  <p>Tell the guide what kind of campaign you want to play.</p>
                </div>
              ) : (
                setupConversation.map((message, index) => (
                  <article className={`bubble ${message.role}`} key={`${message.role}:${index}`}>
                    <span>{message.role === 'user' ? 'You' : 'Guide'}</span>
                    <p>{message.content}</p>
                  </article>
                ))
              )}
            </div>

            <form className="composer" onSubmit={askSetupAssistant}>
              <textarea
                value={setupInput}
                onChange={(event) => setSetupInput(event.target.value)}
                placeholder="Describe the campaign you want..."
                rows={3}
              />
              <button disabled={busy || !setupInput.trim()} type="submit">
                <Wand2 size={17} />
                <span>Draft</span>
              </button>
            </form>
          </div>
        ) : (
          <>
            <section className="scene-band">
              <div>
                <span className="metric-label">Location</span>
                <strong>{bundle?.world_state.location || 'Unknown'}</strong>
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

            <nav className="main-tabs" aria-label="Story views">
              {mainTabs.map(({ id, label, Icon }) => (
                <button
                  aria-current={activeMainTab === id ? 'page' : undefined}
                  className={`tab-button ${activeMainTab === id ? 'selected' : ''}`}
                  key={id}
                  onClick={() => setActiveMainTab(id)}
                  type="button"
                >
                  <Icon size={15} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>

            <div className="play-tab-content">
              {activeMainTab === 'transcript' && (
                <>
                  <div className="transcript-toolbar" aria-label="Transcript navigation">
                    <label className="transcript-search">
                      <Search size={16} />
                      <input
                        aria-label="Search transcript"
                        placeholder="Search transcript"
                        value={transcriptSearch}
                        onChange={(event) => setTranscriptSearch(event.target.value)}
                      />
                    </label>
                    <div className="search-status">
                      {transcriptQuery
                        ? transcriptMatches.length > 0
                          ? `${activeSearchIndex + 1}/${transcriptMatches.length}`
                          : '0/0'
                        : `${history.length} entries`}
                    </div>
                    <div className="transcript-actions">
                      <button
                        aria-label="Jump to beginning"
                        className="compact-control"
                        disabled={history.length === 0}
                        onClick={scrollTranscriptToTop}
                        title="Beginning"
                        type="button"
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        aria-label={`Jump back ${transcriptJumpTurns} turns`}
                        className="compact-control text-control"
                        disabled={history.length === 0}
                        onClick={() => jumpTranscriptTurns(-1)}
                        title={`Back ${transcriptJumpTurns} turns`}
                        type="button"
                      >
                        <ChevronUp size={15} />
                        <span>-{transcriptJumpTurns}</span>
                      </button>
                      <button
                        aria-label={`Jump forward ${transcriptJumpTurns} turns`}
                        className="compact-control text-control"
                        disabled={history.length === 0}
                        onClick={() => jumpTranscriptTurns(1)}
                        title={`Forward ${transcriptJumpTurns} turns`}
                        type="button"
                      >
                        <span>+{transcriptJumpTurns}</span>
                        <ChevronDown size={15} />
                      </button>
                      <button
                        aria-label="Previous search result"
                        className="compact-control"
                        disabled={transcriptMatches.length === 0}
                        onClick={() => goToSearchMatch(-1)}
                        title="Previous match"
                        type="button"
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        aria-label="Next search result"
                        className="compact-control"
                        disabled={transcriptMatches.length === 0}
                        onClick={() => goToSearchMatch(1)}
                        title="Next match"
                        type="button"
                      >
                        <ChevronDown size={16} />
                      </button>
                      <button
                        aria-label="Jump to latest turn"
                        className={`compact-control latest-control ${isTranscriptScrolledBack ? 'attention' : ''}`}
                        disabled={history.length === 0 || !isTranscriptScrolledBack}
                        onClick={scrollTranscriptToBottom}
                        title="Latest"
                        type="button"
                      >
                        <ArrowDown size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="transcript" aria-live="polite" onScroll={handleTranscriptScroll} ref={transcriptRef}>
                    {history.length === 0 ? (
                      <div className="empty-state">
                        <MessageSquareText size={28} />
                        <p>{bundle?.scenario.opening_hook || 'Start the session with your first move.'}</p>
                      </div>
                    ) : (
                      history.map((entry, index) => (
                        <article
                          className={`bubble ${entry.role} ${
                            transcriptMatchIndexes.has(index) ? 'search-hit' : ''
                          } ${activeSearchEntryIndex === index ? 'active-search-hit' : ''}`}
                          data-entry-index={index}
                          data-turn={entry.turn}
                          key={`${entry.turn}:${entry.role}:${index}`}
                        >
                          <span>{entry.role === 'user' ? `Player / Turn ${entry.turn}` : `GM / Turn ${entry.turn}`}</span>
                          <p>{entry.content}</p>
                        </article>
                      ))
                    )}
                  </div>
                </>
              )}

              {activeMainTab === 'recap' && (
                <section className="info-panel">
                  <div className="section-title">
                    <FileText size={16} />
                    <span>Recap</span>
                  </div>
                  <p className="recap long-form">{bundle?.recap || 'No recap loaded.'}</p>
                </section>
              )}

              {activeMainTab === 'timeline' && (
                <section className="info-panel">
                  <div className="section-title">
                    <Clock3 size={16} />
                    <span>Timeline</span>
                  </div>
                  {timelineEntries.length ? (
                    <div className="timeline-list">
                      {timelineEntries.map((entry, index) => (
                        <article className="timeline-item" key={`${entry}:${index}`}>
                          <span>{timelineEntries.length - index}</span>
                          <p>{entry}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state compact-empty">
                      <Clock3 size={24} />
                      <p>No timeline entries loaded.</p>
                    </div>
                  )}
                </section>
              )}

              {activeMainTab === 'relationships' && (
                <section className="info-panel">
                  <div className="section-title">
                    <Network size={16} />
                    <span>Relationships</span>
                  </div>
                  {relationshipEntries.length ? (
                    <div className="relationship-map">
                      {relationshipEntries.map((edge, index) => (
                        <article className="relationship-edge" key={`${edge.source}:${edge.target}:${index}`}>
                          <strong>{edge.source}</strong>
                          <span>{edge.target}</span>
                          <p>{edge.description}</p>
                        </article>
                      ))}
                    </div>
                  ) : relationshipThreads.length ? (
                    <div className="thread-list">
                      {relationshipThreads.map((thread) => (
                        <article className="thread-card" key={thread.thread_id}>
                          <div>
                            <strong>{thread.title}</strong>
                            <span>{thread.status} / {thread.tension}/10</span>
                          </div>
                          <p>{thread.current_beat || thread.summary}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state compact-empty">
                      <Network size={24} />
                      <p>No relationship entries loaded.</p>
                    </div>
                  )}
                </section>
              )}

              {activeMainTab === 'locations' && (
                <section className="info-panel">
                  <div className="section-title">
                    <MapPinned size={16} />
                    <span>Locations</span>
                  </div>
                  {locationTrail.length ? (
                    <div className="location-map">
                      {locationTrail.map((item, index) => (
                        <article className={`location-node ${item.tone}`} key={`${item.label}:${index}`}>
                          <span>{index + 1}</span>
                          <div>
                            <strong>{item.label}</strong>
                            <p>{item.detail}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state compact-empty">
                      <MapPinned size={24} />
                      <p>No location entries loaded.</p>
                    </div>
                  )}
                </section>
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
          </>
        )}
      </section>

      <aside className={`inspector ${showInspector ? 'open' : ''}`} aria-label="Runtime inspector">
        <button
          aria-label="Close runtime inspector"
          className="icon-button mobile-close mobile-only"
          onClick={() => setShowInspector(false)}
          type="button"
        >
          <X size={20} />
        </button>

        {isSetupMode ? (
          <div className="panel-group">
            <section className="panel">
              <div className="section-title">
                <ListChecks size={16} />
                <span>Campaign Draft</span>
              </div>
              <label className="field">
                <span>Story Name</span>
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
                <input
                  value={setupDraft.tone || ''}
                  onChange={(event) => updateSetupDraft({ tone: event.target.value })}
                />
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
                <span>Lore Paths</span>
                <textarea
                  value={listToText(setupDraft.lore_paths)}
                  onChange={(event) => updateSetupDraft({ lore_paths: textToList(event.target.value) })}
                  rows={2}
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

              <div className="subsection-title">Player Character</div>
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

            {setupReview && (
              <section className="panel">
                <div className="section-title">
                  <CheckCircle2 size={16} />
                  <span>Review Status</span>
                </div>
                <div className={setupReview.ready_to_bootstrap ? 'status ok' : 'status warn'}>
                  <Activity size={15} />
                  <span>{setupReview.ready_to_bootstrap ? 'Ready to Play' : 'Needs Edits'}</span>
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
          </div>
        ) : (
          <div className="panel-group">
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
                <MessageSquareText size={16} />
                <span>Memory Recap</span>
              </div>
              <p className="recap">{bundle?.recap || 'No recap loaded.'}</p>
            </section>
          </div>
        )}
      </aside>

      {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}

      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)} role="presentation">
          <div className="modal-content" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <header className="modal-header">
              <h2>Runtime Settings</h2>
              <button className="icon-button" onClick={() => setShowSettings(false)} type="button" aria-label="Close">
                <X size={20} />
              </button>
            </header>

            <div className="modal-body">
              <section className="panel">
                <div className="section-title">
                  <Server size={16} />
                  <span>Backend Connection</span>
                </div>
                <label className="field">
                  <span>API Base URL</span>
                  <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} />
                </label>
                <button
                  className="secondary-button"
                  onClick={() => {
                    refreshCatalog().catch((error: unknown) =>
                      setToast({ tone: 'error', message: error instanceof Error ? error.message : String(error) }),
                    );
                  }}
                  type="button"
                >
                  <RefreshCw size={16} />
                  <span>Refresh Providers</span>
                </button>
              </section>

              <section className="panel">
                <div className="section-title">
                  <Settings2 size={16} />
                  <span>Model Configuration</span>
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
                {selectedProviderInfo?.notes && <p className="provider-note">{selectedProviderInfo.notes}</p>}
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
                  <span>Transcript Jump Turns</span>
                  <input
                    min={1}
                    max={100}
                    type="number"
                    value={transcriptJumpTurns}
                    onChange={(event) => handleJumpTurnsChange(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Runtime Notes</span>
                  <textarea
                    value={runtimeNotes}
                    onChange={(event) => setRuntimeNotes(event.target.value)}
                    rows={3}
                  />
                </label>
                {!selectedCampaign && (
                  <p className="empty">Runtime settings can be saved after a campaign is selected or approved.</p>
                )}
                <div className="button-row">
                  <button className="secondary-button" disabled={busy} onClick={testProvider} type="button">
                    <Activity size={16} />
                    <span>Test</span>
                  </button>
                  <button disabled={busy || !selectedCampaign} onClick={handleSaveSettingsAndClose} type="button">
                    <CheckCircle2 size={17} />
                    <span>Save Settings</span>
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
