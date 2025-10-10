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
  // Fallback: scan for balanced braces that contain "turns"
  const len = cleaned.length;
  const grab = (start: number) => {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < len; i++) {
      const ch = cleaned[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return cleaned.slice(start, i + 1);
        if (depth < 0) break;
      }
    }
    return '';
  };
  for (let i = 0; i < len; i++) {
    if (cleaned[i] !== '{') continue;
    const candidate = grab(i);
    if (candidate && candidate.includes('"turns"')) {
      const parsed = tryParse(candidate);
      if (parsed) return parsed;
    }
  }
  return null;
}

interface OllamaResponse { response?: string }

export async function ollamaTurn(system: string, user: string, modelOverride?: string) {
  const prompt = buildPrompt(system, user);
  let data: OllamaResponse = { response: '' };
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelOverride || process.env.OLLAMA_MODEL || 'llama3.1:8b-instruct-q4_K_M',
      prompt,
      stream: false,
      options: { temperature: 0.3 }
    })
  });
    if (res.ok) data = (await res.json()) as OllamaResponse;
  } catch {}

  const txt = data.response ?? '';
  const obj = extractJsonWithTurns(txt);
  if (obj) return obj;
  return { turns: [{ speaker: 'Narrator', text: String(txt || '…'), speak: false, emotion: 'neutral' }] };
}
