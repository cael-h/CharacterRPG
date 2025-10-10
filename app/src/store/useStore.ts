import { create } from 'zustand';

type Provider = 'gemini' | 'openai' | 'ollama' | 'mock';
type Model =
  | 'gemini-2.5-flash'
  | 'gemini-2.5-flash-lite'
  | 'gpt-5'
  | 'gpt-5-mini'
  | 'gpt-5-nano'
  | 'ollama-qwen2.5-7b-instruct'
  | 'ollama-llama3.1-8b-instruct'
  | 'ollama-roleplay-hermes-3-llama-3.1-8b'
  | 'mock';

type Turn = { role: 'player'|'npc'; speaker: string; text: string };

type UsageCounters = { requests: number; inTokens: number; outTokens: number; state: 'free'|'near'|'limited'|'over'|'paid' };
type RetrievalStats = { docCount: number; selectedCount: number; durationMs: number; cacheHit: boolean };
type Usage = { byModel: Record<string, UsageCounters>; retrieval?: RetrievalStats };

type State = {
  apiBase: string;
  provider: Provider;
  model: Model;
  openaiKey?: string;
  geminiKey?: string;
  sessionId?: string;
  characters: { id: string; name: string; avatar_uri?: string; profile_uri?: string; system_prompt?: string }[];
  selected: string[];
  turns: Turn[];
  usage: Usage;
  mature: boolean;
  customOllamaModel?: string;
  tweakMode: 'off'|'suggest'|'auto';
  set: (p: Partial<State>) => void;
  pushTurn: (t: Turn) => void;
  startSession: () => Promise<void>;
  incUsage: (model: string, kind: 'in'|'out', tokens: number) => void;
  setRetrieval: (stats?: RetrievalStats) => void;
};

export const useStore = create<State>((set, get) => ({
  apiBase: 'http://localhost:4000',
  provider: 'openai',
  model: 'gpt-5-mini' as Model,
  characters: [],
  selected: [],
  turns: [],
  usage: { byModel: {} },
  mature: false,
  tweakMode: 'off',
  set: (p) => set(p),
  pushTurn: (t) => set({ turns: [...get().turns, t] }),
  startSession: async () => {
    if (get().sessionId) return;
    const { apiBase, provider, selected } = get();
    const participants = selected.map(id => ({ id }));
    const r = await fetch(`${apiBase}/api/sessions`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title: 'Scene', provider, participants }) }).then(r=>r.json());
    set({ sessionId: r.id });
  },
  incUsage: (model, kind, tokens) => {
    const u = { ...(get().usage.byModel[model] || { requests:0, inTokens:0, outTokens:0, state:'free' as const }) };
    u.requests += kind==='in'?1:0;
    if (kind==='in') u.inTokens += tokens; else u.outTokens += tokens;
    set({ usage: { byModel: { ...get().usage.byModel, [model]: u } } });
  },
  setRetrieval: (stats) => {
    const usage = get().usage;
    set({ usage: { ...usage, retrieval: stats } });
  }
}));

export function modelToOllamaId(model: Model, custom?: string) {
  if (model === 'ollama-qwen2.5-7b-instruct') return 'qwen2.5:7b-instruct';
  if (model === 'ollama-llama3.1-8b-instruct') return 'llama3.1:8b-instruct';
  if (model === 'ollama-roleplay-hermes-3-llama-3.1-8b') return 'roleplay-hermes-3-llama-3.1-8b';
  if (custom) return custom;
  return undefined;
}
