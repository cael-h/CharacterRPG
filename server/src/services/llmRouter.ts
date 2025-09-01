import { mockTurn } from '../providers/mock/text.js';

type Character = { id?: string; name: string; system_prompt: string };

type Args = {
  provider: 'openai' | 'gemini' | 'mock' | 'ollama',
  scene_context: any,
  characters: Character[],
  player_text: string,
  providerKey?: string,
  model?: string,
  mature?: boolean,
};

const systemHeader = (chars: Character[], mature?: boolean) => {
  const base = `You are running a scene. Characters: ${chars.map(c=>c.name).join(', ')}.`;
  const jsonRule = `Output ONLY strict JSON of shape {"turns":[{"speaker":"<one>","text":"...","speak":true,"emotion":"neutral"}]}. Keep each turn ≤ 2 sentences.`;
  const matureNote = mature
    ? `You may use mature language if in-character. Do not include sexual content involving minors. Avoid illegal content.`
    : `Keep language PG-13; avoid explicit sexual content.`;
  return `${base}\n${jsonRule}\n${matureNote}`;
};

export async function llmTurn(a: Args) {
  const sys = systemHeader(a.characters, a.mature);
  const user = a.player_text;
  if (a.provider === 'ollama') {
    const { ollamaTurn } = await import('../providers/ollama/text.js');
    return ollamaTurn(sys, user, a.model);
  }
  // In this environment we default to mock. Real providers are wired later.
  return mockTurn(sys, user);
}
