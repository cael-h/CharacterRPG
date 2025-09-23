import { Router } from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

function promptDirFor(id: string) {
  const base = process.env.PROFILES_DIR || 'profiles';
  const dir = path.join(base, id, 'prompt');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const router = Router({ mergeParams: true });

type PromptName = 'generic.md' | 'short.md' | 'reviewer.md';
const PROMPT_FILES: PromptName[] = ['generic.md', 'short.md', 'reviewer.md'];

function sanitizeName(raw: string | undefined): PromptName | null {
  const name = String(raw || '').toLowerCase() as PromptName;
  return PROMPT_FILES.includes(name) ? name : null;
}

// List available prompt files
router.get('/', (req: Request<{ id: string }>, res: Response) => {
  const dir = promptDirFor(req.params.id);
  const out = PROMPT_FILES.map((name) => {
    const p = path.join(dir, name);
    try {
      const st = fs.statSync(p);
      return { name, size: st.size, mtimeMs: st.mtimeMs };
    } catch { return { name, size: 0, mtimeMs: 0 }; }
  });
  res.json(out);
});

// Get specific prompt file
router.get('/:name', (req: Request<{ id: string; name: string }>, res: Response) => {
  const dir = promptDirFor(req.params.id);
  const name = sanitizeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'bad_name' });
  const p = path.join(dir, name);
  try { res.type('text/plain').send(fs.readFileSync(p, 'utf-8')); }
  catch { res.status(404).json({ error: 'not_found' }); }
});

// Update specific prompt file (PUT json {content} or text/plain)
router.put('/:name', (req: Request<{ id: string; name: string }>, res: Response) => {
  const dir = promptDirFor(req.params.id);
  const name = sanitizeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'bad_name' });
  let content = '';
  try {
    if (typeof req.body === 'string') content = req.body;
    else if (req.is('application/json') && typeof req.body?.content === 'string') content = req.body.content;
    else content = String(req.body || '');
  } catch {}
  fs.writeFileSync(path.join(dir, name), content);
  res.json({ ok: true });
});
