const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434';

function buildPrompt(system: string, user: string) {
  return `${system}\nYou must answer ONLY with strict JSON of shape {"turns":[{"speaker":"<one of the characters>","text":"...","speak":true,"emotion":"neutral"}]}. Keep each turn to <= 2 sentences.\nUser: ${user}`;
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
      options: { temperature: 0.7 }
    })
  }).then(r => r.json()).catch(() => ({ response: '' }));

  // Try to parse JSON from the response text; fallback to a narrator turn
  try {
    const txt = res?.response ?? '';
    // Some models may wrap JSON in code fences
    const jsonText = String(txt).trim().replace(/^```json\n?|```$/g, '');
    const obj = JSON.parse(jsonText);
    if (obj && Array.isArray(obj.turns)) return obj;
  } catch {}
  return { turns: [{ speaker: 'Narrator', text: res?.response ?? '…', speak: false, emotion: 'neutral' }] };
}
