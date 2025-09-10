const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434';
const STRIP_THINK = String(process.env.OLLAMA_STRIP_THINK ?? 'true').toLowerCase() !== 'false';

function buildPrompt(system: string, user: string) {
  return (
    `${system}\n` +
    `You must answer ONLY with strict JSON: ` +
    `{"turns":[{"speaker":"NAME","text":"...","speak":true,"emotion":"neutral"}]}. ` +
    `The value of "speaker" MUST be a real character name from the Characters list (verbatim). ` +
    `Never output placeholders like <one of the characters> or angle-bracketed text. ` +
    `Do not include any analysis, chain-of-thought, <think> blocks, or explanations. ` +
    `Keep each NPC turn to at most 2 sentences.\n` +
    `User: ${user}`
  );
}

export function stripFences(s: string) {
  return s.replace(/^```(?:json)?\n?|```$/g, '');
}

export function stripThink(s: string) {
  // DeepSeek R1 models may emit <think>...</think> blocks
  return s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export function tryParse(objText: string): any | null {
  try {
    const o = JSON.parse(objText);
    if (o && Array.isArray(o.turns)) return o;
  } catch {}
  return null;
}

export function extractJsonWithTurns(text: string): any | null {
  const raw = String(text || '');
  const noThink = STRIP_THINK ? stripThink(raw) : raw;
  const cleaned = stripFences(noThink).trim();
  const direct = tryParse(cleaned);
  if (direct) return direct;
  // Fallback: search for a JSON object containing "turns":
  const candidates: string[] = [];
  const re = /\{[\s\S]*?\}/g; // naive object spans; try small ones first
  const matches = cleaned.match(re) || [];
  for (const m of matches) {
    if (m.includes('"turns"')) candidates.push(m);
  }
  for (const c of candidates) {
    const parsed = tryParse(c);
    if (parsed) return parsed;
  }
  return null;
}

export async function ollamaTurn(system: string, user: string, modelOverride?: string) {
  const prompt = buildPrompt(system, user);
  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelOverride || process.env.OLLAMA_MODEL || 'llama3.1:8b-instruct-q4_K_M',
      prompt,
      stream: false,
      options: { temperature: 0.3 }
    })
  }).then(r => r.json()).catch(() => ({ response: '' }));

  const txt = res?.response ?? '';
  const obj = extractJsonWithTurns(txt);
  if (obj) return obj;
  return { turns: [{ speaker: 'Narrator', text: String(txt || '…'), speak: false, emotion: 'neutral' }] };
}
