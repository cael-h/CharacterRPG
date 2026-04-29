import { Router } from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

export const router = Router();

type GenerationEntry = {
  ts?: number;
  type?: 'generation';
  model?: string;
  role?: 'player' | 'npc';
  approxTokens?: number;
  textLen?: number;
};

type RetrievalEntry = {
  ts?: number;
  type?: 'retrieval';
  provider?: string;
  docCount?: number;
  scoredCount?: number;
  selectedCount?: number;
  durationMs?: number;
  cacheHit?: boolean;
};

type UsageEntry = GenerationEntry | RetrievalEntry;

function usagePath(sessionId: string) {
  const dir = process.env.USAGE_DIR || 'usage';
  return path.join(dir, `${sessionId}.jsonl`);
}

function parseEntries(sessionId: string): UsageEntry[] {
  const file = usagePath(sessionId);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
  const entries: UsageEntry[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as UsageEntry);
    } catch {
      // Ignore malformed telemetry lines; usage telemetry should not break the app.
    }
  }
  return entries;
}

router.get('/:sessionId', (req: Request<{ sessionId: string }>, res: Response) => {
  const sessionId = req.params.sessionId;
  const entries = parseEntries(sessionId);
  const generation = entries.filter((entry): entry is GenerationEntry => entry.type === 'generation');
  const retrieval = entries.filter((entry): entry is RetrievalEntry => entry.type === 'retrieval');
  const byModel: Record<string, { requests: number; approxTokens: number; textLen: number }> = {};
  for (const entry of generation) {
    const model = entry.model || 'unknown';
    const current = byModel[model] || { requests: 0, approxTokens: 0, textLen: 0 };
    current.requests += entry.role === 'player' ? 1 : 0;
    current.approxTokens += Number(entry.approxTokens || 0);
    current.textLen += Number(entry.textLen || 0);
    byModel[model] = current;
  }
  const latestRetrieval = retrieval[retrieval.length - 1] || null;
  res.json({
    sessionId,
    path: usagePath(sessionId),
    entries: entries.length,
    generationEntries: generation.length,
    retrievalEntries: retrieval.length,
    byModel,
    latestRetrieval,
  });
});
