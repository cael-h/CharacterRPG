import { openaiJson } from '../providers/openai/json.js';
import { ollamaTurn } from '../providers/ollama/text.js';

export type Candidate = { id: string; text: string; score?: number; occurred_at?: number|null };

export async function reviewerSelect(opts: {
  character_id?: string;
  reviewer_provider?: 'openai'|'ollama'|'stub';
  reviewer_model?: string;
  x_provider_key?: string;
  candidates: Candidate[];
  style_short?: boolean;
}) {
  const { character_id, reviewer_provider, reviewer_model, x_provider_key, candidates, style_short } = opts;
  if (!candidates?.length) return { selected: [], notes: 'no candidates', ask_clarify: true };
  const top = candidates.slice(0, 8);
  if (!reviewer_provider || reviewer_provider === 'stub') {
    return { selected: top.slice(0,3).map(c=>c.id), notes: 'heuristic', ask_clarify: false };
  }
  // Load optional reviewer prompt from per-character or global docs
  let sys = 'You are a retrieval reviewer. Read the candidate snippets and return JSON {"selected":[ids],"notes":"...","ask_clarify":true|false}. Keep selected small (<=3).';
  try {
    const fs = await import('fs');
    const path = await import('path');
    const base = process.env.PROFILES_DIR || 'profiles';
    if (character_id) {
      const p = path.join(base, character_id, 'prompt', 'reviewer.md');
      if (fs.existsSync(p)) sys = fs.readFileSync(p, 'utf-8');
    }
    if (sys === 'You are a retrieval reviewer. Read the candidate snippets and return JSON {"selected":[ids],"notes":"...","ask_clarify":true|false}. Keep selected small (<=3).') {
      const d = path.join('docs', 'Reviewer_Default_Prompt.md');
      if (fs.existsSync(d)) sys = fs.readFileSync(d, 'utf-8');
    }
  } catch {}
  const style = style_short ? '\nGuidelines: prefer candidates that support short, concrete replies.' : '';
  const user = 'Candidates (id: text):\n' + top.map(c=>`- ${c.id}: ${String(c.text||'').slice(0,600)}`).join('\n') + style;

  if (reviewer_provider === 'openai') {
    const obj = await openaiJson(sys, user, reviewer_model, x_provider_key);
    return { selected: obj.selected || [], notes: obj.notes, ask_clarify: !!obj.ask_clarify };
  }
  if (reviewer_provider === 'ollama') {
    const out = await ollamaTurn(sys + ' Output only JSON.', user, reviewer_model);
    try { const txt = out?.turns?.[0]?.text ?? '{}'; const obj = JSON.parse(txt); return { selected: obj.selected||[], notes: obj.notes, ask_clarify: !!obj.ask_clarify }; } catch {}
  }
  return { selected: top.slice(0,3).map(c=>c.id), notes: 'fallback heuristic', ask_clarify: false };
}

// Simple in-memory cache
type CacheEntry = { ts: number; selected: string[] };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 120000; // 2 minutes

export function getReviewerCache(sessionId: string) {
  const e = cache.get(sessionId);
  if (!e) return null;
  if (Date.now() - e.ts > TTL_MS) { cache.delete(sessionId); return null; }
  return e.selected;
}

export function setReviewerCache(sessionId: string, selected: string[]) {
  cache.set(sessionId, { ts: Date.now(), selected });
}
