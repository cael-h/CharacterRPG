import fs from 'fs';
import path from 'path';
import { db } from '../db.js';
import { profileDirFor, transcriptPathFor } from './paths.js';
import { scoreDocs } from './rag.js';
import { reviewerSelect, getReviewerCache, setReviewerCache, type Candidate } from './reviewer.js';
import { loadFacts } from './meta.js';

export type SearchTier = 'profile' | 'timeline' | 'doc' | 'memory' | 'transcript';

export type SearchTelemetry = {
  totalMs: number;
  docCount: number;
  scoredCount: number;
  selectedCount: number;
  cacheHit: boolean;
  tiers: Array<{ tier: SearchTier; count: number }>;
};

export type RagDoc = { id: string; source: string; title?: string; text: string; tier: SearchTier; occurred_at?: number | null };

export type SearchAgentOptions = {
  sessionId: string;
  characterId: string;
  characterName: string;
  query: string;
  styleShort?: boolean;
  includePromptHints: boolean;
  reseedTriggered: boolean;
  reviewerProvider?: 'openai' | 'ollama' | 'stub';
  reviewerModel?: string;
  providerKey?: string;
};

export type SearchAgentResult = {
  block?: string;
  telemetry: SearchTelemetry;
  factsLine?: string;
  selectedDocs: RagDoc[];
};

function tryRead(file: string, limit?: number) {
  try {
    if (fs.existsSync(file)) {
      const txt = fs.readFileSync(file, 'utf-8');
      return typeof limit === 'number' ? txt.slice(-Math.abs(limit)) : txt;
    }
  } catch {}
  return '';
}

export async function runSearchAgent(opts: SearchAgentOptions): Promise<SearchAgentResult | null> {
  const { sessionId, characterId, characterName, query, styleShort, includePromptHints, reseedTriggered, reviewerProvider, reviewerModel, providerKey } = opts;
  const started = Date.now();
  const docs: Array<{ id: string; source: string; title?: string; text: string; occurred_at?: number | null }> = [];
  const tierCounts = new Map<SearchTier, number>();
  const tierById = new Map<string, SearchTier>();
  const pushDoc = (tier: SearchTier, id: string, title: string, text: string) => {
    if (!text?.trim()) return;
    docs.push({ id, source: title, title, text });
    tierCounts.set(tier, (tierCounts.get(tier) || 0) + 1);
    tierById.set(id, tier);
  };

  const root = profileDirFor(characterId, characterName);
  pushDoc('profile', 'profile.md', 'profile', tryRead(path.join(root, 'profile.md')));
  pushDoc('timeline', 'timeline.md', 'timeline', tryRead(path.join(root, 'timeline.md')));

  try {
    const docsDir = path.join(root, 'docs');
    if (fs.existsSync(docsDir)) {
      for (const f of fs.readdirSync(docsDir)) {
        if (/\.(md|txt)$/i.test(f)) {
          pushDoc('doc', `doc:${f}`, f, tryRead(path.join(docsDir, f)));
        }
      }
    }
  } catch {}

  try {
    const mems = db
      .prepare('SELECT text FROM memories WHERE character_id=? ORDER BY created_at DESC LIMIT 200')
      .all(characterName) as Array<{ text: string }>;
    mems.forEach((m, idx) => pushDoc('memory', `mem:${idx}`, 'memory', String(m.text || '')));
  } catch {}

  try {
    const transcriptPath = transcriptPathFor(sessionId);
    const excerpt = tryRead(transcriptPath, 4000);
    if (excerpt) pushDoc('transcript', 'transcript', 'recent transcript', excerpt);
  } catch {}

  if (!docs.length) {
    return {
      block: undefined,
      telemetry: {
        totalMs: Date.now() - started,
        docCount: 0,
        scoredCount: 0,
        selectedCount: 0,
        cacheHit: false,
        tiers: [],
      },
      factsLine: undefined,
      selectedDocs: [],
    };
  }

  const scoredBase = scoreDocs(query, docs).slice(0, 5);
  const scored = scoredBase.map((d) => ({
    ...d,
    tier: tierById.get(d.id) ?? 'doc',
  }));
  const cacheKey = includePromptHints || reseedTriggered ? null : getReviewerCache(sessionId);
  let selectedIds = cacheKey || null;
  let cacheHit = !!selectedIds;

  if (!selectedIds) {
    const candidates: Candidate[] = scored.map((d) => ({
      id: d.id,
      text: d.text,
      score: d.score,
      occurred_at: d.occurred_at ?? null,
    }));
    const review = await reviewerSelect({
      character_id: characterId,
      reviewer_provider: reviewerProvider,
      reviewer_model: reviewerModel,
      x_provider_key: providerKey,
      candidates,
      style_short: styleShort,
    });
    selectedIds = review.selected?.length ? review.selected : scored.slice(0, 3).map((d) => d.id);
    if (selectedIds?.length) setReviewerCache(sessionId, selectedIds);
    cacheHit = false;
  }

  const selected = scored.filter((d) => selectedIds?.includes(d.id));
  const facts = loadFacts(characterId) || { name: characterName } as any;
  const style = (styleShort || facts?.reviewer_hints?.prefer_brief)
    ? '\nGuidelines: Keep replies brief (1–3 short sentences). Avoid long paragraphs.'
    : '';
  const factsLine =
    `Facts: name=${facts.name}` +
    (facts.nicknames?.length ? `; nicknames=${facts.nicknames.join('/')}` : '') +
    (facts.aliases?.length ? `; aliases=${facts.aliases.join('/')}` : '') +
    (facts.age != null ? `; age=${facts.age}` : '') +
    (facts.birth_year != null ? `; birth_year=${facts.birth_year}` : '') +
    (facts.story_start ? `; story_start=${facts.story_start}` : '');
  const snips = selected
    .map((d) => `- [${d.source}] ${d.title || ''}\n${String(d.text).slice(0, 500)}`)
    .join('\n\n');
  const block = snips ? `${factsLine}\n${snips}${style}` : factsLine;

  const telemetry: SearchTelemetry = {
    totalMs: Date.now() - started,
    docCount: docs.length,
    scoredCount: scored.length,
    selectedCount: selected.length,
    cacheHit,
    tiers: Array.from(tierCounts.entries()).map(([tier, count]) => ({ tier, count })),
  };

  return {
    block,
    telemetry,
    factsLine,
    selectedDocs: selected,
  };
}
