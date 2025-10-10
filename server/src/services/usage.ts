import fs from 'fs';
import path from 'path';

type GenerationEntry = {
  ts: number;
  sessionId: string;
  type: 'generation';
  model: string;
  role: 'player'|'npc';
  textLen: number;
  approxTokens: number;
};

function approxTokenCount(text: string) {
  // Rough heuristic: ~4 chars/token average
  return Math.max(1, Math.round(text.length / 4));
}

type RetrievalEntry = {
  ts: number;
  sessionId: string;
  type: 'retrieval';
  provider: string;
  docCount: number;
  scoredCount: number;
  selectedCount: number;
  durationMs: number;
  cacheHit: boolean;
};

export function recordUsage(sessionId: string, model: string, role: 'player'|'npc', text: string) {
  const dir = process.env.USAGE_DIR || 'usage';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${sessionId}.jsonl`);
  const entry: GenerationEntry = { ts: Date.now(), sessionId, type: 'generation', model, role, textLen: text.length, approxTokens: approxTokenCount(text) };
  fs.appendFileSync(p, JSON.stringify(entry) + '\n');
}

export function recordRetrieval(sessionId: string, provider: string, info: { docCount: number; scoredCount: number; selectedCount: number; durationMs: number; cacheHit: boolean }) {
  const dir = process.env.USAGE_DIR || 'usage';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${sessionId}.jsonl`);
  const entry: RetrievalEntry = {
    ts: Date.now(),
    sessionId,
    type: 'retrieval',
    provider,
    docCount: info.docCount,
    scoredCount: info.scoredCount,
    selectedCount: info.selectedCount,
    durationMs: info.durationMs,
    cacheHit: info.cacheHit,
  };
  fs.appendFileSync(p, JSON.stringify(entry) + '\n');
}
