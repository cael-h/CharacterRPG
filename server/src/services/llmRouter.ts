import { mockTurn } from '../providers/mock/text.js';

type Character = { id?: string; name: string; system_prompt: string; age?: number|null; birth_year?: number|null };

type Args = {
  provider: 'openai' | 'gemini' | 'mock' | 'ollama',
  scene_context: any,
  characters: Character[],
  player_text: string,
  providerKey?: string,
  model?: string,
  mature?: boolean,
  extraContext?: string,
  useResponses?: boolean,
};

function ageAtTime(birthYear?: number|null, iso?: string) {
  if (!birthYear) return null;
  try {
    const y = new Date(iso || Date.now()).getUTCFullYear();
    return Math.max(0, y - birthYear);
  } catch { return null; }
}

const systemHeader = (chars: Character[], mature?: boolean, narrativeTimeIso?: string, extraContext?: string) => {
  const withAges = chars.map(c => {
    const a = c.age ?? ageAtTime(c.birth_year ?? null, narrativeTimeIso);
    return a != null ? `${c.name} (${a})` : c.name;
  }).join(', ');
  const validNames = chars.map(c => c.name);
  const base = `You are running a scene. Characters: ${withAges || chars.map(c=>c.name).join(', ')}.`;
  const jsonRule =
    `Output ONLY strict JSON of shape {"turns":[{"speaker":"NAME","text":"...","speak":true,"emotion":"neutral"}]}. ` +
    `The value of "speaker" MUST be exactly one of: [${validNames.map(n=>`"${n}"`).join(', ')}]. ` +
    `Never output placeholders like <one> or <one of the characters>; use a real name verbatim. ` +
    `Keep each turn ≤ 2 sentences.`;
  const matureNote = mature
    ? `You may use mature language if in-character. Do not include sexual content involving minors. Avoid illegal content.`
    : `Keep language PG-13; avoid explicit sexual content.`;
  const ctx = extraContext ? `\nContext (use if helpful):\n${extraContext}` : '';
  return `${base}\n${jsonRule}\n${matureNote}${ctx}`;
};

export async function llmTurn(a: Args & { narrativeTimeIso?: string }) {
  const sys = systemHeader(a.characters, a.mature, a.narrativeTimeIso, a.extraContext);
  const user = a.player_text;
  if (a.provider === 'ollama') {
    const { ollamaTurn } = await import('../providers/ollama/text.js');
    return ollamaTurn(sys, user, a.model);
  }
  if (a.provider === 'openai') {
    const { openaiTurn } = await import('../providers/openai/text.js');
    return openaiTurn(sys, user, a.model, a.providerKey, a.useResponses);
  }
  // In this environment we default to mock. Real providers are wired later.
  return mockTurn(sys, user);
}
