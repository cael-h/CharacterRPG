import { Router } from 'express';
import type { Request, Response } from 'express';

export const router = Router();

type OllamaVersion = { version?: string } | null;
type OllamaTags = { models?: Array<{ name: string }> } | null;

// Ollama health and model listing helpers
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as T;
  } catch (e) {
    return null;
  }
}

router.get('/ollama/health', async (_req: Request, res: Response) => {
  const base = process.env.OLLAMA_BASE || 'http://localhost:11434';
  const version = await fetchJson<OllamaVersion>(`${base}/api/version`);
  const tags = await fetchJson<OllamaTags>(`${base}/api/tags`);
  const models = Array.isArray(tags?.models)
    ? tags.models
    : undefined;
  const ok = Boolean(version || tags);
  res.json({ ok, base, version: version?.version ?? null, models });
});

router.get('/ollama/tags', async (_req: Request, res: Response) => {
  const base = process.env.OLLAMA_BASE || 'http://localhost:11434';
  const tags = await fetchJson<object>(`${base}/api/tags`);
  if (!tags) return res.status(502).json({ error: 'unreachable' });
  res.json(tags);
});
