import { Router } from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db.js';
import { scoreDocs, topK } from '../services/rag.js';
import { profileDirFor } from '../services/paths.js';
import type { Candidate } from '../services/reviewer.js';
import type { CharacterNameRow } from '../types.js';

export const router = Router();

type RagDoc = { id: string; source: string; title?: string; text: string; occurred_at?: number | null };

type MemoryRow = { text: string; created_at?: number | null };

function loadCharacterDocs(characterId: string): RagDoc[] {
  const out: RagDoc[] = [];
  // Profile bundle
  const pdir = profileDirFor(characterId);
  const pmd = path.join(pdir, 'profile.md');
  if (fs.existsSync(pmd)) out.push({ id: `profile:${characterId}`, source: 'profile', title: 'Base Profile', text: fs.readFileSync(pmd, 'utf-8') });
  const tmd = path.join(pdir, 'timeline.md');
  if (fs.existsSync(tmd)) out.push({ id: `timeline:${characterId}`, source: 'timeline', title: 'Core Timeline', text: fs.readFileSync(tmd, 'utf-8') });

  // Docs folder
  const docsDir = path.join(pdir, 'docs');
  if (fs.existsSync(docsDir)) {
    for (const f of fs.readdirSync(docsDir)) {
      const ext = f.toLowerCase().split('.').pop();
      if (!['md','txt'].includes(ext || '')) continue; // ignore pdf for search (no OCR)
      const full = path.join(docsDir, f);
      out.push({ id: `doc:${f}`, source: 'doc', title: f, text: fs.readFileSync(full, 'utf-8') });
    }
  }

  // Memories table (per character by name)
  try {
    const row = db.prepare('SELECT name FROM characters WHERE id=?').get(characterId) as CharacterNameRow | undefined;
    if (row?.name) {
      const mems = db
        .prepare('SELECT text, created_at FROM memories WHERE character_id=? ORDER BY created_at DESC LIMIT 500')
        .all(row.name) as MemoryRow[];
      for (let i = 0; i < mems.length; i++) {
        const text = String(mems[i]?.text ?? '');
        out.push({ id: `memory:${i}`, source: 'memory', title: 'Memory', text, occurred_at: mems[i]?.created_at ?? null });
      }
    }
  } catch {}

  return out;
}

// POST /api/rag/search { character_id, query, k }
router.post('/search', (req: Request<unknown, unknown, { character_id?: string; query?: string; k?: number }>, res: Response) => {
  const { character_id, query, k } = req.body || {};
  if (!character_id || !query) return res.status(400).json({ error: 'bad_request' });
  const docs = loadCharacterDocs(character_id);
  const scored = scoreDocs(String(query), docs);
  return res.json({ results: topK(scored, Math.min(Number(k||5), 20)) });
});

// POST /api/rag/review { character_id, query, candidates: [{id, text, score}], reviewer_provider?, reviewer_model? }
// For now, stub: choose top-N by score and recency; later wire to llmTurn
router.post('/review', async (req: Request<unknown, unknown, {
  candidates?: Candidate[];
  n?: number;
  reviewer_provider?: 'openai' | 'ollama' | 'stub';
  reviewer_model?: string;
  x_provider_key?: string;
  style_short?: boolean;
  character_id?: string;
}>, res: Response) => {
  const { candidates, n, reviewer_provider, reviewer_model, x_provider_key, style_short } = req.body || {};
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return res.json({ selected: [], reason: 'no candidates' });
  }
  const top = candidates
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.occurred_at || 0) - (a.occurred_at || 0))
    .slice(0, Math.min(Number(n || 6), 12));

  if (!reviewer_provider || reviewer_provider === 'stub') {
    return res.json({ selected: top.map((c) => c.id), reason: 'score+recency heuristic' });
  }
  try {
    const sys = 'You are a retrieval reviewer. Read the user message and candidate snippets. Return JSON {"selected":[ids],"notes":"...","ask_clarify":true|false}. Keep selected small (<=3).';
    const style = style_short ? '\nGuidelines: prefer candidates that support short, concrete replies.' : '';
    const user = `Candidates (id: text):\n` + top.map((c) => `- ${c.id}: ${String(c.text || '').slice(0, 600)}`).join('\n') + `\n` + style;
    let out: any = null;
    if (reviewer_provider === 'openai') {
      const { openaiTurn } = await import('../providers/openai/text.js');
      out = await openaiTurn(sys, user, reviewer_model || process.env.REVIEWER_MODEL || 'gpt-5-nano', x_provider_key);
    } else if (reviewer_provider === 'ollama') {
      const { ollamaTurn } = await import('../providers/ollama/text.js');
      out = await ollamaTurn(sys, user, reviewer_model);
    } else {
      out = { turns: [{ speaker:'Reviewer', text: JSON.stringify({ selected: top.slice(0,3).map((c)=>c.id), notes:'stub', ask_clarify:false }) }] };
    }
    const txt = out?.turns?.[0]?.text ?? '{}';
    let obj:any = {};
    try { obj = JSON.parse(txt); } catch {}
    if (Array.isArray(obj.selected)) return res.json({ selected: obj.selected, notes: obj.notes, ask_clarify: !!obj.ask_clarify });
    return res.json({ selected: top.slice(0,3).map((c)=>c.id), reason: 'fallback: heuristic' });
  } catch (e:any) {
    return res.json({ selected: top.slice(0,3).map((c)=>c.id), reason: 'error, heuristic used', error: String(e) });
  }
});
