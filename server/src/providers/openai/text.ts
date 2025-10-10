const OPENAI_BASE = process.env.OPENAI_BASE || 'https://api.openai.com';

function buildPrompt(system: string, user: string) {
  return (
    `${system}\n` +
    `You must answer ONLY with strict JSON: ` +
    `{"turns":[{"speaker":"NAME","text":"...","speak":true,"emotion":"neutral"}]}. ` +
    `The value of "speaker" MUST be a real character name from the Characters list (verbatim). ` +
    `Never output placeholders like <one of the characters> or angle-bracketed text. ` +
    `Keep each NPC turn to at most 2 sentences.\n` +
    `User: ${user}`
  );
}

export async function openaiTurn(system: string, user: string, model?: string, apiKey?: string, useResponses?: boolean) {
  const prompt = buildPrompt(system, user);
  const key = apiKey || process.env.OPENAI_API_KEY || '';
  if (!key) throw new Error('OpenAI API key missing. Pass X-Provider-Key or set OPENAI_API_KEY.');
  const wantResponses = useResponses || String(process.env.OPENAI_USE_RESPONSES||'').toLowerCase()==='true';
  if (wantResponses) {
    // Use Responses API
    const body = {
      model: model || process.env.DEFAULT_OPENAI_MODEL || 'gpt-5-mini',
      input: [
        { role: 'system', content: 'Return only the JSON requested; no extra text.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
    } as any;
    const resp = await fetch(`${OPENAI_BASE}/v1/responses`, {
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
    // Prefer output_text; fall back to first text content
    const txt = json?.output_text || json?.output?.[0]?.content?.[0]?.text || '';
    try {
      const cleaned = String(txt).trim().replace(/^```json\n?|```$/g, '');
      const obj = JSON.parse(cleaned);
      if (obj && Array.isArray(obj.turns)) return obj;
    } catch {}
    if (!txt) throw new Error('OpenAI Responses returned empty content.');
    throw new Error(`OpenAI Responses returned non-JSON content: ${String(txt).slice(0,160)}`);
  } else {
    // Use Chat Completions
    const body = {
      model: model || process.env.DEFAULT_OPENAI_MODEL || 'gpt-5-mini',
      messages: [
        { role: 'system', content: 'Return only the JSON requested; no extra text.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
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
    if (json?.error) {
      throw new Error(`OpenAI error: ${json.error.message || JSON.stringify(json.error)}`);
    }
    const txt = json?.choices?.[0]?.message?.content ?? '';
    try {
      const cleaned = String(txt).trim().replace(/^```json\n?|```$/g, '');
      const obj = JSON.parse(cleaned);
      if (obj && Array.isArray(obj.turns)) return obj;
    } catch {}
    if (!txt) throw new Error('OpenAI returned empty content. Check model name and key.');
    throw new Error(`OpenAI returned non-JSON content: ${String(txt).slice(0,160)}`);
  }
}
