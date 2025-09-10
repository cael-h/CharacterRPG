import { Router } from 'express';

export const router = Router();

// Ollama health and model listing helpers
async function fetchJson(url: string) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } catch (e) {
    return null;
  }
}

router.get('/ollama/health', async (_req, res) => {
  const base = process.env.OLLAMA_BASE || 'http://localhost:11434';
  const version = await fetchJson(`${base}/api/version`);
  const tags = await fetchJson(`${base}/api/tags`);
  const models = Array.isArray(tags?.models)
    ? tags.models.map((m: any) => m.name)
    : undefined;
  const ok = Boolean(version || tags);
  res.json({ ok, base, version: version?.version ?? null, models });
});

router.get('/ollama/tags', async (_req, res) => {
  const base = process.env.OLLAMA_BASE || 'http://localhost:11434';
  const tags = await fetchJson(`${base}/api/tags`);
  if (!tags) return res.status(502).json({ error: 'unreachable' });
  res.json(tags);
});

