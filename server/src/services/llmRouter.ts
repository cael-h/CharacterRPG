import { mockTurn } from '../providers/mock/text.js';

type Character = { id?: string; name: string; system_prompt: string };

type Args = {
  provider: 'openai' | 'gemini' | 'mock' | 'ollama',
  scene_context: any,
  characters: Character[],
  player_text: string,
  providerKey?: string,
};

const systemHeader = (chars: Character[]) => `You are running a scene. Characters: ${chars.map(c=>c.name).join(', ')}.`;

export async function llmTurn(a: Args) {
  const sys = systemHeader(a.characters);
  const user = a.player_text;
  if (a.provider === 'ollama') {
    const { ollamaTurn } = await import('../providers/ollama/text.js');
    return ollamaTurn(sys, user);
  }
  // In this environment we default to mock. Real providers are wired later.
  return mockTurn(sys, user);
}
