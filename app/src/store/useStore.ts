import { create } from 'zustand';

type Provider = 'gemini' | 'openai' | 'mock';
type Model = 'gemini-2.5-flash' | 'gemini-2.5-flash-lite' | 'gpt5-mini' | 'gpt5' | 'mock';

type Turn = { role: 'player'|'npc'; speaker: string; text: string };

type Usage = {
  byModel: Record<string, { requests: number; inTokens: number; outTokens: number; state: 'free'|'near'|'limited'|'over'|'paid' }>
};

type State = {
  apiBase: string;
  provider: Provider;
  model: Model;
  openaiKey?: string;
  geminiKey?: string;
  sessionId?: string;
  characters: { id: string; name: string; avatar_uri?: string; system_prompt?: string }[];
  turns: Turn[];
  usage: Usage;
  set: (p: Partial<State>) => void;
  pushTurn: (t: Turn) => void;
};

export const useStore = create<State>((set, get) => ({
  apiBase: 'http://localhost:4000',
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  characters: [],
  turns: [],
  usage: { byModel: {} },
  set: (p) => set(p),
  pushTurn: (t) => set({ turns: [...get().turns, t] })
}));

