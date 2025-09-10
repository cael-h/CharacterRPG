const OPENAI_BASE = process.env.OPENAI_BASE || 'https://api.openai.com';

export async function openaiJson(system: string, user: string, model?: string, apiKey?: string) {
  const key = apiKey || process.env.OPENAI_API_KEY || '';
  if (!key) throw new Error('OpenAI API key missing. Pass X-Provider-Key or set OPENAI_API_KEY.');
  const body = {
    model: model || process.env.DEFAULT_OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system + ' Always respond with a single JSON object. Do not include explanations.' },
      { role: 'user', content: user }
    ],
    temperature: 0.2
  } as any;
  const resp = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  const text = await resp.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  if (!resp.ok) {
    const msg = json?.error?.message || text || `HTTP ${resp.status}`;
    throw new Error(`OpenAI error (${resp.status}): ${msg}`);
  }
  const txt = json?.choices?.[0]?.message?.content ?? '';
  const cleaned = String(txt).trim().replace(/^```json\n?|```$/g, '');
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`OpenAI returned non-JSON for JSON helper: ${String(txt).slice(0,160)}`);
  }
}
